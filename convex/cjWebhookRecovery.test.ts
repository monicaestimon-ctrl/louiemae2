// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { syncRecoveryQueue } from './webhookRecoveryMaintenance';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const claim = makeFunctionReference<'mutation'>('cjHelpers:claimWebhookProcessing');
const recover = makeFunctionReference<'mutation'>('cjHelpers:recoverStaleWebhookProcessing');
const processed = makeFunctionReference<'mutation'>('cjHelpers:markWebhookProcessed');
const payload = { type: 'STOCK', params: { vid: 'test-variant', stock: 3 } };
const stale = () => new Date(Date.now() - 31 * 60_000).toISOString();
const fixture = () => ({ messageId: 'event', type: 'STOCK', processedAt: stale(), claimedAt: stale(), claimToken: 'old-owner', payload });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('webhook retry and crash recovery', () => {
  it.each(['processing', 'retryable', 'failed'] as const)('does not reclaim an exhausted %s event on redelivery', async status => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', { ...fixture(), status, attempts: 8 }));
    const before = await t.run(ctx => ctx.db.get(id));
    const result = await t.mutation(claim, { messageId: 'event', type: 'STOCK', payload });
    expect(result.claimed).toBe(false);
    expect(await t.run(ctx => ctx.db.get(id))).toEqual(before);
  });

  it('permits the final recovery attempt, rejects the old owner, and deduplicates completion', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', { ...fixture(), status: 'processing', attempts: 7 }));
    const last = await t.mutation(claim, { messageId: 'event', type: 'STOCK' });
    expect(last.claimed).toBe(true);
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ attempts: 8, status: 'processing', payload });
    await t.mutation(processed, { messageId: 'event', type: 'STOCK', claimToken: 'old-owner' });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'processing', payload });
    await t.mutation(processed, { messageId: 'event', type: 'STOCK', claimToken: last.claimToken });
    expect(await t.mutation(claim, { messageId: 'event', type: 'STOCK', payload })).toEqual({ claimed: false, status: 'processed' });
    expect(await t.run(ctx => ctx.db.get(id))).not.toHaveProperty('payload');
  });

  it('recovers bounded stale work once while retaining exhausted and unrecoverable identities', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(makeFunctionReference<'mutation'>('webhookRecoveryQueue:initializeEmpty'), {});
    await t.run(async ctx => {
      for (let i = 0; i < 3; i++) await ctx.db.insert('cjWebhookLog', { ...fixture(), messageId: `stale-${i}`, status: 'processing', attempts: 2 });
      await ctx.db.insert('cjWebhookLog', { ...fixture(), messageId: 'exhausted', status: 'processing', attempts: 8 });
      await ctx.db.insert('cjWebhookLog', { ...fixture(), messageId: 'no-payload', status: 'processing', payload: undefined });
      await ctx.db.insert('cjWebhookLog', { ...fixture(), messageId: 'active', status: 'processing', claimedAt: new Date().toISOString() });
    });
    await t.run(async ctx => {
      for (const row of await ctx.db.query('cjWebhookLog').collect()) await syncRecoveryQueue(ctx, row._id, row);
    });
    await t.mutation(recover, { limit: 2 });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(2);
    await t.mutation(recover, { limit: 50 });
    await t.mutation(recover, { limit: 50 });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(3);
    const rows = await t.run(ctx => ctx.db.query('cjWebhookLog').collect());
    expect(rows).toHaveLength(6);
    for (const row of rows.filter(row => row.messageId.startsWith('stale-'))) expect(row).toMatchObject({ status: 'retryable', payload });
    expect(rows.find(row => row.messageId === 'exhausted')).toMatchObject({ status: 'failed', attempts: 8, payload });
    expect(rows.find(row => row.messageId === 'no-payload')).toMatchObject({ status: 'failed' });
    expect(rows.find(row => row.messageId === 'active')).toMatchObject({ status: 'processing' });
  });
});

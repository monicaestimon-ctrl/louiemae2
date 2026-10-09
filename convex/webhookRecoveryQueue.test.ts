// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { staleRecoveryRows } from './webhookRecoveryMaintenance';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const mutation = (name: string) => makeFunctionReference<'mutation'>(name);
const begin = mutation('webhookRecoveryQueue:begin');
const advance = mutation('webhookRecoveryQueue:advance');
const enable = mutation('webhookRecoveryQueue:setEnabled');
const repair = mutation('webhookRecoveryQueue:repair');
const status = makeFunctionReference<'query'>('webhookRecoveryQueue:status');
const claim = mutation('cjHelpers:claimWebhookProcessing');
const processed = mutation('cjHelpers:markWebhookProcessed');
const recover = mutation('cjHelpers:recoverStaleWebhookProcessing');
const payload = { type: 'STOCK', params: { vid: 'test', stock: 3 } };
const stale = () => new Date(Date.now() - 31 * 60_000).toISOString();
const base = (messageId: string) => ({ messageId, type: 'STOCK', processedAt: stale(), claimedAt: stale(), status: 'processing' as const, payload });
const makeTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof makeTest>;
async function finish(t: Test) {
  let state = await t.query(status, {});
  for (let n = 0; n < 1000 && state.phase !== 'verified' && state.phase !== 'failed'; n++) {
    state = await t.mutation(advance, { expectedEpoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor });
  }
  expect(state.phase).toBe('verified');
  return state;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('compact webhook recovery queue', () => {
  it('migrates only processing records, guards repeated/stale requests and includes live transitions', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      for (let i = 0; i < 700; i++) await ctx.db.insert('cjWebhookLog', { ...base(`historical-${i}`), status: 'processed', payload: undefined });
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await ctx.db.insert('cjWebhookLog', base(`active-${i}`)));
      return ids;
    });
    await expect(t.mutation(enable, { enabled: true })).rejects.toThrow('Verify recovery queue');
    const first = await t.mutation(begin, {});
    const restarted = await t.mutation(begin, {});
    expect((await t.mutation(advance, { expectedEpoch: first.epoch, expectedPhase: 'backfill', expectedCursor: null })).advanced).toBe(false);
    const args = { expectedEpoch: restarted.epoch, expectedPhase: 'backfill', expectedCursor: null };
    const page = await t.mutation(advance, args);
    expect(page.checked).toBeLessThanOrEqual(2);
    expect((await t.mutation(advance, args)).advanced).toBe(false);
    const renewed = await t.mutation(claim, { messageId: 'active-0', type: 'STOCK' });
    await t.mutation(processed, { messageId: 'active-0', type: 'STOCK', claimToken: renewed.claimToken });
    await t.mutation(claim, { messageId: 'new-live', type: 'STOCK', payload });
    const verified = await finish(t);
    expect(verified.checked).toBeLessThan(25);
    const queue = await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect());
    expect(queue).toHaveLength(5);
    expect(queue.some(row => row.webhookId === ids[0])).toBe(false);
    expect(queue.every(row => !('payload' in row))).toBe(true);
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').collect())).toHaveLength(706);
    await t.mutation(enable, { enabled: true });
    await expect(t.mutation(begin, {})).rejects.toThrow('Disable recovery queue');
  });

  it.each(['markWebhookProcessed', 'markWebhookRetryable', 'markWebhookFailed'])('maintains claim ownership and queue membership through %s', async endpoint => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(claim, { messageId: 'event', type: 'STOCK', payload });
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toHaveLength(1);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const renewed = await t.mutation(claim, { messageId: 'event', type: 'STOCK' });
    const args = { messageId: 'event', type: 'STOCK', ...(endpoint === 'markWebhookRetryable' ? { error: 'temporary failure' } : {}) };
    await t.mutation(mutation(`cjHelpers:${endpoint}`), { ...args, claimToken: first.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toHaveLength(1);
    await t.mutation(mutation(`cjHelpers:${endpoint}`), { ...args, claimToken: renewed.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toHaveLength(0);
    const source = await t.run(ctx => ctx.db.query('cjWebhookLog').unique());
    expect(source?.attempts).toBe(2);
    if (endpoint === 'markWebhookProcessed') expect(source?.payload).toBeUndefined();
    else expect(source?.payload).toEqual(payload);
  });

  it('selects the same bounded stale rows as the old index and schedules each recoverable event once', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert('cjWebhookLog', base('old-one'));
      await ctx.db.insert('cjWebhookLog', base('old-two'));
      await ctx.db.insert('cjWebhookLog', { ...base('missing-claim-time'), claimedAt: undefined });
      await ctx.db.insert('cjWebhookLog', { ...base('exhausted'), attempts: 8 });
      await ctx.db.insert('cjWebhookLog', { ...base('no-payload'), payload: undefined });
      await ctx.db.insert('cjWebhookLog', { ...base('fresh'), claimedAt: new Date().toISOString() });
    });
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const old = await t.run(ctx => staleRecoveryRows(ctx, cutoff, 2));
    await t.mutation(begin, {}); await finish(t); await t.mutation(enable, { enabled: true });
    expect(await t.run(ctx => staleRecoveryRows(ctx, cutoff, 2))).toEqual(old);
    await t.mutation(recover, { limit: 2 });
    await t.mutation(recover, { limit: 50 });
    expect(await t.mutation(recover, { limit: 50 })).toEqual({ scanned: 0, recovered: 0 });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(3);
    const source = await t.run(ctx => ctx.db.query('cjWebhookLog').collect());
    expect(source).toHaveLength(6);
    expect(source.filter(row => row.status === 'retryable')).toHaveLength(3);
    expect(source.filter(row => row.status === 'failed')).toHaveLength(2);
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toHaveLength(1);
    await t.mutation(enable, { enabled: false });
    expect(await t.run(ctx => staleRecoveryRows(ctx, cutoff, 50))).toEqual([]);
  });

  it('refuses orphaned queue entries and permits bounded repair without deleting source history', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', base('entry')));
    await t.mutation(begin, {}); await finish(t);
    await t.run(ctx => ctx.db.patch(id, { status: 'processed' })); // Simulated out-of-band drift.
    await t.mutation(begin, {});
    let state = await t.query(status, {});
    for (let i = 0; i < 10 && state.phase !== 'failed'; i++) state = await t.mutation(advance, { expectedEpoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor });
    expect(state.phase).toBe('failed');
    expect(state.mismatchIds).toEqual([id]);
    await expect(t.mutation(enable, { enabled: true })).rejects.toThrow('Verify recovery queue');
    await t.mutation(repair, { ids: [id] });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'processed', payload });
    await t.mutation(begin, {}); await finish(t); await t.mutation(enable, { enabled: true });
  });
});

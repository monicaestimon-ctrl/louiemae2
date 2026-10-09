// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { staleRecoveryRows, syncRecoveryQueue } from './webhookRecoveryMaintenance';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const mutation = (name: string) => makeFunctionReference<'mutation'>(name);
const initialize = mutation('webhookRecoveryQueue:initializeEmpty');
const begin = mutation('webhookRecoveryQueue:begin');
const advance = mutation('webhookRecoveryQueue:advance');
const enable = mutation('webhookRecoveryQueue:setEnabled');
const repair = mutation('webhookRecoveryQueue:repair');
const status = makeFunctionReference<'query'>('webhookRecoveryQueue:status');
const claim = mutation('cjHelpers:claimWebhookProcessing');
const recover = mutation('cjHelpers:recoverStaleWebhookProcessing');
const payload = { type: 'STOCK', params: { vid: 'test', stock: 3 } };
const stale = () => new Date(Date.now() - 31 * 60_000).toISOString();
const base = (messageId: string) => ({ messageId, type: 'STOCK', processedAt: stale(), claimedAt: stale(), status: 'processing' as const, payload });
const makeTest = () => convexTest(schema, modules);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('webhook recovery after history-index retirement', () => {
  it('initializes only a new empty deployment and leaves an existing verified deployment unchanged', async () => {
    const t = makeTest();
    await expect(t.mutation(recover, {})).rejects.toThrow('WEBHOOK_RECOVERY_QUEUE_NOT_VERIFIED');
    const initial = await t.mutation(initialize, {});
    expect(initial).toMatchObject({ phase: 'verified', enabled: true, checked: 0 });
    await t.mutation(claim, { messageId: 'live', type: 'STOCK', payload });
    expect(await t.mutation(initialize, {})).toEqual(initial);
    expect(await t.mutation(enable, { enabled: true })).toEqual(initial);
    expect(await t.mutation(recover, {})).toEqual({ scanned: 0, recovered: 0 });
  });

  it.each(['source', 'orphan', 'unfinished'])('refuses to bootstrap an unverified %s deployment', async kind => {
    const t = makeTest();
    await t.run(async ctx => {
      if (kind === 'unfinished') {
        await ctx.db.insert('webhookRecoveryState', { key: 'webhook-recovery-v1', epoch: 1, enabled: false, phase: 'source', cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() });
      } else {
        const id = await ctx.db.insert('cjWebhookLog', base('preexisting'));
        if (kind === 'orphan') {
          await syncRecoveryQueue(ctx, id, await ctx.db.get(id));
          await ctx.db.delete(id);
        }
      }
    });
    const before = await t.query(status, {});
    await expect(t.mutation(initialize, {})).rejects.toThrow('Restore cjWebhookLog.by_status_claimed_at');
    expect(await t.query(status, {})).toEqual(before);
    await expect(t.mutation(recover, {})).rejects.toThrow('WEBHOOK_RECOVERY_QUEUE_NOT_VERIFIED');
  });

  it('rejects obsolete migration and disable calls without changing verified state or live leases', async () => {
    const t = makeTest();
    const before = await t.mutation(initialize, {});
    await t.mutation(claim, { messageId: 'live', type: 'STOCK', payload });
    const queue = await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect());
    await expect(t.mutation(begin, {})).rejects.toThrow('Restore cjWebhookLog.by_status_claimed_at');
    await expect(t.mutation(advance, { expectedEpoch: 1, expectedPhase: 'backfill', expectedCursor: null })).rejects.toThrow('Restore cjWebhookLog.by_status_claimed_at');
    await expect(t.mutation(enable, { enabled: false })).rejects.toThrow('Restore cjWebhookLog.by_status_claimed_at');
    expect(await t.query(status, {})).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toEqual(queue);
  });

  it.each(['markWebhookProcessed', 'markWebhookRetryable', 'markWebhookFailed'])('preserves claim ownership and queue membership through %s', async endpoint => {
    const t = makeTest();
    await t.mutation(initialize, {});
    const first = await t.mutation(claim, { messageId: 'event', type: 'STOCK', payload });
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

  it('preserves bounded legacy selection and single retry scheduling without the old index', async () => {
    const t = makeTest();
    await t.mutation(initialize, {});
    await t.run(async ctx => {
      for (let i = 0; i < 700; i++) await ctx.db.insert('cjWebhookLog', { ...base(`history-${i}`), status: 'processed', payload: undefined });
      for (const row of [base('old-one'), base('old-two'), { ...base('missing-claim-time'), claimedAt: undefined },
        { ...base('exhausted'), attempts: 8 }, { ...base('no-payload'), payload: undefined },
        { ...base('fresh'), claimedAt: new Date().toISOString() }]) {
        const id = await ctx.db.insert('cjWebhookLog', row);
        await syncRecoveryQueue(ctx, id, await ctx.db.get(id));
      }
    });
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    // Reference the former index's status/claim-time/creation ordering, without
    // retaining that index in the deployed schema just to make this test pass.
    const expected = await t.run(async ctx => (await ctx.db.query('cjWebhookLog').collect())
      .filter(row => row.status === 'processing' && (row.claimedAt === undefined || row.claimedAt < cutoff))
      .sort((a, b) => (a.claimedAt ?? '').localeCompare(b.claimedAt ?? '') || a._creationTime - b._creationTime));
    expect(await t.run(ctx => staleRecoveryRows(ctx, cutoff, 2))).toEqual(expected.slice(0, 2));
    expect(await t.run(ctx => staleRecoveryRows(ctx, cutoff, 50))).toEqual(expected);
    await t.mutation(recover, { limit: 2 });
    await t.mutation(recover, { limit: 50 });
    expect(await t.mutation(recover, { limit: 50 })).toEqual({ scanned: 0, recovered: 0 });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(3);
    const source = await t.run(ctx => ctx.db.query('cjWebhookLog').collect());
    expect(source).toHaveLength(706);
    expect(source.filter(row => row.status === 'retryable')).toHaveLength(3);
    expect(source.filter(row => row.status === 'failed')).toHaveLength(2);
    expect(await t.run(ctx => ctx.db.query('webhookRecoveryQueue').collect())).toHaveLength(1);
  });

  it('refuses drift and repairs only the requested derived entries without deleting source history', async () => {
    const t = makeTest();
    await t.mutation(initialize, {});
    const id = await t.run(async ctx => {
      const id = await ctx.db.insert('cjWebhookLog', base('entry'));
      await syncRecoveryQueue(ctx, id, await ctx.db.get(id));
      await ctx.db.patch(id, { status: 'processed' }); // Simulate an out-of-band writer.
      return id;
    });
    const cutoff = new Date().toISOString();
    await expect(t.run(ctx => staleRecoveryRows(ctx, cutoff, 50))).rejects.toThrow('WEBHOOK_RECOVERY_QUEUE_DRIFT');
    await expect(t.mutation(repair, { ids: Array(6).fill(id) })).rejects.toThrow('at most five');
    await t.mutation(repair, { ids: [id] });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'processed', payload });
    expect(await t.run(ctx => staleRecoveryRows(ctx, cutoff, 50))).toEqual([]);
  });
});
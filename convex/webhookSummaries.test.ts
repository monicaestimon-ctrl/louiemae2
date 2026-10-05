// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import schema from './schema';
import { mutation as wrappedMutation } from './functions';
import type { Doc } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = { ...import.meta.glob(['./**/*.ts', './_generated/*.js']), './webhookTestHelpers.ts': async () => ({
  change: wrappedMutation({ args: { id: v.id('cjWebhookLog'), remove: v.optional(v.boolean()), abort: v.optional(v.boolean()) }, handler: async (ctx, args) => {
    if (args.remove) await ctx.db.delete(args.id); else await ctx.db.patch(args.id, { status: 'failed' });
    if (args.abort) throw new Error('abort');
  } }),
  payload: wrappedMutation({ args: { id: v.id('cjWebhookLog') }, handler: async (ctx, args) => { await ctx.db.patch(args.id, { payload: { other: 'evidence' }, expiresAt: 0 }); } }),
}) };
const mutation = (name: string) => makeFunctionReference<'mutation'>(`webhookSummaries:${name}`);
const status = makeFunctionReference<'query'>('webhookSummaries:status');
const operations = makeFunctionReference<'query'>('cjSourcingJobs:getAdminOperations');
const claim = makeFunctionReference<'mutation'>('cjHelpers:claimWebhookProcessing');
const processed = makeFunctionReference<'mutation'>('cjHelpers:markWebhookProcessed');
const retryable = makeFunctionReference<'mutation'>('cjHelpers:markWebhookRetryable');
const change = makeFunctionReference<'mutation'>('webhookTestHelpers:change');
const payloadChange = makeFunctionReference<'mutation'>('webhookTestHelpers:payload');
const event = { messageId: 'event', type: 'ORDER', processedAt: '2026-10-01T00:00:00Z', payload: { evidence: 'private supplier payload'.repeat(100) } };
const claimEvent = { messageId: event.messageId, type: event.type, payload: event.payload };
async function finish(t: ReturnType<typeof convexTest>, state: Pick<Doc<'webhookSummaryState'>, 'epoch' | 'phase' | 'cursor'>) {
  for (let i = 0; !['verified', 'failed'].includes(state.phase) && i < 400; i++) state = await t.mutation(mutation('rebuildNext'), { epoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor });
  return state;
}
describe('compact webhook dashboard summaries', () => {
  it('preserves the latest 100 source records and legacy status/date semantics after bounded backfill', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 135; i++) await ctx.db.insert('cjWebhookLog', { ...event, messageId: `event-${i}`,
        status: (['processing', 'processed', 'retryable', 'failed', undefined] as const)[i % 5], claimedAt: i % 3 ? '2026-10-01T00:00:00Z' : 'invalid' });
    });
    const expected = (await t.query(operations, {})).webhook;
    const initial = await t.mutation(mutation('startRebuild'), {});
    let state = await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: initial.phase, expectedCursor: initial.cursor });
    expect(state).toMatchObject({ phase: 'backfill', checked: 5, enabled: false });
    expect(await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: initial.phase, expectedCursor: initial.cursor })).toMatchObject({ advanced: false, checked: 5 });
    state = await finish(t, state);
    expect(state).toMatchObject({ phase: 'verified', enabled: false, checked: 405 });
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect((await t.query(operations, {})).webhook).toEqual(expected);
    const summaries = await t.run(ctx => ctx.db.query('webhookSummaries').collect());
    expect(summaries).toHaveLength(135);
    expect(JSON.stringify(summaries)).not.toContain('private supplier payload');
    for (const row of summaries) expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'sourceCreatedAt', 'status', 'version', 'webhookId', ...(row.claimedAt ? ['claimedAt'] : [])].sort());
    const recentIds = await t.run(async ctx => ({ source: (await ctx.db.query('cjWebhookLog').order('desc').take(100)).map(row => row._id),
      summaries: (await ctx.db.query('webhookSummaries').withIndex('by_source_created').order('desc').take(100)).map(row => row.webhookId) }));
    expect(recentIds.summaries).toEqual(recentIds.source);
  });
  it('maintains claims, retries and success transactionally and keeps unresolved payloads intact', async () => {
    const t = convexTest(schema, modules);
    const state = await t.mutation(mutation('startRebuild'), {});
    const first = await t.mutation(claim, claimEvent);
    await t.mutation(retryable, { messageId: event.messageId, type: event.type, claimToken: first.claimToken, error: 'Try later' });
    await finish(t, state);
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect((await t.query(operations, {})).webhook.counts.retryable).toBe(1);
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').first())).toMatchObject({ payload: event.payload });
    const next = await t.mutation(claim, claimEvent);
    await t.mutation(processed, { messageId: event.messageId, type: event.type, claimToken: first.claimToken });
    expect((await t.query(operations, {})).webhook.counts.processing).toBe(1);
    await t.mutation(processed, { messageId: event.messageId, type: event.type, claimToken: next.claimToken });
    expect((await t.query(operations, {})).webhook.counts.processed).toBe(1);
    const row = (await t.run(ctx => ctx.db.query('cjWebhookLog').first()))!;
    expect(row.payload).toBeUndefined();
    expect(await t.mutation(claim, claimEvent)).toMatchObject({ claimed: false });
    const before = await t.run(ctx => ctx.db.query('webhookSummaries').first());
    await t.mutation(payloadChange, { id: row._id });
    expect(await t.run(ctx => ctx.db.query('webhookSummaries').first())).toEqual(before);
    await expect(t.mutation(change, { id: row._id, abort: true })).rejects.toThrow('abort');
    expect(await t.run(ctx => ctx.db.query('webhookSummaries').first())).toEqual(before);
    await t.mutation(change, { id: row._id, remove: true });
    expect((await t.query(operations, {})).webhook.sampled).toBe(0);
    await t.mutation(mutation('setEnabled'), { enabled: false });
    expect((await t.query(operations, {})).webhook.sampled).toBe(0);
  });
  it('rejects incomplete activation, detects drift/orphans and requires verification after bounded repair', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', event));
    const initial = await t.mutation(mutation('startRebuild'), {});
    let state = await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: 'backfill', expectedCursor: null });
    await t.run(async ctx => { const row = (await ctx.db.query('webhookSummaries').first())!; await ctx.db.patch(row._id, { status: 'failed' }); });
    state = await finish(t, state);
    expect(state).toMatchObject({ phase: 'failed', mismatchIds: [id] });
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    await t.mutation(mutation('repair'), { ids: [id] });
    await t.run(ctx => ctx.db.delete(id)); // Simulates a direct dashboard deletion bypassing triggers.
    state = await finish(t, await t.mutation(mutation('startRebuild'), {}));
    expect(state).toMatchObject({ phase: 'failed', mismatchIds: [id] });
    await t.mutation(mutation('repair'), { ids: [id] });
    expect(await finish(t, await t.mutation(mutation('startRebuild'), {}))).toMatchObject({ phase: 'verified' });
    await expect(t.mutation(mutation('repair'), { ids: [id, id] })).rejects.toThrow('distinct');
    expect(await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: 'backfill', expectedCursor: null })).toMatchObject({ advanced: false });
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(t.query(status, {})).rejects.toThrow('Unauthorized');
  });
});

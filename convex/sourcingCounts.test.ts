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
import { SOURCING_STATES } from './sourcingCountsMaintenance';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const product = { name: 'Chair', price: 90, description: 'Chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
const job = { state: 'queued' as const, generation: 1, sourceSnapshot: { productName: 'Chair', productUrl: 'https://example.com/chair' },
  sourceSnapshotHash: 'hash', attemptCount: 0, transientFailureCount: 0, createdAt: 1, updatedAt: 1, version: 1 };
// Test-only entry points exercise the same transactional wrapper used by every
// production writer; none of these helpers are deployed as public functions.
const modules = { ...import.meta.glob(['./**/*.ts', './_generated/*.js']), './countTestHelpers.ts': async () => ({
  change: wrappedMutation({ args: { id: v.id('cjSourcingJobs'), state: v.optional(v.string()), remove: v.optional(v.boolean()), abort: v.optional(v.boolean()) }, handler: async (ctx, args) => {
    if (args.remove) await ctx.db.delete(args.id);
    else await ctx.db.patch(args.id, { ...(args.state ? { state: args.state as Doc<'cjSourcingJobs'>['state'] } : {}), updatedAt: Date.now() });
    if (args.abort) throw new Error('abort');
  } }),
  insert: wrappedMutation({ args: {}, handler: async ctx => {
    const productId = await ctx.db.insert('products', product);
    return ctx.db.insert('cjSourcingJobs', { ...job, productId });
  } }),
}) };
const mutation = (name: string) => makeFunctionReference<'mutation'>(`sourcingCounts:${name}`);
const status = makeFunctionReference<'query'>('sourcingCounts:status');
const operations = makeFunctionReference<'query'>('cjSourcingJobs:getAdminOperations');
const change = makeFunctionReference<'mutation'>('countTestHelpers:change');
const insert = makeFunctionReference<'mutation'>('countTestHelpers:insert');
async function finish(t: ReturnType<typeof convexTest>, state: Pick<Doc<'sourcingCountState'>, 'epoch' | 'phase' | 'cursor'>) {
  for (let i = 0; !['ready', 'failed'].includes(state.phase) && i < 400; i++) state = await t.mutation(mutation('rebuildNext'), { epoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor });
  return state;
}
describe('transactional sourcing state counts', () => {
  it('counts beyond the old 500 cap and survives backfill retries, transitions, inserts and deletes', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const productId = await ctx.db.insert('products', product);
      const ids = [];
      for (let i = 0; i < 535; i++) ids.push(await ctx.db.insert('cjSourcingJobs', { ...job, productId }));
      return ids;
    });
    expect(await t.query(operations, {})).toMatchObject({ stateCounts: { queued: 500 }, truncatedStates: ['queued'] });
    const initial = await t.mutation(mutation('startRebuild'), {});
    const step = { epoch: initial.epoch, expectedPhase: 'backfill', expectedCursor: null };
    let state = await t.mutation(mutation('rebuildNext'), step);
    expect(state.counts.queued).toBe(25);
    expect(await t.mutation(mutation('rebuildNext'), step)).toMatchObject({ advanced: false, counts: { queued: 25 } });
    await t.mutation(change, { id: ids[0], state: 'processing' });
    await t.mutation(change, { id: ids[530], remove: true });
    const newId = await t.mutation(insert, {});
    state = await finish(t, state);
    expect(state).toMatchObject({ phase: 'ready', enabled: false, counts: { queued: 534, processing: 1 } });
    expect(await t.query(status, {})).toMatchObject({ ready: false });
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect(await t.query(operations, {})).toMatchObject({ stateCounts: { queued: 534, processing: 1 }, truncatedStates: [] });
    await t.mutation(change, { id: newId, state: 'canceled' });
    await t.mutation(change, { id: ids[0], remove: true });
    expect(await t.query(status, {})).toMatchObject({ ready: true, counts: { queued: 533, processing: 0, canceled: 1 } });
    await t.mutation(mutation('setEnabled'), { enabled: false });
    expect(await t.query(operations, {})).toMatchObject({ stateCounts: { queued: 500 }, truncatedStates: ['queued'] });
    // A new epoch repairs drift without counting previous epoch rows twice.
    await t.run(async ctx => { const state = (await ctx.db.query('sourcingCountState').first())!; await ctx.db.patch(state._id, { counts: { ...state.counts, queued: 999 } }); });
    state = await finish(t, await t.mutation(mutation('startRebuild'), {}));
    expect(state).toMatchObject({ phase: 'ready', counts: { queued: 533, processing: 0, canceled: 1 } });
  }, 30_000);
  it('covers every state and avoids writes for lease/timestamp-only updates or repeated states', async () => {
    const t = convexTest(schema, modules);
    await finish(t, await t.mutation(mutation('startRebuild'), {}));
    await t.mutation(mutation('setEnabled'), { enabled: true });
    const id = await t.mutation(insert, {});
    for (const state of SOURCING_STATES) {
      await t.mutation(change, { id, state });
      const summary = await t.query(status, {});
      expect(summary.counts[state]).toBe(1);
      expect(Object.values(summary.counts).reduce((a: number, b) => a + Number(b), 0)).toBe(1);
    }
    const before = await t.run(ctx => ctx.db.query('sourcingCountState').first());
    await t.mutation(change, { id });
    await t.mutation(change, { id, state: 'canceled' });
    expect(await t.run(ctx => ctx.db.query('sourcingCountState').first())).toEqual(before);
    await expect(t.mutation(change, { id, state: 'processing', abort: true })).rejects.toThrow('abort');
    expect(await t.run(ctx => ctx.db.query('sourcingCountState').first())).toEqual(before);
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ state: 'canceled' });
  });
  it('restarts verification after live changes, rejects stale activation, and fails closed on drift', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    let state = await t.mutation(mutation('startRebuild'), {});
    const id = await t.mutation(insert, {});
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    state = await finish(t, state);
    await t.mutation(change, { id, state: 'processing' });
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    await t.mutation(mutation('verifyAgain'), {});
    await t.mutation(change, { id, state: 'submitted' });
    state = (await t.run(ctx => ctx.db.query('sourcingCountState').first()))!;
    expect(await t.mutation(mutation('rebuildNext'), { epoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor })).toMatchObject({ verificationRestarted: true });
    state = await finish(t, state);
    expect(state).toMatchObject({ phase: 'ready', counts: { submitted: 1 } });
    await t.run(async ctx => { await ctx.db.patch(id, { state: 'rejected' }); }); // Simulated unwrapped writer.
    await t.mutation(mutation('verifyAgain'), {});
    state = (await t.run(ctx => ctx.db.query('sourcingCountState').first()))!;
    expect(await finish(t, state)).toMatchObject({ phase: 'failed', enabled: false });
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    const restarted = await t.mutation(mutation('startRebuild'), {});
    expect(await t.mutation(mutation('rebuildNext'), { epoch: state.epoch, expectedPhase: 'backfill', expectedCursor: null })).toMatchObject({ epoch: restarted.epoch, advanced: false });
  });
  it('requires admin access for counts and keeps the existing dashboard contract', async () => {
    const t = convexTest(schema, modules);
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(t.query(status, {})).rejects.toThrow('Unauthorized');
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(t.query(operations, {})).rejects.toThrow('Unauthorized');
    expect(await t.query(operations, {})).toMatchObject({ jobs: [], control: null, workerRuns: [], webhook: { sampled: 0 }, migration: { truncated: false } });
  });
  it('maintains counts through the real dispatcher without dispatching invalid or uncorrelated work', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const productId = await ctx.db.insert('products', product);
      await ctx.db.insert('cjSourcingJobs', { ...job, productId, nextAttemptAt: 1 });
      await ctx.db.insert('cjSourcingJobs', { ...job, productId, state: 'submitted', nextAttemptAt: 1 });
    });
    await finish(t, await t.mutation(mutation('startRebuild'), {}));
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect(await t.mutation(makeFunctionReference<'mutation'>('cjSourcingJobs:dispatchDueJobs'), {})).toMatchObject({ claimed: 0 });
    expect(await t.query(status, {})).toMatchObject({ ready: true, counts: { queued: 0, submitted: 0, needs_input: 1, reconciliation_required: 1 } });
  });
});

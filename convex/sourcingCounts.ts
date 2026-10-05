import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { catalogPageOptions } from '../lib/catalogPagination';
import { sameCatalogValue } from '../lib/catalogProjection';
import { emptySourcingCounts, getSourcingCountState, SOURCING_COUNTS_VERSION, syncSourcingCount } from './sourcingCountsMaintenance';

export const status = query({ args: {}, handler: async ctx => {
  await requireCjAdminIdentity(ctx);
  const state = await getSourcingCountState(ctx);
  const ready = state?.enabled === true && state.phase === 'ready' && state.version === SOURCING_COUNTS_VERSION;
  return { ready, phase: state?.phase ?? 'not_started', verifiedAt: state?.verifiedAt, counts: ready ? state.counts : undefined };
} });

export const startRebuild = internalMutation({ args: {}, handler: async ctx => {
  const state = await getSourcingCountState(ctx);
  const next = { key: 'primary', epoch: (state?.epoch ?? 0) + 1, version: SOURCING_COUNTS_VERSION, enabled: false,
    phase: 'backfill' as const, cursor: null, counts: emptySourcingCounts(), revision: 0,
    verificationRevision: 0, checkedCounts: emptySourcingCounts(), mismatchIds: [], updatedAt: Date.now() };
  if (state) await ctx.db.replace(state._id, next); else await ctx.db.insert('sourcingCountState', next);
  return next;
} });

export const rebuildNext = internalMutation({ args: {
  epoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('orphans'), v.literal('verify')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async (ctx, args) => {
  const state = await getSourcingCountState(ctx);
  if (!state) throw new Error('Start a sourcing count rebuild first.');
  if (args.epoch !== state.epoch || args.expectedPhase !== state.phase || args.expectedCursor !== state.cursor) return { ...state, advanced: false };
  const updatedAt = Date.now();
  if (state.phase === 'backfill') {
    const batch = await ctx.db.query('cjSourcingJobs').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 25 }, 25));
    for (const job of batch.page) await syncSourcingCount(ctx, job._id, job);
    await ctx.db.patch(state._id, { cursor: batch.isDone ? null : batch.continueCursor, phase: batch.isDone ? 'orphans' : 'backfill', updatedAt });
  } else if (state.phase === 'orphans') {
    const batch = await ctx.db.query('sourcingCountRows').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 25 }, 25));
    for (const row of batch.page) await syncSourcingCount(ctx, row.jobId, await ctx.db.get(row.jobId));
    const current = (await ctx.db.get(state._id))!;
    await ctx.db.patch(state._id, { cursor: batch.isDone ? null : batch.continueCursor, phase: batch.isDone ? 'verify' : 'orphans',
      verificationRevision: current.revision, checkedCounts: emptySourcingCounts(), updatedAt });
  } else {
    if (state.verificationRevision !== state.revision) {
      await ctx.db.patch(state._id, { cursor: null, checkedCounts: emptySourcingCounts(), verificationRevision: state.revision, updatedAt });
      return { ...(await ctx.db.get(state._id)), advanced: false, verificationRestarted: true };
    }
    const batch = await ctx.db.query('cjSourcingJobs').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 25 }, 25));
    const checkedCounts = { ...state.checkedCounts };
    const mismatches: string[] = [];
    for (const job of batch.page) {
      const row = await ctx.db.query('sourcingCountRows').withIndex('by_job', q => q.eq('jobId', job._id)).unique();
      if (row?.epoch !== state.epoch || row.state !== job.state) mismatches.push(job._id);
      checkedCounts[job.state]++;
    }
    if (batch.isDone && !sameCatalogValue(checkedCounts, state.counts)) mismatches.push('aggregate_totals');
    await ctx.db.patch(state._id, { cursor: batch.isDone || mismatches.length ? null : batch.continueCursor,
      phase: mismatches.length ? 'failed' : batch.isDone ? 'ready' : 'verify', checkedCounts, mismatchIds: mismatches, updatedAt,
      ...(batch.isDone && !mismatches.length ? { verifiedAt: updatedAt } : {}) });
  }
  return { ...(await ctx.db.get(state._id)), advanced: true };
} });

export const verifyAgain = internalMutation({ args: {}, handler: async ctx => {
  const state = await getSourcingCountState(ctx);
  if (!state || ['backfill', 'orphans'].includes(state.phase)) throw new Error('Complete the rebuild first.');
  await ctx.db.patch(state._id, { enabled: false, phase: 'verify', cursor: null, checkedCounts: emptySourcingCounts(),
    verificationRevision: state.revision, mismatchIds: [], updatedAt: Date.now() });
} });
export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const state = await getSourcingCountState(ctx);
  if (!state) { if (args.enabled) throw new Error('Verify sourcing counts first.'); return; }
  if (args.enabled && (state.phase !== 'ready' || state.version !== SOURCING_COUNTS_VERSION || state.verificationRevision !== state.revision)) throw new Error('Verify sourcing counts first.');
  await ctx.db.patch(state._id, { enabled: args.enabled, updatedAt: Date.now() });
} });

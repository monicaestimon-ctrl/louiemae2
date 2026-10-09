import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { catalogPageOptions } from '../lib/catalogPagination';
import { getRecoveryQueueState, RECOVERY_QUEUE_KEY, recoveryProjection, syncRecoveryQueue } from './webhookRecoveryMaintenance';

export const status = internalQuery({ args: {}, handler: getRecoveryQueueState });
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await getRecoveryQueueState(ctx);
  if (old?.enabled) throw new Error('Disable recovery queue before rebuilding.');
  const state = { key: RECOVERY_QUEUE_KEY, epoch: (old?.epoch ?? 0) + 1, enabled: false,
    phase: 'backfill' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, state); else await ctx.db.insert('webhookRecoveryState', state);
  return state;
} });
export const advance = internalMutation({ args: {
  expectedEpoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('source'), v.literal('orphans')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async (ctx, args) => {
  const state = await getRecoveryQueueState(ctx);
  if (!state) throw new Error('Begin recovery queue migration first.');
  if (state.epoch !== args.expectedEpoch || state.phase !== args.expectedPhase || state.cursor !== args.expectedCursor) return { ...state, advanced: false };
  const mismatchIds: string[] = [];
  let cursor: string; let done: boolean; let checked: number;
  if (state.phase === 'backfill' || state.phase === 'source') {
    // Only active processing records, never the full historical webhook table.
    const page = await ctx.db.query('cjWebhookLog').withIndex('by_status_claimed_at', q => q.eq('status', 'processing'))
      .paginate(catalogPageOptions({ cursor: state.cursor, numItems: 2 }, 2, 2_000_000));
    for (const source of page.page) {
      if (state.phase === 'backfill') await syncRecoveryQueue(ctx, source._id, source);
      else {
        const entry = await ctx.db.query('webhookRecoveryQueue').withIndex('by_webhook', q => q.eq('webhookId', source._id)).unique();
        if (!entry || entry.claimedAt !== source.claimedAt || entry.sourceCreatedAt !== source._creationTime) mismatchIds.push(source._id);
      }
    }
    cursor = page.continueCursor; done = page.isDone; checked = page.page.length;
  } else {
    const page = await ctx.db.query('webhookRecoveryQueue').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 2 }, 2, 2_000_000));
    for (const entry of page.page) {
      const source = await ctx.db.get(entry.webhookId);
      const expected = recoveryProjection(source);
      if (!expected || entry.claimedAt !== expected.claimedAt || entry.sourceCreatedAt !== expected.sourceCreatedAt) mismatchIds.push(entry.webhookId);
    }
    cursor = page.continueCursor; done = page.isDone; checked = page.page.length;
  }
  const phase = mismatchIds.length ? 'failed' as const : done
    ? state.phase === 'backfill' ? 'source' as const : state.phase === 'source' ? 'orphans' as const : 'verified' as const
    : state.phase;
  const next = { phase, cursor: done || mismatchIds.length ? null : cursor, checked: state.checked + checked, mismatchIds, updatedAt: Date.now() };
  await ctx.db.patch(state._id, next);
  return { ...state, ...next, advanced: true };
} });
export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const state = await getRecoveryQueueState(ctx);
  if (!state || (args.enabled && state.phase !== 'verified')) throw new Error('Verify recovery queue before enabling.');
  await ctx.db.patch(state._id, { enabled: args.enabled, updatedAt: Date.now() });
} });
export const repair = internalMutation({ args: { ids: v.array(v.id('cjWebhookLog')) }, handler: async (ctx, args) => {
  if (args.ids.length > 5) throw new Error('Repair at most five webhook identities per call.');
  for (const id of new Set(args.ids)) await syncRecoveryQueue(ctx, id, await ctx.db.get(id));
} });

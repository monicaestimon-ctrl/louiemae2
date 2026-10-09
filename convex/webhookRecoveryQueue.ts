import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { getRecoveryQueueState, RECOVERY_QUEUE_KEY, syncRecoveryQueue } from './webhookRecoveryMaintenance';

const RESTORE_INDEX = 'Restore cjWebhookLog.by_status_claimed_at and the PR168 migration functions before disabling or rebuilding recovery. Index backfill must finish first.';
export const status = internalQuery({ args: {}, handler: getRecoveryQueueState });

// Keep old operator calls explicit and harmless after retirement. Never turn an
// obsolete migration command into an unbounded history scan or disable recovery.
export const begin = internalMutation({ args: {}, handler: async () => { throw new Error(RESTORE_INDEX); } });
export const advance = internalMutation({ args: {
  expectedEpoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('source'), v.literal('orphans')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async () => { throw new Error(RESTORE_INDEX); } });

// New empty deployments can establish coverage atomically before receiving
// webhooks. Existing deployments must arrive with PR168 verification complete.
export const initializeEmpty = internalMutation({ args: {}, handler: async ctx => {
  const old = await getRecoveryQueueState(ctx);
  if (old?.enabled && old.phase === 'verified') return old;
  if (old || await ctx.db.query('cjWebhookLog').first() || await ctx.db.query('webhookRecoveryQueue').first()) {
    throw new Error(RESTORE_INDEX);
  }
  const state = { key: RECOVERY_QUEUE_KEY, epoch: 1, enabled: true,
    phase: 'verified' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  const id = await ctx.db.insert('webhookRecoveryState', state);
  return ctx.db.get(id);
} });

export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  if (!args.enabled) throw new Error(RESTORE_INDEX);
  // There is no longer a cheap legacy reader. Preserve the verified state on
  // both old disable requests and unverified activation attempts.
  const state = await getRecoveryQueueState(ctx);
  if (!state?.enabled || state.phase !== 'verified') throw new Error(RESTORE_INDEX);
  return state;
} });
export const repair = internalMutation({ args: { ids: v.array(v.id('cjWebhookLog')) }, handler: async (ctx, args) => {
  if (args.ids.length > 5) throw new Error('Repair at most five webhook identities per call.');
  for (const id of new Set(args.ids)) await syncRecoveryQueue(ctx, id, await ctx.db.get(id));
} });
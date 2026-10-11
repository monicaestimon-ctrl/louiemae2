import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { EXPIRY_KEY, expiryState, syncExpiry } from './webhookExpiryMaintenance';
const RESTORE = 'Restore cjWebhookLog.by_expiry and the PR176 migration before rebuilding expiry coverage. Wait for index backfill first.';
export const status = internalQuery({ args: {}, handler: expiryState });
export const begin = internalMutation({ args: {}, handler: async () => { throw new Error(RESTORE); } });
export const advance = internalMutation({ args: {
  expectedEpoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('source'), v.literal('queue')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async () => { throw new Error(RESTORE); } });
export const initializeEmpty = internalMutation({ args: {}, handler: async ctx => {
  const old = await expiryState(ctx);
  if (old?.phase === 'verified') return old;
  if (old || await ctx.db.query('cjWebhookLog').first() || await ctx.db.query('webhookExpiryQueue').first()) throw new Error(RESTORE);
  const id = await ctx.db.insert('webhookExpiryState', { key: EXPIRY_KEY, epoch: 1, phase: 'verified', cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() });
  return ctx.db.get(id);
} });
export const repair = internalMutation({ args: { ids: v.array(v.id('cjWebhookLog')) }, handler: async (ctx, args) => {
  if (args.ids.length > 5) throw new Error('Repair at most five webhook identities.');
  for (const id of new Set(args.ids)) await syncExpiry(ctx, id, await ctx.db.get(id));
} });

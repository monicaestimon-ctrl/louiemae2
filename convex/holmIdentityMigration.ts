import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { catalogPageOptions } from '../lib/catalogPagination';
import { HOLM_IDENTITY_VERSION, holmIdentityState, holmIdentityProjection, sameHolmIdentity, syncHolmIdentity, type HolmIdentity } from './holmIdentityMaintenance';

/** Resume preparation after an interrupted operator session without restarting or advancing it. */
export const status = internalQuery({ args: {}, handler: async ctx => {
  const current = await holmIdentityState(ctx);
  return current ? { version: current.version, enabled: current.enabled, phase: current.phase,
    cursor: current.cursor, checked: current.checked, mismatchIds: current.mismatchIds, updatedAt: current.updatedAt } : null;
} });

/** Prepare both source and index verification before enabling old saved-ID resolution. */
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await holmIdentityState(ctx);
  const next = { version: HOLM_IDENTITY_VERSION, enabled: false, phase: 'listings' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, next); else await ctx.db.insert('holmIdentityState', next);
  return next;
} });
export const step = internalMutation({
  args: { expectedPhase: v.string(), expectedCursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const current = await holmIdentityState(ctx);
    if (!current) throw new Error('Begin identity preparation first.');
    if (current.phase !== args.expectedPhase || current.cursor !== args.expectedCursor || ['verified', 'failed'].includes(current.phase)) return { ...current, advanced: false };
    const options = catalogPageOptions({ numItems: 20, cursor: current.cursor }, 20, 1_000_000);
    const verify = current.phase.startsWith('verify');
    const mismatchIds: string[] = [];
    const apply = async (listingId: HolmIdentity['listingId'], expected: HolmIdentity | null) => {
      if (!verify) return syncHolmIdentity(ctx, listingId, expected);
      const actual = await ctx.db.query('holmCatalogIdentities').withIndex('by_listing', query => query.eq('listingId', listingId)).unique();
      if (!sameHolmIdentity(actual, expected)) mismatchIds.push(listingId);
    };
    let cursor: string; let done: boolean; let checked: number;
    if (current.phase === 'listings' || current.phase === 'verifyListings') {
      const batch = await ctx.db.query('commerceListings').withIndex('by_channel_published', query => query.eq('channel', 'house')).paginate(options);
      for (const listing of batch.page) await apply(listing._id, holmIdentityProjection(listing));
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    } else {
      const batch = await ctx.db.query('holmCatalogIdentities').paginate(options);
      for (const row of batch.page) await apply(row.listingId, holmIdentityProjection(await ctx.db.get(row.listingId)));
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    }
    const following = { listings: 'orphans', orphans: 'verifyListings', verifyListings: 'verifyIndex', verifyIndex: 'verified' } as const;
    const next = { phase: mismatchIds.length ? 'failed' as const : done ? following[current.phase as keyof typeof following] : current.phase,
      cursor: done || mismatchIds.length ? null : cursor, checked: current.checked + checked, mismatchIds, enabled: false, updatedAt: Date.now() };
    await ctx.db.patch(current._id, next);
    return { ...current, ...next, advanced: true };
  },
});
export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const current = await holmIdentityState(ctx);
  if (!current || (args.enabled && current.phase !== 'verified')) throw new Error('Verify the identity index before enabling it.');
  await ctx.db.patch(current._id, { enabled: args.enabled, updatedAt: Date.now() });
} });

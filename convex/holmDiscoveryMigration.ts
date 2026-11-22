import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { catalogPageOptions } from '../lib/catalogPagination';
import { HOLM_DISCOVERY_VERSION, discoveryState, discoveryProjection, sameDiscovery, syncDiscovery, type DiscoveryProjection } from './holmDiscoveryMaintenance';

/** Resume preparation after an interrupted operator session without restarting or advancing it. */
export const status = internalQuery({ args: {}, handler: async ctx => {
  const current = await discoveryState(ctx);
  return current ? { version: current.version, generation: current.generation, phase: current.phase,
    cursor: current.cursor, checked: current.checked, mismatchIds: current.mismatchIds, updatedAt: current.updatedAt,
    readerEnabled: current.readerEnabled ?? false, readerOfferGeneration: current.readerOfferGeneration ?? null } : null;
} });

/** Prepare and verify derived discovery metadata. This does not activate a customer reader. */
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await discoveryState(ctx);
  if (old?.readerEnabled) throw new Error('Disable the discovery reader before preparing another generation.');
  const next = { version: HOLM_DISCOVERY_VERSION, generation: (old?.generation ?? 0) + 1, readerEnabled: false, phase: 'listings' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, next); else await ctx.db.insert('holmDiscoveryState', next);
  return next;
} });
export const step = internalMutation({
  args: { expectedGeneration: v.number(), expectedPhase: v.string(), expectedCursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const current = await discoveryState(ctx);
    if (!current) throw new Error('Begin discovery preparation first.');
    if (current.generation !== args.expectedGeneration || current.phase !== args.expectedPhase || current.cursor !== args.expectedCursor || ['verified', 'failed'].includes(current.phase)) return { ...current, advanced: false };
    const options = catalogPageOptions({ numItems: 20, cursor: current.cursor }, 20, 1_000_000);
    const verify = current.phase.startsWith('verify');
    const mismatchIds: string[] = [];
    const apply = async (listingId: DiscoveryProjection['listingId'], expected: DiscoveryProjection | null) => {
      if (!verify) return syncDiscovery(ctx, listingId, expected);
      const actual = await ctx.db.query('holmDiscoveryIndex').withIndex('by_listing', query => query.eq('listingId', listingId)).unique();
      if (!sameDiscovery(actual, expected)) mismatchIds.push(listingId);
    };
    let cursor: string; let done: boolean; let checked: number;
    if (current.phase === 'listings' || current.phase === 'verifyListings') {
      const batch = await ctx.db.query('commerceListings').withIndex('by_channel_published', query => query.eq('channel', 'house')).paginate(options);
      for (const listing of batch.page) await apply(listing._id, discoveryProjection(listing));
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    } else {
      const batch = await ctx.db.query('holmDiscoveryIndex').paginate(options);
      for (const row of batch.page) await apply(row.listingId, discoveryProjection(await ctx.db.get(row.listingId)));
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    }
    const following = { listings: 'orphans', orphans: 'verifyListings', verifyListings: 'verifyIndex', verifyIndex: 'verified' } as const;
    const next = { phase: mismatchIds.length ? 'failed' as const : done ? following[current.phase as keyof typeof following] : current.phase,
      cursor: done || mismatchIds.length ? null : cursor, checked: current.checked + checked, mismatchIds, updatedAt: Date.now() };
    await ctx.db.patch(current._id, next);
    return { ...current, ...next, advanced: true };
  },
});


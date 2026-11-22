import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { catalogPageOptions } from '../lib/catalogPagination';
import { sameCatalogValue } from '../lib/catalogProjection';
import { discoveryOffers, syncDiscoveryOffers } from './holmDiscoveryOffers';

const VERSION = 1;
const state = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('holmDiscoveryOfferState').withIndex('by_version', q => q.eq('version', VERSION)).unique();

/** Internal candidate preparation only. Never authorizes a customer reader or checkout. */
export const status = internalQuery({ args: {}, handler: async ctx => state(ctx) });
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await state(ctx);
  const next = { version: VERSION, generation: (old?.generation ?? 0) + 1, phase: 'listings' as const,
    cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, next); else await ctx.db.insert('holmDiscoveryOfferState', next);
  return next;
} });
export const step = internalMutation({
  args: { expectedGeneration: v.number(), expectedPhase: v.string(), expectedCursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const current = await state(ctx);
    if (!current) throw new Error('Begin discovery offer preparation first.');
    if (current.generation !== args.expectedGeneration || current.phase !== args.expectedPhase || current.cursor !== args.expectedCursor
      || ['verified', 'failed'].includes(current.phase)) return { ...current, advanced: false };
    const options = catalogPageOptions({ numItems: 20, cursor: current.cursor }, 20, 1_000_000);
    const verify = current.phase.startsWith('verify');
    const mismatchIds: string[] = [];
    const apply = async (listingId: Id<'commerceListings'>) => {
      if (!verify) return syncDiscoveryOffers(ctx, listingId);
      const listing = await ctx.db.get(listingId);
      const expected = (listing ? await discoveryOffers(ctx, listing) : []).sort((a, b) => a.variantId.localeCompare(b.variantId));
      const actual = (await ctx.db.query('holmDiscoveryOffers').withIndex('by_listing', q => q.eq('listingId', listingId)).collect())
        .map(({ _id, _creationTime, ...value }) => { void _id; void _creationTime; return value; })
        .sort((a, b) => a.variantId.localeCompare(b.variantId));
      if (!sameCatalogValue(actual, expected)) mismatchIds.push(listingId);
    };
    let cursor: string; let done: boolean; let checked: number;
    if (current.phase === 'listings' || current.phase === 'verifyListings') {
      const batch = await ctx.db.query('commerceListings').withIndex('by_channel_published', q => q.eq('channel', 'house')).paginate(options);
      for (const listing of batch.page) await apply(listing._id);
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    } else {
      const batch = await ctx.db.query('holmDiscoveryOffers').paginate(options);
      for (const listingId of new Set(batch.page.map(row => row.listingId))) await apply(listingId);
      cursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    }
    const following = { listings: 'orphans', orphans: 'verifyListings', verifyListings: 'verifyIndex', verifyIndex: 'verified' } as const;
    const next = { phase: mismatchIds.length ? 'failed' as const : done ? following[current.phase as keyof typeof following] : current.phase,
      cursor: done || mismatchIds.length ? null : cursor, checked: current.checked + checked, mismatchIds, updatedAt: Date.now() };
    await ctx.db.patch(current._id, next);
    return { ...current, ...next, advanced: true };
  },
});

import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import {
  legacySearchProjection,
  listingSearchProjection,
  PUBLIC_SEARCH_VERSION,
  sameSearchProjection,
  syncPublicSearch,
  type SearchProjection,
} from './publicSearchMaintenance';
import { catalogPageOptions } from '../lib/catalogPagination';

const state = (ctx: Pick<QueryCtx, 'db'>) =>
  ctx.db
    .query('publicSearchState')
    .withIndex('by_version', (q) => q.eq('version', PUBLIC_SEARCH_VERSION))
    .unique();
async function expectedRow(ctx: Pick<QueryCtx, 'db'>, row: Doc<'publicSearch'>) {
  if (row.sourceKey.startsWith('legacy:')) {
    const id = ctx.db.normalizeId('products', row.sourceKey.slice(7));
    return id ? legacySearchProjection(await ctx.db.get(id)) : null;
  }
  const id =
    row.sourceKey.startsWith('listing:') &&
    ctx.db.normalizeId('commerceListings', row.sourceKey.slice(8));
  return id ? listingSearchProjection(await ctx.db.get(id)) : null;
}

/** Restart a bounded backfill and verification pass; never enable an unverified index. */
export const begin = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await state(ctx);
    const next = {
      version: PUBLIC_SEARCH_VERSION,
      enabled: false,
      phase: 'legacy' as const,
      cursor: null,
      checked: 0,
      mismatchIds: [],
      updatedAt: Date.now(),
    };
    if (old) await ctx.db.replace(old._id, next);
    else await ctx.db.insert('publicSearchState', next);
    return next;
  },
});

/** Expected phase/cursor makes retries idempotent and avoids skipping concurrent batches. */
export const step = internalMutation({
  args: { expectedPhase: v.string(), expectedCursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const current = await state(ctx);
    if (!current) throw new Error('Start public search preparation first.');
    if (
      current.phase !== args.expectedPhase ||
      current.cursor !== args.expectedCursor ||
      ['verified', 'failed'].includes(current.phase)
    )
      return { ...current, advanced: false };
    const options = catalogPageOptions({ numItems: 5, cursor: current.cursor }, 5, 2_000_000);
    const mismatches: string[] = [];
    const verify = current.phase.startsWith('verify');
    const apply = async (key: string, expected: SearchProjection | null) => {
      if (!verify) return syncPublicSearch(ctx, key, expected);
      const actual = await ctx.db
        .query('publicSearch')
        .withIndex('by_source', (q) => q.eq('sourceKey', key))
        .unique();
      if (!sameSearchProjection(actual, expected)) mismatches.push(key);
    };
    let cursor: string;
    let done: boolean;
    let checked: number;
    if (['legacy', 'verifyLegacy'].includes(current.phase)) {
      const batch = await ctx.db.query('products').paginate(options);
      for (const p of batch.page) await apply(`legacy:${p._id}`, legacySearchProjection(p));
      cursor = batch.continueCursor;
      done = batch.isDone;
      checked = batch.page.length;
    } else if (['listings', 'verifyListings'].includes(current.phase)) {
      const batch = await ctx.db.query('commerceListings').paginate(options);
      for (const p of batch.page) await apply(`listing:${p._id}`, listingSearchProjection(p));
      cursor = batch.continueCursor;
      done = batch.isDone;
      checked = batch.page.length;
    } else {
      const batch = await ctx.db.query('publicSearch').paginate(options);
      for (const row of batch.page) await apply(row.sourceKey, await expectedRow(ctx, row));
      cursor = batch.continueCursor;
      done = batch.isDone;
      checked = batch.page.length;
    }
    const nextPhase = {
      legacy: 'listings',
      listings: 'orphans',
      orphans: 'verifyLegacy',
      verifyLegacy: 'verifyListings',
      verifyListings: 'verifyIndex',
      verifyIndex: 'verified',
      verified: 'verified',
      failed: 'failed',
    } as const;
    const next = {
      phase: mismatches.length
        ? ('failed' as const)
        : done
          ? nextPhase[current.phase]
          : current.phase,
      cursor: done || mismatches.length ? null : cursor,
      checked: current.checked + checked,
      mismatchIds: mismatches,
      enabled: false,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(current._id, next);
    return { ...current, ...next, advanced: true };
  },
});

export const setEnabled = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const current = await state(ctx);
    if (!current || (args.enabled && current.phase !== 'verified'))
      throw new Error('Verify both source tables and index before enabling public search.');
    await ctx.db.patch(current._id, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

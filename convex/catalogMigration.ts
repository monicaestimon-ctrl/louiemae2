import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { syncCatalogProduct } from './catalogMaintenance';
import { CATALOG_VERSION, catalogProjection, sameCatalogValue } from '../lib/catalogProjection';
import { catalogPageOptions } from '../lib/catalogPagination';

const key = `catalog-v${CATALOG_VERSION}`;
const cursorValidator = v.union(v.string(), v.null());

/** Operator-driven, resumable migration. This does not enable any readers. */
export const backfill = internalMutation({
  args: { expectedCursor: cursorValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('catalogMigrations').withIndex('by_key', q => q.eq('key', key)).unique();
    if (state?.complete) return { ...state, advanced: false };
    const cursor = state?.cursor ?? null;
    // Concurrent/retried callers cannot advance a second page accidentally.
    if (cursor !== args.expectedCursor) return { ...state, advanced: false };
    // Reserve room for source records and existing summaries during repair.
    const limit = Math.min(5, Math.max(1, Math.floor(args.limit ?? 5)));
    const batch = await ctx.db.query('products').paginate(catalogPageOptions({ cursor, numItems: limit }, 5, 2_000_000));
    for (const product of batch.page) await syncCatalogProduct(ctx, product._id, product);
    const next = { key, version: CATALOG_VERSION, cursor: batch.continueCursor,
      processed: (state?.processed ?? 0) + batch.page.length, complete: batch.isDone, updatedAt: Date.now() };
    if (state) await ctx.db.replace(state._id, next);
    else await ctx.db.insert('catalogMigrations', next);
    return { ...next, advanced: true };
  },
});

/** Bounded source-to-summary check; a completed backfill is not proof of parity. */
export const verifyPage = internalQuery({
  args: { cursor: cursorValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.query('products').paginate(catalogPageOptions({ cursor: args.cursor, numItems: 5 }, 5, 2_000_000));
    const mismatches: string[] = [];
    for (const product of batch.page) {
      const summary = await ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', product._id)).unique();
      if (!summary) { mismatches.push(product._id); continue; }
      const projection = Object.fromEntries(Object.entries(summary).filter(([key]) => key !== '_id' && key !== '_creationTime'));
      if (!sameCatalogValue(projection, catalogProjection(product))) mismatches.push(product._id);
    }
    return { checked: batch.page.length, mismatches, cursor: batch.continueCursor, complete: batch.isDone };
  },
});

/** Separate bounded pass detects orphan projections without exposing product data. */
export const verifyOrphans = internalQuery({
  args: { cursor: cursorValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.query('productCatalog').paginate({ cursor: args.cursor, numItems: 25 });
    const orphanIds: string[] = [];
    for (const row of batch.page) if (!await ctx.db.get(row.productId)) orphanIds.push(row.productId);
    return { checked: batch.page.length, orphanIds, cursor: batch.continueCursor, complete: batch.isDone };
  },
});

import { v, ConvexError } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { CATALOG_VERSION, catalogProjection, sameCatalogValue } from '../lib/catalogProjection';
import { syncCatalogProduct } from './catalogMaintenance';
import { catalogPageOptions } from '../lib/catalogPagination';

export async function catalogIsReady(ctx: Pick<QueryCtx, 'db'>) {
  const state = await ctx.db.query('catalogReadiness').withIndex('by_version', q => q.eq('version', CATALOG_VERSION)).unique();
  return state?.enabled === true && state.phase === 'verified';
}
export async function requireCatalogReady(ctx: Pick<QueryCtx, 'db'>) {
  if (!await catalogIsReady(ctx)) throw new ConvexError({ code: 'CATALOG_NOT_READY', message: 'Catalog preparation is not complete.' });
}
export const status = query({ args: {}, handler: async ctx => ({ ready: await catalogIsReady(ctx), version: CATALOG_VERSION }) });

// Explicitly restartable, bounded verification. Starting a new pass disables
// readers until both directions pass and an operator enables them again.
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const migration = await ctx.db.query('catalogMigrations').withIndex('by_key', q => q.eq('key', `catalog-v${CATALOG_VERSION}`)).unique();
  if (!migration?.complete) throw new Error('Complete the catalog backfill before verification.');
  const old = await ctx.db.query('catalogReadiness').withIndex('by_version', q => q.eq('version', CATALOG_VERSION)).unique();
  const state = { version: CATALOG_VERSION, enabled: false, phase: 'source' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now() };
  if (old) await ctx.db.replace(old._id, state);
  else await ctx.db.insert('catalogReadiness', state);
  return state;
} });

export const verifyNext = internalMutation({
  args: { expectedPhase: v.union(v.literal('source'), v.literal('orphans')), expectedCursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('catalogReadiness').withIndex('by_version', q => q.eq('version', CATALOG_VERSION)).unique();
    if (!state) throw new Error('Start verification first.');
    if (state.phase !== args.expectedPhase || state.cursor !== args.expectedCursor) return { ...state, advanced: false };
    const mismatches: string[] = [];
    let nextCursor: string | null;
    let done: boolean;
    let checked: number;
    if (state.phase === 'source') {
      const batch = await ctx.db.query('products').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5, 2_000_000));
      for (const product of batch.page) {
        const row = await ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', product._id)).unique();
        const projection = row && Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id' && key !== '_creationTime'));
        if (!row || !sameCatalogValue(projection, catalogProjection(product))) mismatches.push(product._id);
      }
      nextCursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    } else {
      // Five source lookups also keep the orphan pass bounded for large records.
      const batch = await ctx.db.query('productCatalog').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5));
      for (const row of batch.page) if (!await ctx.db.get(row.productId)) mismatches.push(row.productId);
      nextCursor = batch.continueCursor; done = batch.isDone; checked = batch.page.length;
    }
    const phase = mismatches.length ? 'failed' as const : done ? (state.phase === 'source' ? 'orphans' as const : 'verified' as const) : state.phase;
    const next = { phase, cursor: done || mismatches.length ? null : nextCursor, checked: state.checked + checked,
      mismatchIds: mismatches, enabled: false, updatedAt: Date.now() };
    await ctx.db.patch(state._id, next);
    return { ...state, ...next, advanced: true };
  },
});

export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const state = await ctx.db.query('catalogReadiness').withIndex('by_version', q => q.eq('version', CATALOG_VERSION)).unique();
  if (!state) { if (args.enabled) throw new Error('Verify catalog integrity before enabling readers.'); return; }
  if (args.enabled && state.phase !== 'verified') throw new Error('Verify catalog integrity before enabling readers.');
  await ctx.db.patch(state._id, { enabled: args.enabled, updatedAt: Date.now() });
} });

export const repair = internalMutation({ args: { productIds: v.array(v.id('products')) }, handler: async (ctx, args) => {
  if (args.productIds.length < 1 || args.productIds.length > 5 || new Set(args.productIds).size !== args.productIds.length) throw new Error('Repair requires one to five distinct product IDs.');
  const state = await ctx.db.query('catalogReadiness').withIndex('by_version', q => q.eq('version', CATALOG_VERSION)).unique();
  if (state) await ctx.db.patch(state._id, { enabled: false, phase: 'failed', cursor: null, updatedAt: Date.now() });
  for (const id of args.productIds) await syncCatalogProduct(ctx, id, await ctx.db.get(id));
  return { repaired: args.productIds.length, verificationRequired: true };
} });

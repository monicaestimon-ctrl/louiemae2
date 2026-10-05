import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireCatalogReady } from './catalogReadiness';
import { CATALOG_VERSION, type publicCatalogProduct, type adminCatalogProduct } from '../lib/catalogProjection';
import { catalogPageOptions } from '../lib/catalogPagination';

const filters = {
  paginationOpts: paginationOptsValidator,
  collection: v.optional(v.string()), category: v.optional(v.string()),
  search: v.optional(v.string()), order: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
};
// Filters run on the bounded page, never on an unbounded database scan. An empty
// page with isDone=false is valid: consumers must retain its continuation cursor.
function matches(row: { category: string; searchText: string }, args: { category?: string; search?: string }) {
  return (!args.category || row.category === args.category)
    && (!args.search?.trim() || row.searchText.includes(args.search.trim().toLowerCase()));
}
function publicRow(row: { version: number; publicData: unknown }) {
  if (row.version !== CATALOG_VERSION) throw new ConvexError({ code: 'CATALOG_VERSION_MISMATCH', message: 'Catalog requires verification.' });
  return row.publicData as ReturnType<typeof publicCatalogProduct>;
}

export const storefrontPage = query({ args: filters, handler: async (ctx, args) => {
  await requireCatalogReady(ctx);
  const source = args.collection
    ? ctx.db.query('productCatalog').withIndex('by_visible_collection_created', q => q.eq('visible', true).eq('collection', args.collection!))
    : ctx.db.query('productCatalog').withIndex('by_visible_created', q => q.eq('visible', true));
  const batch = await source.order(args.order ?? 'asc').paginate(catalogPageOptions(args.paginationOpts));
  return { ...batch, page: batch.page.filter(row => matches(row, args)).map(publicRow) };
} });

export const adminPage = query({ args: { ...filters, sourcingStatus: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireCjAdminIdentity(ctx);
  await requireCatalogReady(ctx);
  const source = args.collection
    ? ctx.db.query('productCatalog').withIndex('by_collection_created', q => q.eq('collection', args.collection!))
    : ctx.db.query('productCatalog').withIndex('by_created');
  const batch = await source.order(args.order ?? 'asc').paginate(catalogPageOptions(args.paginationOpts));
  return { ...batch, page: batch.page.filter(row => matches(row, args)
    && (!args.sourcingStatus || row.sourcingStatus === args.sourcingStatus)).map(row => ({
      ...publicRow(row), ...(row.adminData as ReturnType<typeof adminCatalogProduct>),
    })) };
} });

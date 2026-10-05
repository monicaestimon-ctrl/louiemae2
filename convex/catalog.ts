import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireCatalogReady } from './catalogReadiness';
import { CATALOG_VERSION, type publicCatalogProduct, type adminCatalogProduct } from '../lib/catalogProjection';
import { catalogPageOptions } from '../lib/catalogPagination';
import { matchesCjQueueFilter } from '../lib/cjVariantQueue';
import type { Doc } from './_generated/dataModel';

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

function sourcingRow(row: Doc<'productCatalog'>) {
  const display = publicRow(row);
  const admin = row.adminData as ReturnType<typeof adminCatalogProduct>;
  return { _id: row.productId, _creationTime: row.productCreatedAt, name: row.name,
    images: display.images.slice(0, 1), sourceUrl: admin.sourceUrl,
    cjSourcingStatus: admin.cjSourcingStatus, cjSourcingState: admin.cjSourcingState,
    cjSourcingId: admin.cjSourcingId, cjSourcingError: admin.cjSourcingError,
    cjSubmittedAt: admin.cjSubmittedAt, cjApprovedAt: admin.cjApprovedAt, cjProductId: admin.cjProductId };
}

export const sourcingPage = query({ args: { paginationOpts: paginationOptsValidator,
  status: v.union(v.literal('pending'), v.literal('rejected')),
}, handler: async (ctx, args) => {
  await requireCjAdminIdentity(ctx);
  await requireCatalogReady(ctx);
  const batch = await ctx.db.query('productCatalog').withIndex('by_sourcing_created', q => q.eq('sourcingStatus', args.status))
    .paginate(catalogPageOptions(args.paginationOpts));
  return { ...batch, page: batch.page.map(sourcingRow) };
} });

export const recentApprovalsPage = query({ args: { paginationOpts: paginationOptsValidator, since: v.string() }, handler: async (ctx, args) => {
  await requireCjAdminIdentity(ctx);
  await requireCatalogReady(ctx);
  // The caller keeps this cutoff stable across pages. Preserve the existing
  // ISO-string comparison, applying it through the index before reading rows.
  const batch = await ctx.db.query('productCatalog')
    .withIndex('by_sourcing_approved', q => q.eq('sourcingStatus', 'approved').gte('approvedAt', args.since))
    .order('desc').paginate(catalogPageOptions(args.paginationOpts));
  return { ...batch, page: batch.page.filter(row => Boolean(row.approvedAt)).map(sourcingRow) };
} });

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

export const variantQueuePage = query({ args: {
  paginationOpts: paginationOptsValidator,
  search: v.optional(v.string()),
  filter: v.union(v.literal('all'), v.literal('ready'), v.literal('needs_attention'),
    v.literal('awaiting_approval'), v.literal('unmapped'), v.literal('missing_customer'), v.literal('missing_cj')),
}, handler: async (ctx, args) => {
  await requireCjAdminIdentity(ctx);
  await requireCatalogReady(ctx);
  const batch = await ctx.db.query('productCatalog')
    .withIndex('by_variant_queue', q => q.eq('inVariantQueue', true))
    .paginate(catalogPageOptions(args.paginationOpts));
  const search = args.search?.trim().toLowerCase();
  return { ...batch, page: batch.page.flatMap(row => {
    // Validate even filtered rows so a mixed-version catalog fails closed.
    publicRow(row);
    const admin = row.adminData as ReturnType<typeof adminCatalogProduct>;
    if (!matchesCjQueueFilter(admin.mappingSummary.issueCodes, args.filter)
      || (search && !row.queueSearchValues?.some(value => value.includes(search)))) return [];
    const display = row.publicData as ReturnType<typeof publicCatalogProduct>;
    return [{ _id: row.productId, _creationTime: row.productCreatedAt, name: row.name,
      image: display.images[0], price: display.price, ...admin }];
  }) };
} });

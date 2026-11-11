import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { PUBLIC_SEARCH_VERSION } from './publicSearchMaintenance';
import { isProductVisibleOnStorefront } from '../lib/storefrontVisibility';
import { retailDetail } from './retailStorefront';
import { productUrl } from '../lib/storefrontNavigation';
import { catalogPageOptions } from '../lib/catalogPagination';
import { CommerceError } from '../lib/errors';

/** Cut over only when this index version is both verified and explicitly enabled. */
export async function searchReady(ctx: Pick<QueryCtx, 'db'>) {
  const state = await ctx.db
    .query('publicSearchState')
    .withIndex('by_version', (q) => q.eq('version', PUBLIC_SEARCH_VERSION))
    .unique();
  return state?.enabled === true && state.phase === 'verified';
}
export const status = query({
  args: {},
  handler: async (ctx) => ({ ready: await searchReady(ctx) }),
});

/** Resolve current public authority after indexing; private price/cost data never enters this DTO. */
export async function publicSearchCard(ctx: QueryCtx, row: Doc<'publicSearch'>) {
  if (row.sourceKey.startsWith('legacy:')) {
    const id = ctx.db.normalizeId('products', row.productId);
    if (!id || row.sourceKey !== `legacy:${id}`) return null;
    const p = await ctx.db.get(id);
    if (!p || !isProductVisibleOnStorefront(p) || !Number.isFinite(p.price) || p.price < 0)
      return null;
    return {
      _id: p._id as string,
      name: p.name.slice(0, 160),
      category: p.category.slice(0, 120),
      price: p.price,
      currency: 'USD' as const,
      image: p.images[0]?.slice(0, 2048) ?? null,
      alt: p.name.slice(0, 160),
      url: productUrl(p._id),
      availability: 'preview' as const,
    };
  }
  const listingId = ctx.db.normalizeId('commerceListings', row.sourceKey.slice('listing:'.length));
  if (!row.sourceKey.startsWith('listing:') || !listingId) return null;
  const listing = await ctx.db.get(listingId);
  if (!listing?.published || listing.channel !== 'retail' || listing.productId !== row.productId)
    return null;
  const p = await retailDetail(ctx, listing.productId);
  if (!p || !Number.isFinite(p.price) || p.price < 0) return null;
  return {
    _id: p._id as string,
    name: p.name.slice(0, 160),
    category: p.category.slice(0, 120),
    price: p.price,
    currency: 'USD' as const,
    image: p.images[0]?.slice(0, 2048) ?? null,
    alt:
      p.imageMedia?.find((m) => m.url === p.images[0])?.altText.slice(0, 160) ??
      p.name.slice(0, 160),
    url: productUrl(p._id),
    availability: p.inStock ? ('available' as const) : ('unavailable' as const),
  };
}

/** A bounded candidate page may be empty after current eligibility checks; retain its cursor. */
export const search = query({
  args: { term: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (!(await searchReady(ctx)))
      throw new CommerceError(
        'TEMPORARILY_UNAVAILABLE',
        undefined,
        'Search is being updated. Please try again shortly.'
      );
    const term = args.term
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      .slice(0, 80)
      .split(/\s+/)
      .slice(0, 16)
      .join(' ');
    if (term.length < 2) return { page: [], isDone: true, continueCursor: '' };
    const batch = await ctx.db
      .query('publicSearch')
      .withSearchIndex('public_text', (q) => q.search('text', term))
      .paginate(catalogPageOptions(args.paginationOpts, 20, 100_000));
    const cards = await Promise.all(batch.page.map((row) => publicSearchCard(ctx, row)));
    return { ...batch, page: cards.filter((card) => card !== null) };
  },
});

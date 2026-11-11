import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { isProductVisibleOnStorefront } from '../lib/storefrontVisibility';

export const PUBLIC_SEARCH_VERSION = 1;
export type SearchProjection = { sourceKey: string; productId: string; text: string };
const text = (...parts: string[]) =>
  parts.join(' ').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 640);

/** Index only approved public names/categories, never supplier identifiers or private prices. */
export function legacySearchProjection(product: Doc<'products'> | null): SearchProjection | null {
  if (!product || !isProductVisibleOnStorefront(product)) return null;
  return {
    sourceKey: `legacy:${product._id}`,
    productId: product._id,
    text: text(product.name, product.category, product.collection),
  };
}
export function listingSearchProjection(
  listing: Doc<'commerceListings'> | null
): SearchProjection | null {
  if (!listing?.published || listing.channel !== 'retail') return null;
  return {
    sourceKey: `listing:${listing._id}`,
    productId: listing.productId,
    text: text(listing.snapshot.name, listing.snapshot.category),
  };
}
export function sameSearchProjection(a: SearchProjection | null, b: SearchProjection | null) {
  return (
    a === b ||
    Boolean(
      a && b && a.sourceKey === b.sourceKey && a.productId === b.productId && a.text === b.text
    )
  );
}
/** Transactional maintenance is a no-op for irrelevant price/telemetry writes. */
export async function syncPublicSearch(
  ctx: Pick<MutationCtx, 'db'>,
  sourceKey: string,
  projection: SearchProjection | null
) {
  const old = await ctx.db
    .query('publicSearch')
    .withIndex('by_source', (q) => q.eq('sourceKey', sourceKey))
    .unique();
  if (!projection) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (!old) await ctx.db.insert('publicSearch', projection);
  else if (!sameSearchProjection(old, projection)) await ctx.db.replace(old._id, projection);
}

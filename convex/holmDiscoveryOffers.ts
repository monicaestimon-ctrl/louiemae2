import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { isCurrentPrice } from './catCore';
import { pricedListing } from './holmCatalogRead';
import { sameCatalogValue } from '../lib/catalogProjection';

/** A recorded approved price window, including scheduled future prices. This is
 * indexing evidence only: the customer reader must still check current eligibility. */
export function approvedDiscoveryPrice(price: Doc<'catPriceRevisions'> | null, variantId: Id<'catVariants'>, channel: 'retail' | 'trade') {
  if (!price || !Number.isSafeInteger(price.effectiveFrom) || price.effectiveFrom < 0
    || (price.effectiveTo !== undefined && (!Number.isSafeInteger(price.effectiveTo) || price.effectiveTo <= price.effectiveFrom))
    || !isCurrentPrice(price, variantId, channel, price.effectiveFrom)) return null;
  return { minor: price.packPriceMinor, revisionId: price._id, from: price.effectiveFrom, to: price.effectiveTo ?? null };
}

export type DiscoveryOffer = {
  listingId: Id<'commerceListings'>; productId: Id<'commerceProducts'>; variantId: string;
  retailMinor: number | null; tradeMinor: number;
  retailFrom: number | null; retailTo: number | null; tradeFrom: number; tradeTo: number | null;
  retailRevisionId?: Id<'catPriceRevisions'>; tradeRevisionId?: Id<'catPriceRevisions'>;
};

export const listingPriceInputs = (listing: Doc<'commerceListings'> | null) => listing && ({
  productId: listing.productId, channel: listing.channel, published: listing.published,
  name: listing.snapshot.name, category: listing.snapshot.category,
  variants: listing.snapshot.variants.map(v => ({ id: v.id, price: v.price })),
  fulfillment: listing.fulfillment?.map(v => ({ id: v.id, sku: v.sku, cost: v.cost, retail: v.retail, commercial: v.commercial })),
});
export const productPriceInputs = (product: Doc<'commerceProducts'> | null) => product && ({
  provider: product.provider, cjProductId: product.cjProductId, currency: product.draft.currency, usdRate: product.draft.usdRate,
});
export const variantPriceInputs = (variant: Doc<'catVariants'> | null) => variant && ({
  productId: variant.productId, retailPriceRevisionId: variant.retailPriceRevisionId, tradePriceRevisionId: variant.tradePriceRevisionId,
});

/** Internal sort-price projection. Never return these rows directly to a customer.
 * Stock-independent candidate prices avoid making a stock withdrawal change the
 * sort key of another variant. Current catalogItem and viewer access stay authoritative.
 * No customer reader cutover consumes this preparation helper yet. */
export async function discoveryOffers(ctx: QueryCtx | MutationCtx, listing: Doc<'commerceListings'>): Promise<DiscoveryOffer[]> {
  if (!listing.published || listing.channel !== 'house') return [];
  const product = await ctx.db.get(listing.productId);
  if (!product) return [];
  if (product.provider !== 'zuo') {
    const priced = await pricedListing(ctx, listing, true);
    return (priced?.variants ?? []).filter(option => Number.isSafeInteger(option.retail) && option.retail > 0
      && Number.isSafeInteger(option.trade) && option.trade > 0).map(option => ({
      listingId: listing._id, productId: product._id, variantId: option.id,
      retailMinor: option.retail, tradeMinor: option.trade,
      retailFrom: 0, retailTo: null, tradeFrom: 0, tradeTo: null,
    }));
  }
  const offers: DiscoveryOffer[] = [];
  for (const option of listing.snapshot.variants) {
    const id = ctx.db.normalizeId('catVariants', option.id);
    const variant = id ? await ctx.db.get(id) : null;
    if (!variant || variant.productId !== product._id) continue;
    const trade = approvedDiscoveryPrice(variant.tradePriceRevisionId ? await ctx.db.get(variant.tradePriceRevisionId) : null, variant._id, 'trade');
    if (!trade || trade.minor !== option.price) continue;
    const retail = approvedDiscoveryPrice(variant.retailPriceRevisionId ? await ctx.db.get(variant.retailPriceRevisionId) : null, variant._id, 'retail');
    offers.push({ listingId: listing._id, productId: product._id, variantId: variant._id,
      retailMinor: retail?.minor ?? null, tradeMinor: trade.minor,
      retailFrom: retail?.from ?? null, retailTo: retail?.to ?? null, tradeFrom: trade.from, tradeTo: trade.to,
      ...(retail ? { retailRevisionId: retail.revisionId } : {}), tradeRevisionId: trade.revisionId });
  }
  return offers;
}

/** Replace only changed derived rows. Source mutations and this write share a transaction. */
export async function syncDiscoveryOffers(ctx: MutationCtx, listingId: Id<'commerceListings'>) {
  const listing = await ctx.db.get(listingId);
  const next = listing ? await discoveryOffers(ctx, listing) : [];
  const remaining = new Map(next.map(offer => [offer.variantId, offer]));
  const old = await ctx.db.query('holmDiscoveryOffers').withIndex('by_listing', q => q.eq('listingId', listingId)).collect();
  for (const row of old) {
    const candidate = remaining.get(row.variantId);
    if (!candidate) await ctx.db.delete(row._id);
    else {
      const { _id, _creationTime: ignoredCreationTime, ...value } = row;
      void ignoredCreationTime;
      if (!sameCatalogValue(value, candidate)) await ctx.db.replace(_id, candidate);
      remaining.delete(row.variantId);
    }
  }
  for (const candidate of remaining.values()) await ctx.db.insert('holmDiscoveryOffers', candidate);
}

export async function syncProductDiscoveryOffers(ctx: MutationCtx, productId: Id<'commerceProducts'>) {
  const listings = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', productId).eq('channel', 'house')).collect();
  for (const listing of listings) await syncDiscoveryOffers(ctx, listing._id);
}

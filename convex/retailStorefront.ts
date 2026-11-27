import { verifiedImageMatches } from './catMedia';
import { isLighting } from '../lib/catCategory';
import { approvedAshcroftOffer } from './catAshcroftOffer';
import { legacySupplierCostMinor } from '../lib/legacySupplierCost';
import { publicQuantityRules, type OrderQuantityRules } from '../lib/orderQuantity';
import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { launchPrice, retailDelivery, retailDescription } from '../lib/retailLaunch';
import { assertSellable, isCurrentPrice } from './catCore';
import { ashcroftAvailableFromFeed, latestFeed } from './ashcroftInventory';
import type { AshcroftFeed } from '../lib/ashcroftInventory';
export type AshcroftReviewEvidence = { feed: AshcroftFeed | null; now: number };
import { isCommerceError } from '../lib/errors';

// Adapt the retail listing into LouieMae's existing product modal and cards.
export async function storefrontListing(ctx: QueryCtx, listing: Doc<'commerceListings'>, evidence?: AshcroftReviewEvidence) {
  const current = evidence ?? { feed: await latestFeed(ctx), now: Date.now() };
  const product = await ctx.db.get(listing.productId);
  const s = listing.snapshot;
  const meta = listing.pricingMode === 'approved_v2' ? await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', listing.productId)).unique() : null;
  const rate = retailDelivery(s.category, s.name);
  const variants = await Promise.all(s.variants.map(async v => {
    const quantityRules = publicQuantityRules(v.minimum, v.increment);
    let approved = false;
    if (listing.pricingMode === 'approved_v2') {
      try { const offer = await approvedAshcroftOffer(ctx, listing, v.id, 'retail', current.now); approved = offer.capacity >= v.minimum; }
      catch (error) { if (!isCommerceError(error)) throw error; }
    }
    return {
      id: v.id, name: v.name, image: v.image, quantityRules,
      price: listing.pricingMode === 'approved_v2' ? v.price / 100 : rate ? launchPrice(v.price, rate.freight, rate.delivery) / 100 : v.price / 100,
      inStock: listing.pricingMode === 'approved_v2' ? approved : !!quantityRules && !!rate && !!product &&
        legacySupplierCostMinor(listing.fulfillment?.find(f => f.id === v.id)?.cost, product.draft.currency, product.draft.usdRate) !== null && ashcroftAvailableFromFeed(current.feed, listing.fulfillment?.find(f => f.id === v.id)?.sku, s.description, v.minimum, current.now),
    };
  }));
  const price = Math.min(...variants.map(v => v.price));
  return { _id: listing.productId, name: s.name, description: [retailDescription(s.description), s.facts].filter(Boolean).join('\n\n'),
    category: s.category, collection: meta?.commissionCategory === 'decor' || isLighting(`${s.category} ${s.name}`) ? 'decor' : 'furniture',
    images: s.images, imageMedia: s.imageMedia, price, deliveryFee: (rate?.delivery ?? 0) / 100,
    checkoutMode: listing.pricingMode === 'approved_v2' ? 'v2' as const : 'legacy' as const,
    fulfillmentProvider: 'ashcroft' as const, inStock: variants.some(v => v.inStock),
    variants: variants.map(({ price: variantPrice, ...v }) => ({ ...v, priceAdjustment: variantPrice - price })),
    variantCount: variants.length, isNew: false,
  };
}

/**
 * A published Zuo listing for the storefront (v2). Prices are the approved pack prices; delivery
 * comes from the server estimate at checkout, never from a per-item fee here.
 */
function zuoStorefrontListing(listing: Doc<'commerceListings'>, collection: 'furniture' | 'decor', quantityRules: ReadonlyMap<string, OrderQuantityRules>) {
  const s = listing.snapshot;
  const imageMedia = s.imageMedia?.filter(m => m.variantIds.some(id => s.variants.some(v => v.id === id)));
  const variants = s.variants.map(v => ({ id: v.id, name: v.name, image: v.image, price: v.price / 100, quantityRules: quantityRules.get(v.id), inStock: !listing.planningOnly }));
  const price = Math.min(...variants.map(v => v.price));
  return { _id: listing.productId, name: s.name, description: s.description, category: s.category, collection,
    images: imageMedia ? imageMedia.map(m => m.url) : s.images, imageMedia, price, deliveryFee: 0, checkoutMode: 'v2' as const, fulfillmentProvider: 'zuo' as const, inStock: !listing.planningOnly,
    variants: variants.map(({ price: variantPrice, ...v }) => ({ ...v, priceAdjustment: variantPrice - price })),
    variantCount: variants.length, isNew: false,
  };
}

export const zuoRetailEnabled = () => process.env.RETAIL_ZUO_CHECKOUT_ENABLED === 'true' || process.env.DELIVERY_PLANNING_ENABLED === 'true';

/** Published snapshots are historical content, not proof of current availability. */
export async function currentZuoStorefrontListing(ctx: QueryCtx, listing: Doc<'commerceListings'>, collection: 'furniture' | 'decor', now = Date.now()) {
  if (!listing.published || listing.channel !== 'retail') return null;
  if (!listing.planningOnly && process.env.RETAIL_ZUO_CHECKOUT_ENABLED !== 'true') return null;
  const media = listing.planningOnly ? await ctx.db.query('catMediaAssets').withIndex('by_product', q => q.eq('productId', listing.productId)).collect() : [];
  const quantityRules = new Map<string, OrderQuantityRules>();
  const approvedImageUrls = new Set<string>();
  const current = await Promise.all(listing.snapshot.variants.map(async option => {
    const id = ctx.db.normalizeId('catVariants', option.id);
    if (!id) return null;
    try {
      if (listing.planningOnly && process.env.DELIVERY_PLANNING_ENABLED !== 'true') return null;
      const variant = listing.planningOnly ? await ctx.db.get(id) : await assertSellable(ctx, id, 'purchase', now);
      if (!variant || variant.availability === 'discontinued' || (listing.planningOnly && variant.holds.some(h => ['SOURCE_ABSENT', 'MAPPING_MISSING', 'MAP_MISSING', 'MAP_ZERO', 'MAP_POLICY_DERIVED', 'MAP_FLOOR_UNAPPROVED', 'MEDIA_MISSING'].includes(h)))) return null;
      if (variant.productId !== listing.productId) return null;
      if (listing.planningOnly) {
        const matches = media.filter(m => verifiedImageMatches(m, variant));
        if (!matches.some(m => m.role === 'hero')) return null;
        const urls = (await Promise.all(matches.flatMap(m => m.derivatives.length ? m.derivatives.map(d => ctx.storage.getUrl(d.storageId)) : !m.rights.privateOriginal && m.storageId ? [ctx.storage.getUrl(m.storageId)] : []))).filter((url): url is string => !!url);
        if (!option.image || !urls.includes(option.image)) return null;
        for (const url of urls) approvedImageUrls.add(url);
      }
      const price = variant.retailPriceRevisionId ? await ctx.db.get(variant.retailPriceRevisionId) : null;
      if (!isCurrentPrice(price, id, 'retail', now) || price.packPriceMinor !== option.price) return null;
      if (listing.planningOnly) {
        const cost = variant.currentCostRevisionId ? await ctx.db.get(variant.currentCostRevisionId) : null;
        if (!cost || cost.variantId !== id || cost.mapApplicability === 'unknown') return null;
        if (cost.mapApplicability === 'applies' && (cost.mapMinor === null || cost.mapMinor <= 0 || !cost.mapUnitBasis || option.price < cost.mapMinor * (cost.mapUnitBasis === 'piece' ? variant.piecesPerPack : 1))) return null;
      }
      const rules = publicQuantityRules(variant.orderMinimumPacks, variant.orderIncrementPacks, variant.piecesPerPack);
      if (!rules) return null;
      quantityRules.set(option.id, rules);
      return option;
    } catch (error) {
      if (isCommerceError(error)) return null;
      throw error;
    }
  }));
  const variants = current.filter(option => option !== null);
  if (!variants.length) return null;
  return zuoStorefrontListing({ ...listing, snapshot: { ...listing.snapshot, variants, ...(listing.planningOnly ? { images: listing.snapshot.images.filter(url => approvedImageUrls.has(url)), imageMedia: listing.snapshot.imageMedia?.filter(m => approvedImageUrls.has(m.url)) } : {}) } }, collection, quantityRules);
}

export async function retailDetail(ctx: QueryCtx, id: Id<'commerceProducts'>, evidence?: AshcroftReviewEvidence) {
  const product = await ctx.db.get(id);
  if (product?.provider !== 'ashcroft' && !(product?.provider === 'zuo' && zuoRetailEnabled())) return null;
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', id).eq('channel', 'retail')).unique();
  if (!listing?.published) return null;
  if (product.provider === 'zuo') {
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', id)).first();
    return currentZuoStorefrontListing(ctx, listing, meta?.commissionCategory === 'decor' ? 'decor' : 'furniture');
  }
  return storefrontListing(ctx, listing, evidence);
}

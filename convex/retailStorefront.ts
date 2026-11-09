import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { launchPrice, retailDelivery, retailDescription, supplierAvailable } from '../lib/retailLaunch';
import { assertSellable } from './catCore';
import { isCommerceError } from '../lib/errors';

// Adapt the retail listing into LouieMae's existing product modal and cards.
export function storefrontListing(listing: Doc<'commerceListings'>) {
  const s = listing.snapshot;
  const rate = retailDelivery(s.category, s.name);
  const variants = s.variants.map(v => ({
    id: v.id, name: v.name, image: v.image,
    price: rate ? launchPrice(v.price, rate.freight, rate.delivery) / 100 : v.price / 100,
    inStock: !!rate && supplierAvailable(listing.fulfillment?.find(f => f.id === v.id)?.sku, s.description),
  }));
  const price = Math.min(...variants.map(v => v.price));
  return { _id: listing.productId, name: s.name, description: [retailDescription(s.description), s.facts].filter(Boolean).join('\n\n'),
    category: s.category, collection: s.category === 'Lighting' ? 'decor' : 'furniture',
    images: s.images, price, deliveryFee: (rate?.delivery ?? 0) / 100,
    fulfillmentProvider: 'ashcroft' as const, inStock: variants.some(v => v.inStock),
    variants: variants.map(({ price: variantPrice, ...v }) => ({ ...v, priceAdjustment: variantPrice - price })),
    variantCount: variants.length, isNew: false,
  };
}

/**
 * A published Zuo listing for the storefront (v2). Prices are the approved pack prices; delivery
 * comes from the server estimate at checkout, never from a per-item fee here.
 */
export function zuoStorefrontListing(listing: Doc<'commerceListings'>, collection: 'furniture' | 'decor') {
  const s = listing.snapshot;
  const variants = s.variants.map(v => ({ id: v.id, name: v.name, image: v.image, price: v.price / 100, inStock: true }));
  const price = Math.min(...variants.map(v => v.price));
  return { _id: listing.productId, name: s.name, description: s.description, category: s.category, collection,
    images: s.images, price, deliveryFee: 0, fulfillmentProvider: 'zuo' as const, inStock: true,
    variants: variants.map(({ price: variantPrice, ...v }) => ({ ...v, priceAdjustment: variantPrice - price })),
    variantCount: variants.length, isNew: false,
  };
}

export const zuoRetailEnabled = () => process.env.RETAIL_ZUO_CHECKOUT_ENABLED === 'true';

/** Published snapshots are historical content, not proof of current availability. */
export async function currentZuoStorefrontListing(ctx: QueryCtx, listing: Doc<'commerceListings'>, collection: 'furniture' | 'decor', now = Date.now()) {
  if (!listing.published || listing.channel !== 'retail') return null;
  const current = await Promise.all(listing.snapshot.variants.map(async option => {
    const id = ctx.db.normalizeId('catVariants', option.id);
    if (!id) return null;
    try {
      const variant = await assertSellable(ctx, id, 'purchase', now);
      if (variant.productId !== listing.productId) return null;
      const price = variant.retailPriceRevisionId ? await ctx.db.get(variant.retailPriceRevisionId) : null;
      if (!price || price.status !== 'approved' || price.effectiveFrom > now ||
        (price.effectiveTo !== undefined && price.effectiveTo <= now) || price.packPriceMinor !== option.price) return null;
      return option;
    } catch (error) {
      if (isCommerceError(error)) return null;
      throw error;
    }
  }));
  const variants = current.filter(option => option !== null);
  if (!variants.length) return null;
  return zuoStorefrontListing({ ...listing, snapshot: { ...listing.snapshot, variants } }, collection);
}

export async function retailDetail(ctx: QueryCtx, id: Id<'commerceProducts'>) {
  const product = await ctx.db.get(id);
  if (product?.provider !== 'ashcroft' && !(product?.provider === 'zuo' && zuoRetailEnabled())) return null;
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', id).eq('channel', 'retail')).unique();
  if (!listing?.published) return null;
  if (product.provider === 'zuo') {
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', id)).first();
    return currentZuoStorefrontListing(ctx, listing, meta?.commissionCategory === 'decor' ? 'decor' : 'furniture');
  }
  return storefrontListing(listing);
}

import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { launchPrice, retailDelivery, retailDescription, supplierAvailable } from '../lib/retailLaunch';

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

export async function retailDetail(ctx: QueryCtx, id: Id<'commerceProducts'>) {
  const product = await ctx.db.get(id);
  if (product?.provider !== 'ashcroft') return null;
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', id).eq('channel', 'retail')).unique();
  return listing?.published ? storefrontListing(listing) : null;
}

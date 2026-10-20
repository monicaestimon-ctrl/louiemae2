import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { checkQuantity } from '../lib/commerce';
import { launchPrice, retailDelivery, supplierAvailable, retailDescription } from '../lib/retailLaunch';

export const catalog = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', 'retail').eq('published', true))
      .paginate(args.paginationOpts);
    const products = await Promise.all(
      page.page.map(async (listing) => {
        const product = await ctx.db.get(listing.productId);
        if (!product || product.provider !== 'ashcroft') return null;
        const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
        return {
          id: product._id,
          ...listing.snapshot,
          description: retailDescription(listing.snapshot.description),
          deliveryFee: rate ? rate.delivery / 100 : null,
          variants: listing.snapshot.variants.map((option) => ({
            ...option,
            price: rate ? launchPrice(option.price, rate.freight, rate.delivery) : option.price,
            purchasable:
              !!rate &&
              supplierAvailable(listing.fulfillment?.find((x) => x.id === option.id)?.sku, listing.snapshot.description),
          })),
        };
      })
    );
    return { ...page, page: products.filter((p) => p !== null) };
  },
});

export const createSnapshot = internalMutation({
  args: {
    items: v.array(
      v.object({ productId: v.string(), variantId: v.string(), quantity: v.number() })
    ),
  },
  handler: async (ctx, { items }) => {
    if (!items.length || items.length > 30) throw new Error('Choose between 1 and 30 items.');
    const lines = [];
    const seen = new Set<string>();
    let shipping = 0;
    for (const item of items) {
      const key = `${item.productId}:${item.variantId}`;
      if (seen.has(key)) throw new Error('Combine duplicate cart items before checkout.');
      seen.add(key);
      const id = ctx.db.normalizeId('commerceProducts', item.productId);
      const product = id ? await ctx.db.get(id) : null;
      if (!product || product.provider !== 'ashcroft') throw new Error('This item is Coming Soon.');
      const listing = await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) =>
          q.eq('productId', product._id).eq('channel', 'retail')
        )
        .unique();
      if (!listing?.published) throw new Error('This item is no longer available.');
      const option = listing.snapshot.variants.find((x) => x.id === item.variantId);
      const supplier = listing.fulfillment?.find((x) => x.id === item.variantId);
      const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
      if (!option || !supplier?.sku || !supplierAvailable(supplier.sku, listing.snapshot.description) || !rate)
        throw new Error('This item is Coming Soon.');
      checkQuantity(item.quantity, option);
      if (item.quantity > 20) throw new Error('Please contact us for orders above 20 units.');
      shipping += rate.delivery * item.quantity;
      lines.push({
        productId: product._id,
        variantId: option.id,
        variantName: option.name,
        name:
          option.name === 'Default Title'
            ? listing.snapshot.name
            : `${listing.snapshot.name} — ${option.name}`,
        price: launchPrice(option.price, rate.freight, rate.delivery) / 100,
        quantity: item.quantity,
        image: option.image || listing.snapshot.images[0],
        supplierSku: supplier.sku,
        fulfillmentProvider: 'ashcroft' as const,
      });
    }
    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity * 100, 0));
    const id = await ctx.db.insert('retailCheckouts', {
      items: lines,
      subtotal,
      shipping,
      createdAt: Date.now(),
    });
    return { id, items: lines, subtotal, shipping };
  },
});
export const snapshot = internalQuery({
  args: { id: v.id('retailCheckouts') },
  handler: (ctx, { id }) => ctx.db.get(id),
});

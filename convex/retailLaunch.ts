import { approvedAshcroftOffer } from './catAshcroftOffer';
import { legacySupplierCostMinor } from '../lib/legacySupplierCost';
import { CommerceError, isCommerceError } from '../lib/errors';
import { ashcroftQuantity } from '../lib/ashcroftInventory';
import { latestFeed } from './ashcroftInventory';
import { currentInventory, availableAfterCommitments } from './ordInventory';
import { MAX_ORDER_QUANTITY, publicQuantityRules } from '../lib/orderQuantity';
import { ashcroftAvailable } from './ashcroftInventory';
import { v } from 'convex/values';
import { viewer } from './holmAccess';
import { reserveCredit } from './holmCredit';
import { internalMutation, internalQuery, query } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { checkQuantity } from '../lib/commerce';
import { launchPrice, retailDelivery, retailDescription } from '../lib/retailLaunch';
import { retailDetail, storefrontListing, currentZuoStorefrontListing, zuoRetailEnabled } from './retailStorefront';
import { resolveAttribution } from './holmPartners';

export const storefrontPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.query('commerceListings').withIndex('by_channel_published', q => q.eq('channel', 'retail').eq('published', true)).paginate(args.paginationOpts);
    const page = await Promise.all(batch.page.map(async listing => {
      const product = await ctx.db.get(listing.productId);
      if (product?.provider === 'ashcroft') return storefrontListing(ctx, listing);
      // v2 Zuo listings appear only once Zuo retail checkout is switched on.
      if (product?.provider === 'zuo' && zuoRetailEnabled()) {
        const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', product._id)).first();
        return currentZuoStorefrontListing(ctx, listing, meta?.commissionCategory === 'decor' ? 'decor' : 'furniture');
      }
      return null;
    }));
    return { ...batch, page: page.filter(p => p !== null) };
  },
});

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
        if (listing.pricingMode === 'approved_v2') {
          const detail = await storefrontListing(ctx, listing);
          return { id: product._id, ...listing.snapshot, description: detail.description,
            checkoutMode: 'v2' as const, deliveryFee: detail.deliveryFee,
            variants: listing.snapshot.variants.map(option => ({ ...option,
              purchasable: detail.variants.some(v => v.id === option.id && v.inStock) })) };
        }
        const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
        return {
          id: product._id,
          ...listing.snapshot,
          description: retailDescription(listing.snapshot.description),
          deliveryFee: rate ? rate.delivery / 100 : null,
          variants: await Promise.all(listing.snapshot.variants.map(async (option) => ({
            ...option,
            price: rate ? launchPrice(option.price, rate.freight, rate.delivery) : option.price,
            purchasable:
              !!publicQuantityRules(option.minimum, option.increment) && !!rate &&
              legacySupplierCostMinor(listing.fulfillment?.find(x => x.id === option.id)?.cost, product.draft.currency, product.draft.usdRate) !== null &&
              await ashcroftAvailable(ctx, listing.fulfillment?.find((x) => x.id === option.id)?.sku, listing.snapshot.description, option.minimum),
          }))),
        };
      })
    );
    return { ...page, page: products.filter((p) => p !== null) };
  },
});

/** Current source quantity and price for a saved option. This read does not reserve inventory. */
export const cartReview = query({
  args: { id: v.string(), variantId: v.string(), quantity: v.number(), attempt: v.number() },
  handler: async (ctx, args) => {
    if (args.id.length > 128 || args.variantId.length > 200 ||
      !Number.isSafeInteger(args.quantity) || args.quantity < 1 || args.quantity > MAX_ORDER_QUANTITY ||
      !Number.isSafeInteger(args.attempt) || args.attempt < 0 || args.attempt > 1_000_000)
      throw new CommerceError('INVALID_INPUT');
    const id = ctx.db.normalizeId('commerceProducts', args.id);
    if (!id) return null;
    const now = Date.now();
    const product = await ctx.db.get(id);
    const evidence = product?.provider === 'ashcroft' ? { feed: await latestFeed(ctx), now } : undefined;
    const detail = await retailDetail(ctx, id, evidence);
    if (!detail) return null;
    const option = detail.variants.find(v => v.id === args.variantId);
    let maximum = 0;
    let expiresAt = evidence?.feed?.validUntil ?? null;
    if (option?.inStock) {
      if (detail.fulfillmentProvider === 'ashcroft') {
        const listing = await ctx.db.query('commerceListings')
          .withIndex('by_product_channel', q => q.eq('productId', id).eq('channel', 'retail')).unique();
        if (listing?.pricingMode === 'approved_v2') {
          try { const offer = await approvedAshcroftOffer(ctx, listing, args.variantId, 'retail', now); maximum = Math.min(20, offer.capacity); expiresAt = Math.min(offer.stock.feed.validUntil, offer.economics.validUntil); }
          catch (error) { if (!isCommerceError(error)) throw error; }
        } else {
          const sku = listing?.fulfillment?.find(v => v.id === args.variantId)?.sku;
          const available = ashcroftQuantity(evidence?.feed ?? null, sku, now);
          maximum = available === null ? 0 : Math.min(20, available);
        }
      } else {
        const variantId = ctx.db.normalizeId('catVariants', args.variantId);
        const variant = variantId ? await ctx.db.get(variantId) : null;
        if (variant?.productId === id) {
          try {
            const { view } = await currentInventory(ctx, variant, Date.now());
            maximum = view.automatic && view.availablePacks !== null ? Math.min(MAX_ORDER_QUANTITY, await availableAfterCommitments(ctx, variant, view.availablePacks, now)) : 0;
          } catch (error) { if (!isCommerceError(error)) throw error; }
        }
      }
    }
    // Counts are in the existing selling basis. Supplier identity, costs and warehouse evidence stay private.
    return { product: detail, variantId: args.variantId, quantity: args.quantity, maximum, expiresAt };
  },
});

export const createSnapshot = internalMutation({
  args: {
    items: v.array(
      v.object({ productId: v.string(), variantId: v.string(), quantity: v.number(),
        reviewed: v.optional(v.object({ merchandiseMinor: v.number(), deliveryMinor: v.number() })) })
    ),
    refCode: v.optional(v.string()),
    visitorId: v.optional(v.string()),
    useCredit: v.optional(v.boolean()),
  },
  handler: async (ctx, { items, refCode, visitorId, useCredit }) => {
    // Signed in (the cart sends the member's token): their credit can be used, and their own
    // partner link never counts.
    const me = await viewer(ctx);
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
      if (listing.pricingMode === 'approved_v2') throw new CommerceError('PRICE_CHANGED', 'This offer requires the current checkout; refresh your cart.');
      const option = listing.snapshot.variants.find((x) => x.id === item.variantId);
      const supplier = listing.fulfillment?.find((x) => x.id === item.variantId);
      const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
      if (!option || !supplier?.sku || !(await ashcroftAvailable(ctx, supplier.sku, listing.snapshot.description, item.quantity)) || !rate)
        throw new Error('This item is Coming Soon.');
      if (legacySupplierCostMinor(supplier.cost, product.draft.currency, product.draft.usdRate) === null)
        throw new CommerceError('COST_REVIEW_REQUIRED');
      checkQuantity(item.quantity, option);
      if (item.quantity > 20) throw new Error('Please contact us for orders above 20 units.');
      const unitPrice = launchPrice(option.price, rate.freight, rate.delivery);
      if (item.reviewed && (!Number.isSafeInteger(item.reviewed.merchandiseMinor) ||
        !Number.isSafeInteger(item.reviewed.deliveryMinor) ||
        item.reviewed.merchandiseMinor !== unitPrice || item.reviewed.deliveryMinor !== rate.delivery))
        throw new CommerceError('PRICE_CHANGED');
      shipping += rate.delivery * item.quantity;
      lines.push({
        productId: product._id,
        variantId: option.id,
        variantName: option.name,
        name:
          option.name === 'Default Title'
            ? listing.snapshot.name
            : `${listing.snapshot.name} — ${option.name}`,
        price: unitPrice / 100,
        quantity: item.quantity,
        image: option.image || listing.snapshot.images[0],
        supplierSku: supplier.sku,
        fulfillmentProvider: 'ashcroft' as const,
      });
    }
    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity * 100, 0));
    // A partner link this visitor followed in the last 30 days. The buyer's email isn't known
    // yet, so self-referral is checked again when the payment completes.
    const attr = await resolveAttribution(ctx, refCode, visitorId, { userId: me?.userId, email: me?.email.toLowerCase() ?? '' });
    const id = await ctx.db.insert('retailCheckouts', {
      items: lines,
      subtotal,
      shipping,
      createdAt: Date.now(),
      ...(attr && visitorId
        ? { partner: { partnerId: attr.partnerId, refCode: attr.refCode, visitorId, channel: attr.channel, ...(attr.board ? { board: attr.board } : {}) } }
        : {}),
    });
    // Credit comes off merchandise only, never delivery or tax.
    const creditCents = me && useCredit ? await reserveCredit(ctx, me.userId, subtotal, `checkout:${id}`) : 0;
    if (creditCents > 0) await ctx.db.patch(id, { creditCents, creditUserId: me!.userId });
    return { id, items: lines, subtotal, shipping, creditCents };
  },
});
export const snapshot = internalQuery({
  args: { id: v.id('retailCheckouts') },
  handler: (ctx, { id }) => ctx.db.get(id),
});

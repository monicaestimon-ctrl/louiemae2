import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { ashcroftAvailable } from './ashcroftInventory';
import { listingReady } from './commerceReadiness';
import { assertSellable, isCurrentPrice } from './catCore';
import { isCommerceError } from '../lib/errors';
import { flag } from '../lib/flags';
import { assetsFor, publicAssets } from './holmAssets';
import { freightFor } from '../lib/holmDelivery';
import { launchPrice, retailDelivery } from '../lib/retailLaunch';
import { tradeCents, floorCents } from '../lib/holmPricing';

type Ctx = QueryCtx | MutationCtx;

type FulfillmentVariant = NonNullable<Doc<'commerceListings'>['fulfillment']>[number];

/**
 * Landed cost of one unit in USD cents: supplier cost, or CJ's landed cost when higher.
 * Ashcroft bills freight separately, so its freight allowance is part of the landed cost.
 */
export function costCents(
  product: Doc<'commerceProducts'>,
  variant: FulfillmentVariant,
  linked: Doc<'products'> | null,
  freight: number
) {
  const supplier = Math.round(variant.cost * (product.draft.usdRate || 1) * 100);
  if (product.provider === 'ashcroft') return supplier > 0 ? supplier + freight : 0;
  const landed = linked?.confirmedLandedCost ?? linked?.estimatedLandedCost;
  return Math.max(supplier, landed ? Math.round(landed * 100) : 0);
}
/** Retail unit price in cents. House-only pieces fall back to the House estimate grossed up. */
function retailCents(variant: FulfillmentVariant) {
  if (variant.retail > 0) return variant.retail;
  return Math.round(variant.commercial / 0.75);
}

/** What pricing a House listing needs besides the listing itself: the CJ product and, for
 * Ashcroft, the louiemae.com listing and its freight/delivery rate. */
export async function pricingParts(ctx: Ctx, product: Doc<'commerceProducts'>, listing: Doc<'commerceListings'>) {
  const linked = product.cjProductId ? await ctx.db.get(product.cjProductId) : null;
  // Ashcroft pieces use the louiemae.com price as retail: the storefront builds the freight
  // allowance into it (see storefrontListing), so trade at 25% off carries freight too.
  const store =
    product.provider === 'ashcroft'
      ? await ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) => q.eq('productId', product._id).eq('channel', 'retail'))
          .unique()
      : null;
  const named = store?.snapshot ?? listing.snapshot;
  const rate = product.provider === 'ashcroft' ? retailDelivery(named.category, named.name) : null;
  return { linked, store, rate };
}

export function variantFreight(route: FulfillmentVariant, rate: ReturnType<typeof retailDelivery>) {
  return rate ? { cents: rate.freight, known: true } : freightFor(route.sku);
}

// includeUnfunded is for owner diagnostics and internal index preparation;
// customer reads and quotes omit it. Internal candidates never grant eligibility.
export async function pricedListing(ctx: Ctx, listing: Doc<'commerceListings'>, includeUnfunded = false) {
  const product = await ctx.db.get(listing.productId);
  if (!product || product.provider === 'zuo') return null;
  const ready = await listingReady(ctx, product, listing);
  if (!ready && !includeUnfunded) return null;
  const { linked, store, rate } = await pricingParts(ctx, product, listing);
  const availableOptions = await Promise.all(listing.snapshot.variants.map(async sv => {
    const available = product.provider !== 'ashcroft' || await ashcroftAvailable(ctx, listing.fulfillment?.find(f => f.id === sv.id)?.sku, listing.snapshot.description, sv.minimum);
    return available || includeUnfunded ? { ...sv, offerAvailable: ready && available } : null;
  }));
  const variants = availableOptions.filter(sv => sv !== null).flatMap((sv) => {
    const route = listing.fulfillment?.find((f) => f.id === sv.id);
    if (!route) return [];
    const base = store?.snapshot.variants.find((v) => v.id === sv.id)?.price || retailCents(route);
    if (base <= 0) return [];
    const retail = rate ? launchPrice(base, rate.freight, rate.delivery) : base;
    const freight = variantFreight(route, rate);
    const rateToUsd = product.draft.usdRate;
    const conversionKnown = Number.isFinite(route.cost) && route.cost > 0
      && /^[A-Z]{3}$/.test(product.draft.currency)
      && Number.isFinite(rateToUsd) && rateToUsd > 0
      && (product.draft.currency !== 'USD' || rateToUsd === 1);
    const computedCost = conversionKnown ? costCents(product, route, linked, freight.cents) : 0;
    const cost = Number.isSafeInteger(computedCost) && computedCost > 0 ? computedCost : 0;
    const trade = tradeCents(retail, cost);
    // A displayed/quoted legacy offer must fund its known cost floor. Unknown costs
    // and floors above retail are unavailable, never zero-price or clipped offers.
    if (trade <= 0 && !includeUnfunded) return [];
    return [{ ...sv, retail, cost, sku: route.sku, freightKnown: freight.known, trade, floor: floorCents(cost) }];
  });
  return variants.length ? { product, listing, variants, inStock: linked?.inStock !== false } : null;
}

/** Resolve a House listing through the same current authority for pages and saved identities. */
export async function catalogItem(ctx: QueryCtx, listing: Doc<'commerceListings'>, trade: boolean, now: number) {
  const product = await ctx.db.get(listing.productId);
  if (!product || !listing.published || listing.channel !== 'house') return null;
  const s = listing.snapshot;
  let variants: { id: string; name: string; image?: string; minimum: number; increment: number; retail: number | null; trade: number | null }[] = [];
  let inStock = true;
  if (product.provider === 'zuo') {
    if (!flag('TRADE_CHECKOUT_V2_ENABLED')) return null;
    for (const option of s.variants) {
      const id = ctx.db.normalizeId('catVariants', option.id);
      if (!id) continue;
      try {
        const cv = await assertSellable(ctx, id, 'estimate', now, 'trade');
        const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
        const approved = cv.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
        if (cv.productId !== product._id ||
          !isCurrentPrice(approved, id, 'trade', now) || approved.packPriceMinor !== option.price) continue;
        variants.push({ id, name: option.name, image: option.image, minimum: cv.orderMinimumPacks,
          increment: cv.orderIncrementPacks, retail: isCurrentPrice(retail, id, 'retail', now) ? retail.packPriceMinor : null, trade: trade ? approved.packPriceMinor : null });
      } catch (error) {
        if (!isCommerceError(error)) throw error;
      }
    }
  } else {
    const priced = await pricedListing(ctx, listing);
    if (!priced) return null;
    inStock = priced.inStock;
    variants = priced.variants.map(x => ({ id: x.id, name: x.name, image: x.image,
      minimum: x.minimum, increment: x.increment, retail: x.retail, trade: trade ? x.trade : null }));
  }
  if (!variants.length) return null;
  const imageMedia = s.imageMedia?.filter(m => m.variantIds.some(id => variants.some(v => v.id === id)));
  return { id: product._id, name: s.name, description: s.description, category: s.category,
    images: imageMedia ? imageMedia.map(m => m.url) : s.images, imageMedia, facts: s.facts,
    assets: await publicAssets(ctx, (await assetsFor(ctx, product._id)) ?? undefined, s.facts), inStock, variants,
    checkoutMode: product.provider === 'zuo' ? 'v2' as const : 'quote' as const };
}


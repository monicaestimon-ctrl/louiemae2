import { requireFlag } from '../lib/flags';
// Deliberate final-price offers preserve external legacy variant IDs.
import type { QueryCtx, MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { assertSellable, isCurrentPrice } from './catCore';
import { currentAshcroftInventory, availableAshcroftAfterCommitments } from './ordInventory';
import { CommerceError } from '../lib/errors';
import { ashcroftScenarios } from './catAshcroftEconomics';

type Ctx = QueryCtx | MutationCtx;
export async function approvedAshcroftOffer(ctx: Ctx, listing: Doc<'commerceListings'>, legacyId: string,
  channel: 'retail' | 'trade', now = Date.now()) {
  requireFlag('DELIVERY_AUTOMATION_ENABLED');
  // The historical retail flag controls the shared v2 retail checkout endpoint.
  requireFlag(channel === 'trade' ? 'TRADE_CHECKOUT_V2_ENABLED' : 'RETAIL_ZUO_CHECKOUT_ENABLED');
  if (!listing.published || listing.pricingMode !== 'approved_v2'
    || listing.channel !== (channel === 'retail' ? 'retail' : 'house'))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'No published approved Ashcroft offer');
  const candidates = await ctx.db.query('catVariants').withIndex('by_product', q => q.eq('productId', listing.productId)).take(201);
  const matches = candidates.filter(cv => cv.legacyVariantId === legacyId);
  if (candidates.length > 200 || matches.length !== 1)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Exact canonical Ashcroft identity required');
  const cv = await assertSellable(ctx, matches[0]._id, 'purchase', now, channel);
  const option = listing.snapshot.variants.filter(v => v.id === legacyId);
  const route = listing.fulfillment?.filter(v => v.id === legacyId) ?? [];
  const stock = await currentAshcroftInventory(ctx, cv, now);
  const priceId = channel === 'retail' ? cv.retailPriceRevisionId : cv.tradePriceRevisionId;
  const price = priceId ? await ctx.db.get(priceId) : null;
  if (option.length !== 1 || route.length !== 1 || route[0].sku !== cv.supplierSku
    || !isCurrentPrice(price, cv._id, channel, now) || price.packPriceMinor !== option[0].price
    || option[0].minimum !== cv.orderMinimumPacks || option[0].increment !== cv.orderIncrementPacks)
    throw new CommerceError('PRICE_CHANGED', 'Republish the current approved channel price');
  const capacity = await availableAshcroftAfterCommitments(ctx, cv, stock.availableUnits, now);
  const economics = await ashcroftScenarios(ctx, cv, { now, reserveRetailCommission: channel === 'retail' && cv.referralEligible !== false });
  return { cv, option: option[0], price, stock, capacity, economics };
}

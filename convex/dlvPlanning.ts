import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import { lineArg } from './dlvEstimates';
import { activeConfig } from './sysConfig';
import type { FreightConfig } from './dlvEngine';
import type { PricingAssumptions, DeliveryLadder } from '../lib/config';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
import { checkPackQuantity, physicalUnits } from '../lib/catUnits';
import { warehouseCurrent } from '../lib/shipping/evidence';
import { viewer, isVerified } from './holmAccess';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';
import type { CartonIn } from '../lib/shipping/classify';

export const planningArgs = { lines: v.array(lineArg), channel: v.union(v.literal('retail'), v.literal('trade')), zip: v.string(), visitorKey: v.string() };

/** Publication is a privacy/content gate. Sales holds are intentionally not a planning gate. */
export const prepare = internalQuery({
  args: { ...planningArgs, staff: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    assertDeliveryBounds(a);
    if (a.staff) await requireDeliveryRole(ctx, 'operations');
    else if (process.env.DELIVERY_PLANNING_ENABLED !== 'true') throw new CommerceError('FEATURE_DISABLED');
    if (!a.staff && a.channel === 'trade' && !isVerified((await viewer(ctx))?.profile ?? null)) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    const freight = await activeConfig<FreightConfig>(ctx, 'carrierRule', 'zuo-freight');
    const policy = await activeConfig<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions');
    const ladder = await activeConfig<DeliveryLadder>(ctx, 'deliveryLadder', 'delivery-ladder');
    const rule = await activeConfig<{ originZip: string; supplierOrderFeeMinor?: number; supplierFeeScope?: string }>(ctx, 'deliveryRule', 'zuo-95206-curbside');
    const now = Date.now();
    if (process.env.FEDEX_RATES_ENABLED !== 'true' || freight.value.rateBasis !== 'live_fedex' || !freight.value.fedex ||
      !freight.value.evidenceRef || !freight.value.verifiedAt || freight.value.verifiedAt > now ||
      !freight.value.validUntil || freight.value.validUntil <= now || freight.value.rule.effectiveFrom > now ||
      (freight.value.rule.effectiveTo ?? Infinity) <= now || rule.value.supplierFeeScope !== 'order' ||
      rule.value.supplierOrderFeeMinor === undefined || rule.value.originZip !== freight.value.originZip) return null;
    const cartons: CartonIn[] = [];
    const budgets: { units: number; allowanceMinor: number; handlingMinor: number }[] = [];
    let expiresAt = Math.min(now + 10 * 60000, freight.value.validUntil, freight.value.rule.effectiveTo ?? Infinity,
      freight.effectiveTo ?? Infinity, policy.effectiveTo ?? Infinity, ladder.effectiveTo ?? Infinity, rule.effectiveTo ?? Infinity);
    const seen = new Set<string>();
    for (const line of a.lines) {
      if (seen.has(line.variantId)) throw new CommerceError('INVALID_INPUT');
      seen.add(line.variantId);
      const pid = ctx.db.normalizeId('commerceProducts', line.productId), vid = ctx.db.normalizeId('catVariants', line.variantId);
      const product = pid ? await ctx.db.get(pid) : null, cv = vid ? await ctx.db.get(vid) : null;
      if (!product || product.provider !== 'zuo' || !cv || cv.productId !== pid || (await ctx.db.get(cv.supplierId))?.code !== 'zuo') return null;
      if (!a.staff) {
        const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', product._id).eq('channel', a.channel === 'retail' ? 'retail' : 'house')).unique();
        if (!listing?.published || !listing.snapshot.variants.some(v => v.id === cv._id)) return null;
      }
      // No stock, cost, margin or commission assertion. Shipping-specific contradictions still block.
      if (cv.availability === 'discontinued' || cv.holds.some(h => ['METHOD_CHANGED', 'CARTON_MISSING', 'SOURCE_ABSENT'].includes(h))) return null;
      checkPackQuantity(cv, line.packs);
      if (!cv.sizeClass || cv.sizeClass === 'UNKNOWN') return null;
      const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
      if (!warehouseCurrent(warehouse, now) || warehouse?.supplierId !== cv.supplierId || warehouse.originZip !== rule.value.originZip || !warehouse.services?.includes('ground')) return null;
      expiresAt = Math.min(expiresAt, warehouse.validUntil!);
      const rows = await ctx.db.query('catCartons').withIndex('by_variant', q => q.eq('variantId', cv._id)).collect();
      if (!rows.length) return null;
      for (const row of rows) {
        const observation = row.sourceObservationId ? await ctx.db.get(row.sourceObservationId) : null;
        if (!observation || observation.variantId !== cv._id || observation.supplierId !== cv.supplierId || observation.field !== 'shipping_evidence' || !observation.contentHash || observation.observedAt > now || (observation.effectiveFrom ?? 0) > now || (observation.effectiveTo ?? Infinity) <= now) return null;
        expiresAt = Math.min(expiresAt, observation.effectiveTo ?? Infinity);
        const count = row.cartonsPerPack * line.packs;
        if (!Number.isSafeInteger(count) || count < 1 || cartons.length + count > 50) return null;
        for (let i = 0; i < count; i++) cartons.push({ lengthMm: row.lengthMm, widthMm: row.widthMm, heightMm: row.heightMm, grossWeightG: row.grossWeightG, supplierMethod: row.supplierMethod });
      }
      budgets.push({ units: physicalUnits(cv, line.packs), allowanceMinor: policy.value.allowanceBySize[cv.sizeClass], handlingMinor: policy.value.handlingPerPieceMinor });
    }
    return { shipment: { originZip: rule.value.originZip, zip: a.zip.trim(), cartons, rule: freight.value.rule, rateType: freight.value.fedex.rateType },
      calculation: { lines: budgets, uncertaintyBps: freight.value.uncertaintyBps, supplierOrderFeeMinor: rule.value.supplierOrderFeeMinor, ladder: ladder.value }, expiresAt };
  },
});

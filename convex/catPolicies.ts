// Supplier policies, promotions, MAP enforcement and market review (spec S13, v2 §8).
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { audit, openReview } from './sysCore';
import { ensureSupplier, supplierByCode } from './catCore';
import { assertMapRespected, assertMechanism, marketFlag, type Mechanism } from '../lib/promotionPolicy';
import { CommerceError } from '../lib/errors';

type Ctx = QueryCtx | MutationCtx;

export async function supplierPolicies(ctx: Ctx, supplierId: Id<'catSuppliers'>, at = Date.now()) {
  const rows = await ctx.db.query('catSupplierPolicies').withIndex('by_supplier_kind', (q) => q.eq('supplierId', supplierId)).collect();
  return rows.filter((r) => r.effectiveFrom <= at && (r.effectiveTo === undefined || r.effectiveTo > at));
}

/**
 * Server check for a discount mechanism on a variant line, after all discounts and credits.
 * Unauthorized mechanisms are refused regardless of MAP arithmetic (PRI03).
 */
export async function assertLineMechanism(ctx: Ctx, variantId: Id<'catVariants'>, mechanism: Mechanism) {
  const cv = await ctx.db.get(variantId);
  if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
  const supplier = await ctx.db.get(cv.supplierId);
  assertMechanism(supplier?.code ?? '', cv.supplierSku, mechanism, await supplierPolicies(ctx, cv.supplierId));
}

/** Net selling-unit price after discounts and credit must respect MAP where it applies. */
export async function assertLineMap(ctx: Ctx, variantId: Id<'catVariants'>, netPackMinor: number) {
  const cv = await ctx.db.get(variantId);
  const cost = cv?.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
  if (!cv || !cost) throw new CommerceError('COST_REVIEW_REQUIRED', 'No cost record');
  const mapPack = cost.mapMinor === null ? null : cost.mapUnitBasis === 'pack' ? cost.mapMinor : cost.mapMinor * cv.piecesPerPack;
  assertMapRespected(netPackMinor, mapPack, cost.mapApplicability);
}

export const policyKind = v.union(v.literal('map'), v.literal('trade'), v.literal('coupon'), v.literal('private_label'), v.literal('media'), v.literal('returns'), v.literal('promotion_stacking'), v.literal('store_credit'));

/** Records written supplier evidence for a policy (D-02). Only documented policies enable mechanisms. */
export const savePolicy = mutation({
  args: {
    supplierCode: v.string(),
    kind: policyKind,
    summary: v.string(),
    evidenceRefs: v.array(v.string()),
    scope: v.object({ all: v.optional(v.boolean()), skus: v.optional(v.array(v.string())) }),
    status: v.union(v.literal('documented'), v.literal('unverified'), v.literal('denied')),
  },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    if (a.status === 'documented' && !a.evidenceRefs.some((r) => r.trim())) throw new CommerceError('INVALID_INPUT', 'A documented policy needs at least one evidence reference.');
    const supplier = await ensureSupplier(ctx, a.supplierCode);
    const now = Date.now();
    for (const old of await supplierPolicies(ctx, supplier._id, now)) if (old.kind === a.kind && JSON.stringify(old.scope) === JSON.stringify(a.scope)) await ctx.db.patch(old._id, { effectiveTo: now });
    const id = await ctx.db.insert('catSupplierPolicies', { supplierId: supplier._id, kind: a.kind, summary: a.summary, evidenceRefs: a.evidenceRefs, scope: a.scope, status: a.status, createdAt: now, createdBy: admin.email, effectiveFrom: now, source: 'admin' });
    if (a.kind === 'private_label' || a.kind === 'media') await ctx.db.patch(supplier._id, { publicAttributionAllowed: a.status === 'documented' });
    await audit(ctx, { actor: admin.email, action: 'supplier.policy', entityTable: 'catSupplierPolicies', entityId: id, after: a });
    return id;
  },
});

export const policies = query({
  args: { supplierCode: v.string() },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    const s = await supplierByCode(ctx, a.supplierCode);
    return s ? supplierPolicies(ctx, s._id) : [];
  },
});

const marketObservation = v.object({
  retailer: v.string(),
  url: v.string(),
  observedAt: v.number(),
  merchandiseMinor: v.number(),
  inStock: v.boolean(),
  deliveryMinor: v.number(),
  serviceLevel: v.string(),
  totalBeforeTaxMinor: v.number(),
  zip: v.string(),
  exactMatch: v.boolean(),
});

/**
 * Records a market review. More than 10% above the median of ≥3 exact comparisons, or materially
 * above the lowest, opens a human review task; prices never change automatically. MSRP is not an
 * observed market price and must not be entered here.
 */
export const recordMarketReview = mutation({
  args: { variantId: v.id('catVariants'), ourDeliveredMinor: v.number(), observations: v.array(marketObservation) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'finance');
    if (a.observations.some((o) => /msrp/i.test(o.retailer))) throw new CommerceError('INVALID_INPUT', 'MSRP is not an observed market price.');
    const f = marketFlag(a.ourDeliveredMinor, a.observations);
    const id = await ctx.db.insert('catMarketReviews', {
      variantId: a.variantId,
      observations: a.observations,
      ourDeliveredMinor: a.ourDeliveredMinor,
      ...(f.medianMinor !== undefined ? { medianDeliveredMinor: f.medianMinor } : {}),
      flag: f.flag,
      reviewer: admin.email,
      createdAt: Date.now(),
    });
    if (f.flag === 'above_median_10pct' || f.flag === 'above_lowest_material') await openReview(ctx, 'market_price', 'catVariants', a.variantId, `Market review flag ${f.flag}`);
    return { id, ...f };
  },
});

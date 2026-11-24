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
    const summary = a.summary.trim();
    const supplierCode = a.supplierCode.trim().toLowerCase();
    const evidenceRefs = [...new Set(a.evidenceRefs.map(r => r.trim()).filter(Boolean))];
    const skus = [...new Set((a.scope.skus ?? []).map(s => s.trim()).filter(Boolean))].sort();
    if (!summary || !supplierCode) throw new CommerceError('INVALID_INPUT', 'Supplier and policy summary are required.');
    if ((a.scope.all === true && skus.length > 0) || (a.scope.all !== true && skus.length === 0))
      throw new CommerceError('INVALID_INPUT', 'Choose all products or provide the specific supplier SKUs.');
    const scope = a.scope.all === true ? { all: true } : { skus };
    if (a.status === 'documented' && !evidenceRefs.length) throw new CommerceError('INVALID_INPUT', 'A documented policy needs at least one evidence reference.');
    const supplier = await ensureSupplier(ctx, supplierCode);
    const now = Date.now();
    for (const old of await supplierPolicies(ctx, supplier._id, now)) {
      const oldScope = old.scope.all === true ? { all: true } : { skus: [...new Set((old.scope.skus ?? []).map(s => s.trim()).filter(Boolean))].sort() };
      if (old.kind === a.kind && JSON.stringify(oldScope) === JSON.stringify(scope)) await ctx.db.patch(old._id, { effectiveTo: now });
    }
    const id = await ctx.db.insert('catSupplierPolicies', { supplierId: supplier._id, kind: a.kind, summary, evidenceRefs, scope, status: a.status, createdAt: now, createdBy: admin.email, effectiveFrom: now, source: 'admin' });
    // SKU-scoped media/private-label evidence does not grant supplier-wide public attribution.
    await audit(ctx, { actor: admin.email, action: 'supplier.policy', entityTable: 'catSupplierPolicies', entityId: id, after: { ...a, supplierCode, summary, evidenceRefs, scope } });
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

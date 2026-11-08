// Pricing engine service (spec S12, v2 §7). Every variant carries a policy id and a reproducible
// scenario result. Approved prices are never overwritten by the engine, and the 5% policy can
// only be held by the approved 306-product cohort.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { activeConfig } from './sysConfig';
import { audit, openReview } from './sysCore';
import { openHold, resolveHold } from './catCore';
import { projectDraftVariants } from './zuoImport';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { rat, mul, parseDecimal } from '../lib/decimal';
import { commissionReserve } from './dlvCommission';
import { piecePriceInfo } from '../lib/catUnits';
import { ENGINE_VERSION, minimumRetail, scenarios, type PricingInput, type SizeClass } from '../lib/economics/pricing';
import type { MarginPolicy, PricingAssumptions, TradeDiscountSchedule } from '../lib/config';
import { stableStringify } from '../lib/zuoImport';

type Ctx = QueryCtx | MutationCtx;
type Opts = { simulate?: boolean };

async function cfg<T>(ctx: Ctx, kind: Parameters<typeof activeConfig>[1], key: string, o: Opts) {
  return (await activeConfig<T>(ctx, kind, key, o.simulate ? { allowProposed: 'simulation' } : {})).value;
}

/** Builds the engine input for a variant from its current evidence and approved config. */
export async function pricingInput(ctx: Ctx, cv: Doc<'catVariants'>, o: Opts = {}): Promise<{ input: PricingInput; category: 'furniture' | 'decor' | 'clothing'; margin: MarginPolicy }> {
  const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
  if (!cost || cost.wholesaleMinor === null) throw new CommerceError('COST_REVIEW_REQUIRED', 'No current wholesale cost');
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', cv.productId)).first();
  const category = meta?.commissionCategory;
  if (!category || category === 'review_required') throw new CommerceError('COST_REVIEW_REQUIRED', 'Commission category needs review');
  const policyKey = cv.marginPolicyKey ?? 'zuo-standard-20';
  const margin = await cfg<MarginPolicy>(ctx, 'marginPolicy', policyKey, o);
  if (margin.blocksAutomaticSale || margin.targetBps === undefined) throw new CommerceError('COST_REVIEW_REQUIRED', `${policyKey} holds automatic sale until a per-SKU floor is approved`);
  const assumptions = await cfg<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions', o);
  const trade = await cfg<TradeDiscountSchedule>(ctx, 'tradeDiscountSchedule', 'trade-discount', o);
  const supplier = await ctx.db.get(cv.supplierId);
  const tradeRule = trade.suppliers[supplier?.code ?? ''];
  if (!tradeRule) throw new CommerceError('POLICY_NOT_APPROVED', `No trade discount schedule for ${supplier?.code}`);
  // Qualification always tests the configured retail referral schedule, including protected rates.
  const maxCommissionBps = (await commissionReserve(ctx,cv.productId,category,true,Date.now())).bps;
  const confirmed = (m: number | null, zero: boolean) => (m !== null ? m : zero ? 0 : null);
  return {
    category,
    margin,
    input: {
      wholesalePiece: cost.wholesalePrecise ? mul(parseDecimal(cost.wholesalePrecise),rat(100)) : rat(cost.wholesaleMinor),
      piecesPerPack: cv.piecesPerPack,
      sizeClass: (cv.sizeClass ?? 'UNKNOWN') as SizeClass,
      extraPackCostsMinor: [confirmed(cost.dutiesMinor, cost.dutiesConfirmedZero), confirmed(cost.inboundFreightMinor, cost.inboundConfirmedZero), confirmed(cost.supplierFeesMinor, cost.feesConfirmedZero)],
      mapPackMinor: cost.mapApplicability === 'applies' && cost.mapMinor !== null ? cost.mapMinor * (cost.mapUnitBasis === 'piece' ? cv.piecesPerPack : 1) : null,
      assumptions,
      maxCommissionBps,
      marginBps: margin.targetBps,
      tradeDiscountBps: cv.marginPolicyKey === 'zuo-approved-5' && tradeRule.approvedExceptionBps ? tradeRule.approvedExceptionBps : tradeRule.defaultBps,
    },
  };
}

/** Runs the engine for a variant (no writes). */
export async function computeScenarios(ctx: Ctx, cv: Doc<'catVariants'>, o: Opts = {}) {
  const { input, category } = await pricingInput(ctx, cv, o);
  const min = minimumRetail(input);
  const approved = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
  const retailMinor = approved?.status === 'approved' ? approved.packPriceMinor : min.retailMinor;
  const s = scenarios({ ...input, retailMinor, fullScheduleBps: input.maxCommissionBps });
  const inputsHash = stableStringify({ ...input, wholesalePiece: `${input.wholesalePiece.n}/${input.wholesalePiece.d}`, retailMinor });
  return { minimumRetailMinor: min.retailMinor, minimumTradeMinor: min.tradeMinor, retailMinor, belowMinimum: retailMinor < min.retailMinor, inputsHash, category, ...s };
}

export const simulate = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    try {
      return { ok: true as const, approvedConfig: true, ...(await computeScenarios(ctx, cv)) };
    } catch (e) {
      // Fall back to proposed config so the owner can see what approval would change.
      try {
        return { ok: true as const, approvedConfig: false, ...(await computeScenarios(ctx, cv, { simulate: true })) };
      } catch (e2) {
        return { ok: false as const, error: String((e2 as Error).message || e) };
      }
    }
  },
});

/** Records scenario results for variants. Never changes an approved price; differences are flagged. */
export async function recordScenarios(ctx: MutationCtx, variantId: Id<'catVariants'>, by: string) {
  const cv = await ctx.db.get(variantId);
  if (!cv) return null;
  let res;
  try {
    res = await computeScenarios(ctx, cv);
  } catch (e) {
    // Missing inputs are already held by freshness evaluation; record why pricing could not run.
    await openReview(ctx, 'pricing_blocked', 'catVariants', variantId, commerceErrorData(e)?.detail ?? String((e as Error).message));
    return null;
  }
  const last = await ctx.db.query('catScenarioResults').withIndex('by_variant_computed', (q) => q.eq('variantId', variantId)).order('desc').first();
  if (last?.inputsHash === res.inputsHash) return last._id;
  const id = await ctx.db.insert('catScenarioResults', { variantId, inputsHash: res.inputsHash, scenarios: res.scenarios, minimumRetailMinor: res.minimumRetailMinor, computedAt: Date.now(), engineVersion: ENGINE_VERSION });
  // Commission prequalification against the full schedule (v2 §7): a visible state, never a hidden cap.
  if (res.referralQualified) {
    await resolveHold(ctx, variantId, 'COMMISSION_UNQUALIFIED', by, 'Full schedule supported');
    if (cv.referralEligible === undefined) await ctx.db.patch(variantId, { referralEligible: true });
  } else {
    await openHold(ctx, variantId, 'COMMISSION_UNQUALIFIED', 'Full-schedule commission scenario is below the margin policy', by);
    if (cv.referralEligible) await ctx.db.patch(variantId, { referralEligible: false });
  }
  if (res.belowMinimum) {
    await openHold(ctx, variantId, 'MARGIN_BELOW_POLICY', `Approved price ${res.retailMinor} is below the engine minimum ${res.minimumRetailMinor}`, by);
    await openReview(ctx, 'price_below_minimum', 'catVariants', variantId, `Approved ${res.retailMinor} < minimum ${res.minimumRetailMinor}`);
  }
  return id;
}

export const recompute = internalMutation({
  args: { variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    for (const id of a.variantIds.slice(0, 50)) await recordScenarios(ctx, id, 'system:pricing');
  },
});

export const recomputeVariants = mutation({
  args: { variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    for (const id of a.variantIds.slice(0, 50)) await recordScenarios(ctx, id, admin.email);
  },
});

/** The owner approves a pack price for a channel; it must clear the engine minimum (or the documented policy) and MAP. */
export const approvePrice = mutation({
  args: { variantId: v.id('catVariants'), channel: v.union(v.literal('retail'), v.literal('trade')), packPriceMinor: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!Number.isSafeInteger(a.packPriceMinor) || a.packPriceMinor <= 0) throw new CommerceError('INVALID_INPUT', 'Price must be a positive whole number of cents');
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add a reason');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const res = await computeScenarios(ctx, cv);
    const floor = a.channel === 'retail' ? res.minimumRetailMinor : res.minimumTradeMinor;
    if (a.packPriceMinor < floor) throw new CommerceError('COST_REVIEW_REQUIRED', `Below the ${cv.marginPolicyKey ?? 'zuo-standard-20'} minimum of ${floor}`, `This price is below the approved minimum of $${(floor / 100).toFixed(2)}.`);
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    if (cost?.mapApplicability === 'applies' && cost.mapMinor !== null && a.packPriceMinor < cost.mapMinor) throw new CommerceError('MAP_POLICY_REVIEW', 'Below MAP');
    const field = a.channel === 'retail' ? 'retailPriceRevisionId' : 'tradePriceRevisionId';
    const now = Date.now();
    const current = cv[field] ? await ctx.db.get(cv[field]!) : null;
    if (current) await ctx.db.patch(current._id, { status: 'superseded', effectiveTo: now });
    const id = await ctx.db.insert('catPriceRevisions', {
      variantId: cv._id,
      channel: a.channel,
      packPriceMinor: a.packPriceMinor,
      piecePriceMinorInfo: piecePriceInfo(a.packPriceMinor, cv.piecesPerPack),
      marginPolicyKey: cv.marginPolicyKey ?? 'zuo-standard-20',
      marginPolicyVersion: 1,
      roundingPolicyVersion: 1,
      approvedBy: admin.email,
      approvedAt: now,
      status: 'approved',
      origin: 'manual',
      reason: a.reason,
      createdAt: now,
      createdBy: admin.email,
      effectiveFrom: now,
      source: 'admin',
    });
    await ctx.db.patch(cv._id, { [field]: id, updatedAt: now });
    await resolveHold(ctx, cv._id, 'MARGIN_BELOW_POLICY', admin.email, 'Price approved at or above the minimum');
    await recordScenarios(ctx, cv._id, admin.email);
    await projectDraftVariants(ctx, cv.productId);
    await audit(ctx, { actor: admin.email, action: 'price.approve', entityTable: 'catVariants', entityId: cv._id, before: current?.packPriceMinor, after: { channel: a.channel, packPriceMinor: a.packPriceMinor }, reason: a.reason });
    return id;
  },
});

/**
 * Assigns a margin policy. The 5% policy is allowed only for the approved 306 cohort; the 18%
 * policy needs a document reference; the MAP-floor hold stays until an explicit floor is set.
 */
export const assignPolicy = mutation({
  args: { variantId: v.id('catVariants'), policyKey: v.string(), documentRef: v.optional(v.string()), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const policy = (await activeConfig<MarginPolicy>(ctx, 'marginPolicy', a.policyKey)).value;
    if (policy.cohort && policy.cohort !== cv.cohort) throw new CommerceError('FORBIDDEN', `${a.policyKey} is limited to the ${policy.cohort} cohort and is never extended automatically`);
    if (policy.requiresDocumentRef && !a.documentRef?.trim()) throw new CommerceError('INVALID_INPUT', `${a.policyKey} needs the document that approves it`);
    await ctx.db.patch(cv._id, { marginPolicyKey: a.policyKey, updatedAt: Date.now() });
    if (!policy.blocksAutomaticSale) await resolveHold(ctx, cv._id, 'MAP_FLOOR_UNAPPROVED', admin.email, `Policy ${a.policyKey}`);
    await audit(ctx, { actor: admin.email, action: 'policy.assign', entityTable: 'catVariants', entityId: cv._id, before: cv.marginPolicyKey, after: a.policyKey, reason: [a.reason, a.documentRef].filter(Boolean).join(' · ') });
  },
});

/** Contribution report rows for the admin (contribution is not operating profit). */
export const contributionReport = query({
  args: { productId: v.id('commerceProducts') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const variants = await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', a.productId)).collect();
    return Promise.all(
      variants.map(async (cv) => ({
        variantId: cv._id,
        sku: cv.supplierSku,
        policy: cv.marginPolicyKey ?? 'zuo-standard-20',
        latest: await ctx.db.query('catScenarioResults').withIndex('by_variant_computed', (q) => q.eq('variantId', cv._id)).order('desc').first(),
        note: 'Contribution after modeled variable costs, commission and allocated overhead. Not a measure of operating profit.',
      }))
    );
  },
});

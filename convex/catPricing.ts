import { internalMutation as indexedInternalMutation, mutation as indexedMutation } from './functions';
// Pricing engine service (spec S12, v2 §7). Every variant carries a policy id and a reproducible
// scenario result. Approved prices are never overwritten by the engine, and the 5% policy can
// only be held by the approved 306-product cohort.
import { v } from 'convex/values';
import { query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { activeConfig } from './sysConfig';
import { audit, openReview } from './sysCore';
import { openHold, resolveHold } from './catCore';
import { projectDraftVariants } from './zuoImport';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { piecePriceInfo } from '../lib/catUnits';
import { ENGINE_VERSION } from '../lib/economics/pricing';
import type { MarginPolicy } from '../lib/config';
export { pricingInput, computeScenarios } from './catEconomics';
import { computeScenarios } from './catEconomics';

export const simulate = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
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
    await openHold(ctx, variantId, 'PRICING_UNVERIFIED', 'Current economics could not be verified', by);
    await openReview(ctx, 'pricing_blocked', 'catVariants', variantId, commerceErrorData(e)?.detail ?? String((e as Error).message));
    return null;
  }
  const last = await ctx.db.query('catScenarioResults').withIndex('by_variant_computed', (q) => q.eq('variantId', variantId)).order('desc').first();
  const id = last?.inputsHash === res.inputsHash && last.engineVersion === ENGINE_VERSION ? last._id : await ctx.db.insert('catScenarioResults', { variantId, inputsHash: res.inputsHash, scenarios: res.scenarios, minimumRetailMinor: res.minimumRetailMinor, computedAt: Date.now(), engineVersion: ENGINE_VERSION });
  // Reusing an identical calculation must still repair eligibility and holds.
  if (res.retailApproved) await resolveHold(ctx, variantId, 'PRICING_UNVERIFIED', by, 'Current economics verified');
  else await openHold(ctx, variantId, 'PRICING_UNVERIFIED', 'A calculated candidate is not an approved retail price', by);
  // Commission prequalification against the full schedule (v2 §7): a visible state, never a hidden cap.
  if (res.referralQualified) {
    await resolveHold(ctx, variantId, 'COMMISSION_UNQUALIFIED', by, 'Full schedule supported');
    if (cv.referralEligible === undefined) await ctx.db.patch(variantId, { referralEligible: true });
  } else {
    await openHold(ctx, variantId, 'COMMISSION_UNQUALIFIED', 'Full-schedule commission scenario is below the margin policy', by);
    if (cv.referralEligible) await ctx.db.patch(variantId, { referralEligible: false });
  }
  if (res.belowMinimum || res.belowTradeMinimum) {
    const detail = `Retail ${res.retailMinor} / minimum ${res.minimumRetailMinor}; trade ${res.tradeMinor ?? 'unapproved'} / minimum ${res.minimumTradeMinor}`;
    await openHold(ctx, variantId, 'MARGIN_BELOW_POLICY', detail, by);
    await openReview(ctx, 'price_below_minimum', 'catVariants', variantId, detail);
  } else await resolveHold(ctx, variantId, 'MARGIN_BELOW_POLICY', by, 'Both approved prices meet their current minimums');
  return id;
}

export const recompute = indexedInternalMutation({
  args: { variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    for (const id of a.variantIds.slice(0, 50)) await recordScenarios(ctx, id, 'system:pricing');
  },
});

export const recomputeVariants = indexedMutation({
  args: { variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'finance');
    for (const id of a.variantIds.slice(0, 50)) await recordScenarios(ctx, id, admin.email);
  },
});

/** The owner approves a pack price for a channel; it must clear the engine minimum (or the documented policy) and MAP. */
export const approvePrice = indexedMutation({
  args: { variantId: v.id('catVariants'), channel: v.union(v.literal('retail'), v.literal('trade')), packPriceMinor: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    if (!Number.isSafeInteger(a.packPriceMinor) || a.packPriceMinor <= 0) throw new CommerceError('INVALID_INPUT', 'Price must be a positive whole number of cents');
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add a reason');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const res = await computeScenarios(ctx, cv);
    const floor = a.channel === 'retail' ? res.minimumRetailMinor : res.minimumTradeMinor;
    if (a.packPriceMinor < floor) throw new CommerceError('COST_REVIEW_REQUIRED', `Below the ${cv.marginPolicyKey ?? 'zuo-standard-20'} minimum of ${floor}`, `This price is below the approved minimum of $${(floor / 100).toFixed(2)}.`);
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    if (cost?.mapApplicability === 'applies' && cost.mapMinor !== null && a.packPriceMinor < cost.mapMinor * (cost.mapUnitBasis === 'piece' ? cv.piecesPerPack : 1)) throw new CommerceError('MAP_POLICY_REVIEW', 'Below pack MAP');
    const marginPolicy = await activeConfig(ctx, 'marginPolicy', cv.marginPolicyKey ?? 'zuo-standard-20');
    const roundingPolicy = await activeConfig(ctx, 'roundingPolicy', 'rounding-pack-up-cents');
    const field = a.channel === 'retail' ? 'retailPriceRevisionId' : 'tradePriceRevisionId';
    const now = Date.now();
    const current = cv[field] ? await ctx.db.get(cv[field]!) : null;
    if (current && (current.variantId !== cv._id || current.channel !== a.channel))
      throw new CommerceError('COST_REVIEW_REQUIRED', 'Price revision does not belong to this variant and channel');
    if (current) await ctx.db.patch(current._id, { status: 'superseded', effectiveTo: now });
    const id = await ctx.db.insert('catPriceRevisions', {
      variantId: cv._id,
      channel: a.channel,
      packPriceMinor: a.packPriceMinor,
      piecePriceMinorInfo: piecePriceInfo(a.packPriceMinor, cv.piecesPerPack),
      marginPolicyKey: cv.marginPolicyKey ?? 'zuo-standard-20',
      marginPolicyVersion: marginPolicy.version,
      roundingPolicyVersion: roundingPolicy.version,
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
export const assignPolicy = indexedMutation({
  args: { variantId: v.id('catVariants'), policyKey: v.string(), documentRef: v.optional(v.string()), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const policy = (await activeConfig<MarginPolicy>(ctx, 'marginPolicy', a.policyKey)).value;
    if (policy.cohort && policy.cohort !== cv.cohort) throw new CommerceError('FORBIDDEN', `${a.policyKey} is limited to the ${policy.cohort} cohort and is never extended automatically`);
    if (policy.requiresDocumentRef && !a.documentRef?.trim()) throw new CommerceError('INVALID_INPUT', `${a.policyKey} needs the document that approves it`);
    await ctx.db.patch(cv._id, { marginPolicyKey: a.policyKey, marginPolicyDocumentRef: a.documentRef?.trim() || undefined, updatedAt: Date.now() });
    if (!policy.blocksAutomaticSale) await resolveHold(ctx, cv._id, 'MAP_FLOOR_UNAPPROVED', admin.email, `Policy ${a.policyKey}`);
    await recordScenarios(ctx, cv._id, admin.email);
    await audit(ctx, { actor: admin.email, action: 'policy.assign', entityTable: 'catVariants', entityId: cv._id, before: cv.marginPolicyKey, after: a.policyKey, reason: [a.reason, a.documentRef].filter(Boolean).join(' · ') });
  },
});

/** Contribution report rows for the admin (contribution is not operating profit). */
export const contributionReport = query({
  args: { productId: v.id('commerceProducts') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
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

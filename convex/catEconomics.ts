// Read-only Zuo economics shared by approval, publication, referral and checkout.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { activeConfig } from './sysConfig';
import { CommerceError } from '../lib/errors';
import { rat, mul, parseDecimal } from '../lib/decimal';
import { commissionReserve } from './dlvCommission';
import { minimumRetail, minimumTrade, scenarios, type PricingInput, type SizeClass } from '../lib/economics/pricing';
import type { MarginPolicy, PricingAssumptions, TradeDiscountSchedule } from '../lib/config';
import { stableStringify } from '../lib/zuoImport';
import { isCurrentPrice } from './catPriceValidity';
import { costIntegrityIssue } from './catCostValidity';
import { evaluateVariant, type Observation } from '../lib/catFreshness';
import type { FreshnessPolicy } from '../lib/config';
type Ctx = QueryCtx | MutationCtx;
type Opts = { simulate?: boolean; now?: number; reserveRetailCommission?: boolean };

async function cfg<T>(ctx: Ctx, kind: Parameters<typeof activeConfig>[1], key: string, o: Opts) {
  return (await activeConfig<T>(ctx, kind, key, { at: o.now, ...(o.simulate ? { allowProposed: 'simulation' as const } : {}) })).value;
}

/** Builds the engine input for a variant from its current evidence and approved config. */
export async function pricingInput(ctx: Ctx, cv: Doc<'catVariants'>, o: Opts = {}): Promise<{ input: PricingInput; category: 'furniture' | 'decor' | 'clothing'; margin: MarginPolicy }> {
  o = { ...o, now: o.now ?? Date.now() };
  const supplier = await ctx.db.get(cv.supplierId);
  if (supplier?.code !== 'zuo') throw new CommerceError('COST_REVIEW_REQUIRED', 'Supplier-specific economics adapter required');
  const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
  if (!cost || cost.wholesaleMinor === null) throw new CommerceError('COST_REVIEW_REQUIRED', 'No current wholesale cost');
  if (cost.wholesaleUnitBasis && cost.wholesaleUnitBasis !== 'piece')
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Zuo wholesale must be recorded per physical piece');
  const integrity = costIntegrityIssue(cost, cv, o.now!);
  if (integrity) throw new CommerceError('COST_REVIEW_REQUIRED', integrity);
  const policy = await cfg<FreshnessPolicy>(ctx, 'freshnessPolicy', supplier.freshnessKey, o);
  const observations = await ctx.db.query('catSourceObservations').withIndex('by_variant_field_observed', q => q.eq('variantId', cv._id)).order('desc').take(200);
  const evidence = evaluateVariant({ cost, piecesPerPack: cv.piecesPerPack, cartons: 1,
    observations: observations as Observation[], policy, now: o.now! });
  const costHolds = evidence.holds.filter(h => h !== 'STOCK_UNVERIFIED');
  if (costHolds.length) throw new CommerceError('COST_REVIEW_REQUIRED', costHolds.join(','));
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', cv.productId)).first();
  const category = meta?.commissionCategory;
  if (!category || category === 'review_required') throw new CommerceError('COST_REVIEW_REQUIRED', 'Commission category needs review');
  const policyKey = cv.marginPolicyKey;
  if (!policyKey) throw new CommerceError('COST_REVIEW_REQUIRED', 'No margin policy assigned to this variant');
  const margin = await cfg<MarginPolicy>(ctx, 'marginPolicy', policyKey, o);
  if (margin.cohort && margin.cohort !== cv.cohort) throw new CommerceError('COST_REVIEW_REQUIRED', 'Margin policy is not approved for this cohort');
  if (margin.requiresDocumentRef && !cv.marginPolicyDocumentRef?.trim()) throw new CommerceError('COST_REVIEW_REQUIRED', 'Margin exception requires its approval document');
  if (margin.blocksAutomaticSale || margin.targetBps === undefined) throw new CommerceError('COST_REVIEW_REQUIRED', `${policyKey} holds automatic sale until a per-SKU floor is approved`);
  const assumptions = await cfg<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions', o);
  const trade = await cfg<TradeDiscountSchedule>(ctx, 'tradeDiscountSchedule', 'trade-discount', o);
  const tradeRule = trade.suppliers[supplier?.code ?? ''];
  if (!tradeRule) throw new CommerceError('POLICY_NOT_APPROVED', `No trade discount schedule for ${supplier?.code}`);
  // Referral qualification funds protected rates; trade and explicitly non-referral offers reserve zero.
  const maxCommissionBps = o.reserveRetailCommission === false ? 0 :
    (await commissionReserve(ctx,cv.productId,category,true,o.now!)).bps;
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
  o = { ...o, now: o.now ?? Date.now() };
  const { input, category } = await pricingInput(ctx, cv, o);
  const min = minimumRetail(input);
  const tradeFloor = minimumTrade(input);
  const approved = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
  const trade = cv.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
  const retailApproved = isCurrentPrice(approved, cv._id, 'retail', o.now);
  const tradeApproved = isCurrentPrice(trade, cv._id, 'trade', o.now);
  const retailMinor = retailApproved ? approved.packPriceMinor : min.retailMinor;
  const tradeMinor = tradeApproved ? trade.packPriceMinor : null;
  const s = scenarios({ ...input, retailMinor, fullScheduleBps: input.maxCommissionBps,
    extra: tradeMinor === null ? [] : [{ name: 'trade_approved', priceMinor: tradeMinor, commissionBps: 0 }],
  });
  const inputsHash = stableStringify({ ...input, wholesalePiece: `${input.wholesalePiece.n}/${input.wholesalePiece.d}`, retailMinor, tradeMinor, retailApproved, tradeApproved });
  return { minimumRetailMinor: min.retailMinor, minimumTradeMinor: tradeFloor, retailMinor, tradeMinor, retailApproved, tradeApproved,
    belowMinimum: retailMinor < min.retailMinor, belowTradeMinimum: tradeMinor !== null && tradeMinor < tradeFloor,
    inputsHash, category, ...s, referralQualified: retailApproved && o.reserveRetailCommission !== false && s.referralQualified };
}

/** Candidate prices are useful for planning, but cannot establish a payable offer. */
export async function qualifyApprovedPrice(ctx: Ctx, cv: Doc<'catVariants'>, channel: 'retail' | 'trade', now = Date.now()) {
  if (channel === 'retail' && cv.referralEligible === undefined)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Commission eligibility unresolved');
  const fundReferrals = channel === 'retail' && cv.referralEligible === true;
  const result = await computeScenarios(ctx, cv, { now, reserveRetailCommission: fundReferrals });
  if (!(channel === 'retail' ? result.retailApproved : result.tradeApproved))
    throw new CommerceError('COST_REVIEW_REQUIRED', `No current approved ${channel} price`);
  if (channel === 'retail' ? result.belowMinimum || (fundReferrals && !result.referralQualified) : result.belowTradeMinimum)
    throw new CommerceError('COST_REVIEW_REQUIRED', `Current ${channel} price does not fund its approved margin, delivery allowance and commission`);
  return result;
}

import { ashcroftListingIdentity } from './catAshcroftListingIdentity';
// Read-only Ashcroft qualification. Legacy storefront pricing is not cut over by this service.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { activeConfig } from './sysConfig';
import { CommerceError } from '../lib/errors';
import { parseConfig, type AshcroftPricingAssumptions, type FreshnessPolicy, type MarginPolicy, type TradeDiscountSchedule } from '../lib/config';
import { costIntegrityIssue, costObservations } from './catCostValidity';
import { evaluateVariant, type Observation } from '../lib/catFreshness';
import { commissionReserve } from './dlvCommission';
import { retailDelivery } from '../lib/retailLaunch';
import { isLighting } from '../lib/catCategory';
import { bpsRat, mul, parseDecimal, rat, sub, toMinor } from '../lib/decimal';
import { ASHCROFT_ENGINE_VERSION, ashcroftBase, ashcroftMinimums, ashcroftScenario, type AshcroftPricingInput } from '../lib/economics/ashcroft';
import { isCurrentPrice } from './catPriceValidity';
import { stableStringify } from '../lib/zuoImport';

type Ctx = QueryCtx | MutationCtx;
type Options = { simulate?: boolean; now?: number; reserveRetailCommission?: boolean };

export async function ashcroftScenarios(ctx: Ctx, cv: Doc<'catVariants'>, options: Options = {}) {
  const now = options.now ?? Date.now();
  const cfgOptions = { at: now, ...(options.simulate ? { allowProposed: 'simulation' as const } : {}) };
  const supplier = await ctx.db.get(cv.supplierId);
  const product = await ctx.db.get(cv.productId);
  if (supplier?.code !== 'ashcroft' || product?.provider !== 'ashcroft' || !cv.legacyVariantId
    || cv.optionKey !== cv.legacyVariantId || cv.packId !== '1' || cv.piecesPerPack !== 1)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Exact Ashcroft selling-unit identity required');
  const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
  const issue = costIntegrityIssue(cost, cv, now);
  if (issue || !cost) throw new CommerceError('COST_REVIEW_REQUIRED', issue ?? 'Cost missing');
  if (cost.wholesaleUnitBasis !== 'selling_unit' || (cost.mapApplicability === 'applies' && cost.mapUnitBasis !== 'pack'))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Ashcroft wholesale and MAP require a confirmed selling-unit basis');
  const freshness = await activeConfig<FreshnessPolicy>(ctx, 'freshnessPolicy', supplier.freshnessKey, cfgOptions);
  const observations = await costObservations(ctx, cv._id, now);
  const evidence = evaluateVariant({ cost, piecesPerPack: 1, cartons: 0, observations: observations as Observation[], policy: freshness.value, now });
  // This service qualifies merchandise costs only. Inventory is independently required at sale;
  // the approved Ashcroft per-item delivery model does not derive freight from carton dimensions.
  const costHolds = evidence.holds.filter(h => h !== 'STOCK_UNVERIFIED' && h !== 'CARTON_MISSING');
  if (costHolds.length) throw new CommerceError('COST_REVIEW_REQUIRED', costHolds.join(','));
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', cv.productId)).unique();
  if (!meta || meta.supplierId !== supplier._id || meta.commissionCategory === 'review_required')
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Reviewed Ashcroft category required');
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', cv.productId).eq('channel', 'retail')).unique();
  if (!listing) throw new CommerceError('COST_REVIEW_REQUIRED', 'Retail source missing');
  ashcroftListingIdentity(listing, cv);
  const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
  if (!rate) throw new CommerceError('DELIVERY_QUOTE_REQUIRED', 'No Ashcroft per-item delivery model');
  if (isLighting(`${listing.snapshot.category} ${listing.snapshot.name}`) && meta.commissionCategory !== 'decor')
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Lighting requires an audited category correction to decor before pricing qualification');
  const category = meta.commissionCategory;
  const delivery = await activeConfig<{ engine: string; source: string }>(ctx, 'deliveryRule', 'ashcroft-launch', cfgOptions);
  if (delivery.value.engine !== 'ashcroft_per_item' || delivery.value.source !== 'lib/retailLaunch.ts retailDelivery()')
    throw new CommerceError('POLICY_NOT_APPROVED', 'Unsupported Ashcroft delivery policy');
  if (!cv.marginPolicyKey) throw new CommerceError('COST_REVIEW_REQUIRED', 'No Ashcroft margin policy assigned');
  const margin = await activeConfig<MarginPolicy>(ctx, 'marginPolicy', cv.marginPolicyKey, cfgOptions);
  if (margin.value.blocksAutomaticSale || margin.value.targetBps === undefined
    || (margin.value.cohort && margin.value.cohort !== cv.cohort)
    || (margin.value.requiresDocumentRef && !cv.marginPolicyDocumentRef?.trim())
    || cv.marginPolicyKey.startsWith('zuo-'))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'An applicable documented Ashcroft margin policy is required');
  const assumptions = await activeConfig<AshcroftPricingAssumptions>(ctx, 'pricingAssumptions', 'ashcroft-pricing-assumptions', cfgOptions);
  parseConfig('pricingAssumptions', assumptions.value);
  const trade = await activeConfig<TradeDiscountSchedule>(ctx, 'tradeDiscountSchedule', 'trade-discount', cfgOptions);
  const rule = trade.value.suppliers.ashcroft;
  if (!rule || !Number.isSafeInteger(rule.defaultBps) || rule.defaultBps < 0 || rule.defaultBps >= 10000
    || !Number.isSafeInteger(trade.value.general?.maxBps) || trade.value.general.maxBps < 0 || trade.value.general.maxBps >= 10000
    || rule.defaultBps > trade.value.general.maxBps
    || assumptions.value.fundedTradeDiscountBps > rule.defaultBps
    || assumptions.value.fundedTradeDiscountBps > trade.value.general.maxBps)
    throw new CommerceError('POLICY_NOT_APPROVED', 'Explicit Ashcroft trade schedule required');
  const reserve = options.reserveRetailCommission === false ? { bps: 0, versions: [], validUntil: undefined }
    : await commissionReserve(ctx, cv.productId, category, true, now);
  const known = (value: number | null, zero: boolean) => value ?? (zero ? 0 : null);
  const input: AshcroftPricingInput = {
    wholesaleSellingUnit: cost.wholesalePrecise ? mul(parseDecimal(cost.wholesalePrecise), rat(100)) : rat(cost.wholesaleMinor!),
    extraSellingUnitCostsMinor: [known(cost.dutiesMinor, cost.dutiesConfirmedZero), known(cost.inboundFreightMinor, cost.inboundConfirmedZero), known(cost.supplierFeesMinor, cost.feesConfirmedZero)],
    modeledFreightMinor: rate.freight, customerDeliveryMinor: rate.delivery,
    mapSellingUnitMinor: cost.mapApplicability === 'applies' ? cost.mapMinor : null,
    assumptions: assumptions.value, marginBps: margin.value.targetBps, maxCommissionBps: reserve.bps,
  };
  const minimums = ashcroftMinimums(input);
  const exactBase = ashcroftBase(input);
  const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
  const tradePrice = cv.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
  const retailApproved = isCurrentPrice(retail, cv._id, 'retail', now);
  const tradeApproved = isCurrentPrice(tradePrice, cv._id, 'trade', now);
  const retailMinor = retailApproved ? retail.packPriceMinor : minimums.minimumRetailMinor;
  const tradeMinor = tradeApproved ? tradePrice.packPriceMinor : null;
  // The advertised maximum is a cap, not a promise to grant that reduction to every SKU.
  const minimumBaseTradeMinor = retailApproved ? Math.max(minimums.minimumTradeMinor,
    toMinor(mul(rat(retailMinor), sub(rat(1), bpsRat(trade.value.general.maxBps))), 'ceil')) : minimums.minimumTradeMinor;
  const scenarios = [ashcroftScenario(input, 'retail_direct', retailMinor, 0),
    ashcroftScenario(input, 'retail_max_commission', retailMinor, reserve.bps),
    ...(tradeMinor === null ? [] : [ashcroftScenario(input, 'trade_approved', tradeMinor, 0)])];
  const inputsHash = stableStringify({ engine: ASHCROFT_ENGINE_VERSION, input: { ...input, wholesaleSellingUnit: `${input.wholesaleSellingUnit.n}/${input.wholesaleSellingUnit.d}` },
    cost: cost._id, listingRevision: listing.revision, category, retailMinor, tradeMinor, retailApproved, tradeApproved,
    policies: [freshness, delivery, margin, assumptions, trade].map(p => ({ id: p.id, version: p.version })), reserve });
  const policies = [freshness, delivery, margin, assumptions, trade];
  return { ...minimums, minimumBaseTradeMinor, retailMinor, tradeMinor, retailApproved, tradeApproved,
    basketBasis: { baseMinor: minimums.basePackMinor, baseNumerator: String(exactBase.n), baseDenominator: String(exactBase.d), processingBps: assumptions.value.processingBps,
      returnsBps: assumptions.value.returnsBps, overheadBps: assumptions.value.overheadBps,
      marginBps: margin.value.targetBps, commissionBps: reserve.bps,
      freightMinor: rate.freight, deliveryMinor: rate.delivery },
    validUntil: Math.min(cost.effectiveTo ?? Number.MAX_SAFE_INTEGER,
      cost.verifiedAt! + freshness.value.costMapMaxDays * 86400000,
      ...policies.map(p => p.effectiveTo ?? Number.MAX_SAFE_INTEGER), reserve.validUntil ?? Number.MAX_SAFE_INTEGER,
      ...(retailApproved ? [retail.effectiveTo ?? Number.MAX_SAFE_INTEGER] : []),
      ...(tradeApproved ? [tradePrice.effectiveTo ?? Number.MAX_SAFE_INTEGER] : [])),
    belowMinimum: retailMinor < minimums.minimumRetailMinor,
    belowTradeMinimum: tradeMinor !== null && tradeMinor < minimumBaseTradeMinor,
    inputsHash, category, scenarios, engineVersion: ASHCROFT_ENGINE_VERSION,
    referralQualified: retailApproved && options.reserveRetailCommission !== false && scenarios[1].passes };
}

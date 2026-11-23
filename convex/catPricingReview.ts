// Read-only finance review state; never returned from storefront or partner APIs.
import type { QueryCtx, MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { computeScenarios } from './catEconomics';
import { costObservations } from './catCostValidity';
import { schedule, productRate } from './prgAttribution';
import { evaluate } from './catCore';
import { digest } from './dlvSecurity';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { isCurrentPrice } from './catPriceValidity';
import type { MarginPolicy } from '../lib/config';

type Ctx = QueryCtx | MutationCtx;
const errorText = (error: unknown) =>
  commerceErrorData(error)?.detail ?? (error instanceof Error ? error.message : 'Review required');
export async function pricingReview(ctx: Ctx, variantId: Id<'catVariants'>) {
  const variant = await ctx.db.get(variantId);
  if (!variant) throw new CommerceError('INVALID_INPUT', 'Variant not found');
  const now = Date.now();
  const [supplier, meta, cost, retail, trade, listings, observations, exceptions] =
    await Promise.all([
      ctx.db.get(variant.supplierId),
      ctx.db
        .query('catProductMeta')
        .withIndex('by_product', (q) => q.eq('productId', variant.productId))
        .unique(),
      variant.currentCostRevisionId ? ctx.db.get(variant.currentCostRevisionId) : null,
      variant.retailPriceRevisionId ? ctx.db.get(variant.retailPriceRevisionId) : null,
      variant.tradePriceRevisionId ? ctx.db.get(variant.tradePriceRevisionId) : null,
      ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) => q.eq('productId', variant.productId))
        .collect(),
      costObservations(ctx, variantId, now),
      ctx.db
        .query('prgSkuCommissionExceptions')
        .withIndex('by_product_effective', (q) => q.eq('productId', variant.productId))
        .order('desc')
        .take(101),
    ]);
  if (exceptions.length > 100)
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Commission history requires a complete scoped review'
    );
  const kinds = [
    'marginPolicy',
    'pricingAssumptions',
    'tradeDiscountSchedule',
    'commissionSchedule',
    'freshnessPolicy',
    'roundingPolicy',
    'deliveryRule',
    'projectDiscountPolicy',
    'promotionPolicy',
  ] as const;
  const groups = await Promise.all(
    kinds.map((kind) =>
      ctx.db
        .query('sysConfig')
        .withIndex('by_kind_key_version', (q) => q.eq('kind', kind))
        .take(501)
    )
  );
  if (groups.some((rows) => rows.length > 500))
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Pricing configuration history requires a complete scoped review'
    );
  const configs = groups.flat();
  const active = configs.filter(
    (c) =>
      c.status === 'approved' &&
      c.effectiveFrom <= now &&
      (c.effectiveTo === undefined || c.effectiveTo > now)
  );
  const currentPolicies = active.filter(
    (c) =>
      c.kind === 'marginPolicy' &&
      !active.some(
        (other) => other.kind === c.kind && other.key === c.key && other.version > c.version
      )
  );
  const policies = currentPolicies.map((p) => {
    const value = p.value as MarginPolicy;
    const applicable =
      supplier?.code === 'zuo'
        ? p.key.startsWith('zuo-')
        : supplier?.code === 'ashcroft' && !p.key.startsWith('zuo-');
    return {
      key: p.key,
      version: p.version,
      targetBps: value.targetBps ?? null,
      eligible:
        !!applicable &&
        !value.blocksAutomaticSale &&
        (!value.cohort || value.cohort === variant.cohort),
      cohort: value.cohort ?? null,
      requiresDocumentRef: !!value.requiresDocumentRef,
    };
  });
  let economics;
  try {
    economics = {
      ok: true as const,
      result: await computeScenarios(ctx, variant, {
        now,
        reserveRetailCommission: variant.referralEligible !== false,
      }),
    };
  } catch (error) {
    economics = { ok: false as const, error: errorText(error) };
  }
  let freshness;
  try {
    freshness = { ok: true as const, result: await evaluate(ctx, variant, now) };
  } catch (error) {
    freshness = { ok: false as const, error: errorText(error) };
  }
  let commission;
  try {
    if (!meta || meta.commissionCategory === 'review_required')
      throw new CommerceError('COST_REVIEW_REQUIRED', 'Review the commission category first');
    const current = await schedule(ctx);
    const rates = await Promise.all(
      (['base', 'active', 'top', 'elite'] as const).map(async (tierKey) => ({
        tierKey,
        rateBps: (
          await productRate(
            ctx,
            variant.productId,
            tierKey,
            meta.commissionCategory as 'furniture' | 'decor' | 'clothing',
            current.value
          )
        ).rateBps,
      }))
    );
    commission = { ok: true as const, rates };
  } catch (error) {
    commission = { ok: false as const, error: errorText(error) };
  }
  const state = {
    variant,
    supplier,
    meta,
    cost,
    retail,
    trade,
    listings,
    observations,
    exceptions,
    configs,
    active: active.map((c) => c._id),
    policies,
    economics,
    freshness,
    commission,
  };
  const reviewHash = await digest(state);
  const externalId = supplier?.code === 'ashcroft' ? variant.legacyVariantId : String(variant._id);
  return {
    reviewHash,
    variant,
    supplierCode: supplier?.code ?? null,
    name: meta?.louieMaeName ?? variant.louieMaeVariantName,
    category: meta?.commissionCategory ?? 'review_required',
    cost,
    policies,
    economics,
    freshness,
    commission,
    prices: {
      retail: retail && isCurrentPrice(retail, variantId, 'retail', now) ? retail : null,
      trade: trade && isCurrentPrice(trade, variantId, 'trade', now) ? trade : null,
    },
    published: listings.map((l) => ({
      channel: l.channel,
      published: l.published,
      pricingMode: l.pricingMode ?? 'legacy',
      amountMinor: l.snapshot.variants.find((v) => v.id === externalId)?.price ?? null,
    })),
    exceptions: exceptions
      .slice(0, 10)
      .map((e) => ({
        id: e._id,
        version: e.version,
        rates: e.rates,
        visibleNote: e.visibleNote,
        effectiveFrom: e.effectiveFrom,
        effectiveTo: e.effectiveTo ?? null,
      })),
    exceptionHistoryTruncated: exceptions.length > 10,
  };
}
export async function assertPricingReview(
  ctx: Ctx,
  variantId: Id<'catVariants'>,
  expected?: string
) {
  if (expected === undefined) return;
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    (await pricingReview(ctx, variantId)).reviewHash !== expected
  )
    throw new CommerceError(
      'PRICE_CHANGED',
      'Pricing evidence or terms changed. Refresh the review before approving.'
    );
}

import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from './_generated/server';
import { viewer, isVerified } from './holmAccess';
import { activeConfig, maybeConfig } from './sysConfig';
import type { CommissionSchedule, TradeDiscountSchedule } from '../lib/config';
import { CommerceError } from '../lib/errors';
import { beneficiaryOf } from './prgCore';
import { productRate } from './prgAttribution';
import { assertSellable } from './catCore';
import { checkPackQuantity } from '../lib/catUnits';
import { projectPrices, approvedProjectPolicy } from './dlvProjectPricing';
import { lineArg } from './dlvEstimates';
import { flag, requireFlag } from '../lib/flags';

export const settings = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    const schedule = await maybeConfig<CommissionSchedule>(
      ctx,
      'commissionSchedule',
      'commission-schedule'
    );
    const project = await approvedProjectPolicy(ctx);
    return {
      enabled: flag('TRADE_CALCULATOR_V2_ENABLED'),
      approvedTrade: isVerified(me?.profile ?? null),
      commissionSchedule: schedule?.value ?? null,
      commissionVersion: schedule?.version ?? null,
      projectTiers: project?.value.tiers ?? null,
      projectVersion: project?.version ?? null,
    };
  },
});
export const catalog = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    requireFlag('TRADE_CALCULATOR_V2_ENABLED');
    const me = await viewer(ctx);
    if (!isVerified(me?.profile ?? null)) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    const page = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', 'house').eq('published', true))
      .paginate(a.paginationOpts);
    const products = [];
    for (const p of page.page) {
      const variants = [];
      for (const x of p.snapshot.variants) {
        const id = ctx.db.normalizeId('catVariants', x.id);
        const cv = id ? await ctx.db.get(id) : null;
        const price = cv?.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
        if (
          cv &&
          price?.status === 'approved' &&
          cv.currentCostRevisionId &&
          !cv.holds.length &&
          cv.availability === 'in_stock'
        )
          variants.push({
            id: x.id,
            name: x.name,
            minimum: cv.orderMinimumPacks,
            increment: cv.orderIncrementPacks,
          });
      }
      if (variants.length) products.push({ id: p.productId, name: p.snapshot.name, variants });
    }
    return { ...page, page: products };
  },
});
export const calculate = query({
  args: { lines: v.array(lineArg) },
  handler: async (ctx, a) => {
    requireFlag('TRADE_CALCULATOR_V2_ENABLED');
    const me = await viewer(ctx);
    if (!me || !isVerified(me.profile)) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    if (!a.lines.length || a.lines.length > 100) throw new CommerceError('INVALID_INPUT');
    const [tradeRule, project, schedule, beneficiary] = await Promise.all([
      activeConfig<TradeDiscountSchedule>(ctx, 'tradeDiscountSchedule', 'trade-discount'),
      approvedProjectPolicy(ctx),
      maybeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule'),
      beneficiaryOf(ctx, me.userId),
    ]);
    const seen = new Set<string>();
    const lines = [];
    const projectInputs = [];
    for (const l of a.lines) {
      if (seen.has(l.variantId)) throw new CommerceError('INVALID_INPUT');
      seen.add(l.variantId);
      const id = ctx.db.normalizeId('catVariants', l.variantId);
      if (!id)
        throw new CommerceError(
          'COST_REVIEW_REQUIRED',
          'This item needs an approved project quote'
        );
      const cv = await assertSellable(ctx, id, 'estimate');
      if (cv.productId !== l.productId) throw new CommerceError('INVALID_INPUT');
      checkPackQuantity(cv, l.packs);
      const [supplier, retail, trade, meta, retailListing, tradeListing] = await Promise.all([
        ctx.db.get(cv.supplierId),
        cv.retailPriceRevisionId ? ctx.db.get(cv.retailPriceRevisionId) : null,
        cv.tradePriceRevisionId ? ctx.db.get(cv.tradePriceRevisionId) : null,
        ctx.db
          .query('catProductMeta')
          .withIndex('by_product', (q) => q.eq('productId', cv.productId))
          .unique(),
        ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) =>
            q.eq('productId', cv.productId).eq('channel', 'retail')
          )
          .unique(),
        ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) =>
            q.eq('productId', cv.productId).eq('channel', 'house')
          )
          .unique(),
      ]);
      if (
        !tradeListing?.published ||
        trade?.status !== 'approved' ||
        trade.packPriceMinor <= 0 ||
        tradeListing.snapshot.variants.find((v) => v.id === cv._id)?.price !== trade.packPriceMinor
      )
        throw new CommerceError('COST_REVIEW_REQUIRED');
      const category = meta?.commissionCategory;
      const comparable =
        retailListing?.published &&
        retail?.status === 'approved' &&
        retail.packPriceMinor > 0 &&
        retailListing.snapshot.variants.find((v) => v.id === cv._id)?.price ===
          retail.packPriceMinor;
      const eligibleProject =
        !!supplier &&
        supplier.code !== 'zuo' &&
        tradeRule.value.suppliers[supplier.code]?.projectStacking === true;
      let commissionRate: number | null = null;
      if (
        beneficiary &&
        schedule &&
        cv.referralEligible === true &&
        category &&
        category !== 'review_required' &&
        comparable
      )
        commissionRate = (
          await productRate(ctx, cv.productId, beneficiary.tierKey, category, schedule.value)
        ).rateBps;
      projectInputs.push({ variant: cv, packs: l.packs, unitPackMinor: trade.packPriceMinor });
      lines.push({
        productId: cv.productId,
        variantId: cv._id,
        name: meta?.louieMaeName ?? cv.louieMaeVariantName,
        packs: l.packs,
        piecesPerPack: cv.piecesPerPack,
        retailPackMinor: comparable ? retail!.packPriceMinor : null,
        tradePackMinor: trade.packPriceMinor,
        finalPackMinor: trade.packPriceMinor,
        eligibleProject,
        commissionRate,
        referralEstimateMinor:
          commissionRate === null || !comparable
            ? null
            : Math.floor((retail!.packPriceMinor * l.packs * commissionRate) / 10000),
        projectReason: eligibleProject ? '' : 'Project discount not eligible',
      });
    }
    const eligibleSubtotal = lines
      .filter((l) => l.eligibleProject)
      .reduce((n, l) => n + l.tradePackMinor * l.packs, 0);
    const tier = project?.value.tiers.filter((t) => eligibleSubtotal >= t.minMinor).at(-1);
    const applied = await projectPrices(ctx, projectInputs);
    for (const l of lines) {
      const p = applied.lines.find((x) => x.variantId === l.variantId)!;
      l.finalPackMinor = p.price;
      l.projectReason = p.reason;
    }
    const tradeSubtotalMinor = lines.reduce((n, l) => n + l.tradePackMinor * l.packs, 0),
      finalMerchandiseMinor = lines.reduce((n, l) => n + l.finalPackMinor * l.packs, 0);
    const comparisonComplete = lines.every((l) => l.retailPackMinor !== null);
    const retailComparisonMinor = comparisonComplete
      ? lines.reduce((n, l) => n + l.retailPackMinor! * l.packs, 0)
      : null;
    return {
      lines,
      tradeSubtotalMinor,
      finalMerchandiseMinor,
      retailComparisonMinor,
      baseTradeSavingsMinor:
        retailComparisonMinor === null ? null : retailComparisonMinor - tradeSubtotalMinor,
      projectSavingsMinor: tradeSubtotalMinor - finalMerchandiseMinor,
      totalMerchandiseSavingsMinor:
        retailComparisonMinor === null ? null : retailComparisonMinor - finalMerchandiseMinor,
      comparisonComplete,
      comparableLines: lines.filter((l) => l.retailPackMinor !== null).length,
      projectPolicyApproved: !!project,
      eligibleSubtotalMinor: eligibleSubtotal,
      projectTierBps: tier?.bps ?? 0,
      nextTier: project?.value.tiers.find((t) => t.minMinor > eligibleSubtotal) ?? null,
      referralEstimateMinor: lines.every((l) => l.referralEstimateMinor !== null)
        ? lines.reduce((n, l) => n + l.referralEstimateMinor!, 0)
        : null,
      commissionVersion: schedule?.version ?? null,
      projectVersion: project?.version ?? null,
      note: 'Merchandise savings only. Delivery and tax are calculated separately. Retail referral earnings do not apply to your trade purchase.',
    };
  },
});

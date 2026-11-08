import type { QueryCtx, MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { activeConfig, maybeConfig } from './sysConfig';
import type { ProjectDiscountPolicy, TradeDiscountSchedule } from '../lib/config';
import { computeScenarios } from './catPricing';
import { assertLineMap, assertLineMechanism } from './catPolicies';

export async function approvedProjectPolicy(ctx: QueryCtx | MutationCtx) {
  const p = await maybeConfig<ProjectDiscountPolicy>(
    ctx,
    'projectDiscountPolicy',
    'project-discount'
  );
  return p?.value.basis === 'eligible_trade_merchandise' ? p : null;
}

/** One project price calculation for the calculator and checkout; Zuo never stacks. */
export async function projectPrices(
  ctx: QueryCtx | MutationCtx,
  inputs: { variant: Doc<'catVariants'>; packs: number; unitPackMinor: number }[]
) {
  const schedule = await activeConfig<TradeDiscountSchedule>(
    ctx,
    'tradeDiscountSchedule',
    'trade-discount'
  );
  const policy = await approvedProjectPolicy(ctx);
  const rows: Array<
    (typeof inputs)[number] & { eligible: boolean; price: number; reason: string }
  > = [];
  for (const l of inputs) {
    const supplier = await ctx.db.get(l.variant.supplierId);
    const eligible =
      !!supplier &&
      supplier.code !== 'zuo' &&
      schedule.value.suppliers[supplier.code]?.projectStacking === true;
    rows.push({
      ...l,
      eligible,
      price: l.unitPackMinor,
      reason: eligible ? '' : 'Project discount not eligible',
    });
  }
  const basis = rows.filter((l) => l.eligible).reduce((n, l) => n + l.packs * l.unitPackMinor, 0);
  const tier = policy?.value.tiers.filter((t) => basis >= t.minMinor).at(-1);
  for (const l of rows) {
    if (!l.eligible || !tier) continue;
    try {
      await assertLineMechanism(ctx, l.variant._id, 'project');
      const floor = await computeScenarios(ctx, l.variant);
      const cost = l.variant.currentCostRevisionId
        ? await ctx.db.get(l.variant.currentCostRevisionId)
        : null;
      const map =
        cost?.mapApplicability === 'applies' && cost.mapMinor !== null
          ? cost.mapMinor * (cost.mapUnitBasis === 'piece' ? l.variant.piecesPerPack : 1)
          : 0;
      const price = Math.min(
        l.unitPackMinor,
        Math.max(
          floor.minimumTradeMinor,
          map,
          Math.round((l.unitPackMinor * (10000 - tier.bps)) / 10000)
        )
      );
      await assertLineMap(ctx, l.variant._id, price);
      l.price = price;
      l.reason = price === l.unitPackMinor ? 'Margin floor limits further discount' : '';
    } catch {
      l.reason = 'Project price requires review';
    }
  }
  return {
    lines: rows.map((l) => ({
      variantId: l.variant._id,
      eligible: l.eligible,
      price: l.price,
      reason: l.reason,
    })),
    basis,
    tier,
    policy,
    schedule,
  };
}

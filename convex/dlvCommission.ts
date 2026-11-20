import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { CommissionCategory, CommissionSchedule } from '../lib/config';
import { activeConfig } from './sysConfig';
import { CommerceError } from '../lib/errors';

/** Same conservative reserve for direct and attributed retail customers, including protected rates. */
export async function commissionReserve(
  ctx: QueryCtx | MutationCtx,
  productId: Id<'commerceProducts'>,
  category: CommissionCategory,
  eligible: boolean | undefined,
  now: number
) {
  if (eligible === false) return { bps: 0, versions: [], validUntil: undefined };
  if (eligible !== true)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Commission eligibility unresolved');
  const active = await activeConfig<CommissionSchedule>(
    ctx,
    'commissionSchedule',
    'commission-schedule',
    { at: now }
  );
  const history = await ctx.db
    .query('sysConfig')
    .withIndex('by_kind_key_version', (q) =>
      q.eq('kind', 'commissionSchedule').eq('key', 'commission-schedule')
    )
    .order('desc')
    .take(101);
  const exceptions = await ctx.db
    .query('prgSkuCommissionExceptions')
    .withIndex('by_product_effective', (q) => q.eq('productId', productId))
    .order('desc')
    .take(101);
  if (history.length > 100 || exceptions.length > 100)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Rate history requires reconciliation');
  const since = now - 30 * 86400000;
  const schedules = history.filter(
    (r) =>
      r.approvedAt !== undefined &&
      r.effectiveFrom <= now &&
      (r.effectiveTo === undefined || r.effectiveTo > since)
  );
  const applicable = exceptions.filter(
    (r) => r.effectiveFrom <= now && (r.effectiveTo === undefined || r.effectiveTo > since)
  );
  const scheduleRates = [
    active.value,
    ...schedules.map((r) => r.value as CommissionSchedule),
  ].flatMap((s) => s.tiers.map((t) => Math.min(t.rates[category], s.ceilingBps)));
  return {
    validUntil: active.effectiveTo,
    bps: Math.max(...scheduleRates, ...applicable.flatMap((r) => r.rates.map((t) => t.rateBps))),
    versions: [active.id, ...schedules.map((r) => r._id), ...applicable.map((r) => r._id)],
  };
}

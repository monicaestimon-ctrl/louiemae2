import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { parseConfig, type CommissionCategory, type CommissionSchedule } from '../lib/config';
import { CommerceError } from '../lib/errors';
import { TIER_ORDER } from '../lib/tiers';

type Ctx = QueryCtx | MutationCtx;
const review = (detail: string): never => { throw new CommerceError('COST_REVIEW_REQUIRED', detail); };

/** Never let a malformed schedule fall back to the first tier. */
export function checkedSchedule(value: unknown): CommissionSchedule {
  try {
    const schedule = parseConfig('commissionSchedule', value) as CommissionSchedule;
    if (schedule.tiers.length !== TIER_ORDER.length || schedule.tiers.some((row, i) => row.key !== TIER_ORDER[i]) || schedule.tiers[0].minMinor !== 0)
      return review('Commission schedule requires all four ordered tiers');
    return schedule;
  } catch {
    return review('Commission schedule requires reconciliation');
  }
}

export function completeExceptionRates(rates: Doc<'prgSkuCommissionExceptions'>['rates']) {
  return rates.length === TIER_ORDER.length && TIER_ORDER.every(tier => rates.filter(row => row.tierKey === tier).length === 1) &&
    rates.every(row => Number.isSafeInteger(row.rateBps) && row.rateBps >= 0 && row.rateBps <= 2300);
}

/** Exact click version, including a once-approved version subsequently retired. */
export async function historicalSchedule(ctx: Ctx, version: number, at: number) {
  const records = await ctx.db.query('sysConfig').withIndex('by_kind_key_version', q =>
    q.eq('kind', 'commissionSchedule').eq('key', 'commission-schedule').eq('version', version)).take(2);
  const record = records[0];
  // Millisecond-equal retirement may follow the click in a later transaction.
  // Its recorded version remains authoritative at that boundary.
  if (records.length !== 1 || !record || !['approved', 'retired'].includes(record.status) ||
      record.approvedAt === undefined || record.approvedAt > at || record.effectiveFrom > at ||
      (record.effectiveTo !== undefined && record.effectiveTo < at))
    return review('Protected commission schedule is missing or was not approved at the click');
  return checkedSchedule(record.value);
}

/** Exclude future rows at the index so they cannot hide applicable history. */
export async function effectiveException(ctx: Ctx, productId: Id<'commerceProducts'>, at: number, historical = false) {
  const rows = await ctx.db.query('prgSkuCommissionExceptions').withIndex('by_product_effective', q =>
    q.eq('productId', productId).lte('effectiveFrom', at)).order('desc').take(101);
  if (rows.length > 100) return review('Commission exception history requires reconciliation');
  if (rows.some(row => row.effectiveTo !== undefined && row.effectiveTo <= row.effectiveFrom))
    return review('Commission exception effective period is reversed or empty');
  const live = rows.filter(row => row.effectiveTo === undefined || row.effectiveTo > at);
  if (live.length > 1) return review('Commission exception effective periods overlap');
  const exception = live[0];
  if (historical && exception?.createdAt === at)
    return review('Commission exception changed at the click boundary; review its protected rate');
  if (exception && exception.createdAt > at)
    return review('Commission exception was recorded after the requested effective time');
  if (exception && (!completeExceptionRates(exception.rates) || !exception.visibleNote.trim()))
    return review('Commission exception requires a complete visible tier schedule');
  return exception;
}

/** Category changes are audited; walk those changes backwards for basket-scope clicks. */
export async function categoryAtClick(ctx: Ctx, productId: Id<'commerceProducts'>, current: CommissionCategory, at: number) {
  const rows = await ctx.db.query('sysAuditEvents').withIndex('by_entity', q =>
    q.eq('entityTable', 'commerceProducts').eq('entityId', productId).gte('at', at)).order('desc').take(101);
  if (rows.length > 100) return review('Protected category history requires reconciliation');
  let category: CommissionCategory | 'review_required' = current;
  for (const row of rows.filter(row => row.action === 'category.commit')) {
    if (row.at === at) return review('Category changed at the click boundary; review its protected rate');
    if (row.after !== category) return review('Protected category history is inconsistent');
    if (row.before === null || row.before === 'review_required') category = 'review_required';
    else if (row.before === 'furniture' || row.before === 'decor' || row.before === 'clothing') category = row.before;
    else return review('Protected category history is incomplete');
  }
  return category;
}

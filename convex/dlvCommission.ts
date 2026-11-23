import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { CommissionCategory } from '../lib/config';
import { activeConfig } from './sysConfig';
import { CommerceError } from '../lib/errors';
import { ATTRIBUTION_WINDOW_MS, winningClick } from '../lib/attribution';
import { checkedSchedule, completeExceptionRates } from './prgRateHistory';

type Ctx = QueryCtx | MutationCtx;
type Category = CommissionCategory | 'review_required';
const review = (detail: string): never => { throw new CommerceError('COST_REVIEW_REQUIRED', detail); };
const categoryValue = (value: unknown): Category => {
  if (value === null || value === 'review_required') return 'review_required';
  if (value === 'furniture' || value === 'decor' || value === 'clothing') return value;
  return review('Commission category history is incomplete');
};

/** Fund the same maximum for direct and referred retail orders. An exception replaces
 * the category rate in its interval; existing eligible visits retain earlier rates. */
export async function commissionReserve(ctx: Ctx, productId: Id<'commerceProducts'>,
  category: CommissionCategory, eligible: boolean | undefined, now: number) {
  if (eligible === false) return { bps: 0, versions: [], validUntil: undefined };
  if (eligible !== true) return review('Commission eligibility unresolved');
  const active = await activeConfig(ctx, 'commissionSchedule', 'commission-schedule', { at: now });
  // Basket-scope links can protect any eligible product. Find the earliest still-valid
  // visit without scanning the whole traffic history or assuming pre-launch protection.
  const visits = await ctx.db.query('prgReferralClicks').withIndex('by_eligible_at_click', q =>
    q.eq('eligible', true).gt('at', now - ATTRIBUTION_WINDOW_MS).lte('at', now)).order('asc').take(201);
  const first = visits.slice(0, 200).find(row => winningClick([row], now));
  if (!first && visits.length > 200) return review('Protected visit history requires reconciliation');
  const since = first?.at ?? now;
  const history = await ctx.db.query('sysConfig').withIndex('by_kind_key_version', q =>
    q.eq('kind', 'commissionSchedule').eq('key', 'commission-schedule')).order('desc').take(101);
  const exceptions = await ctx.db.query('prgSkuCommissionExceptions').withIndex('by_product_effective', q =>
    q.eq('productId', productId)).order('desc').take(101);
  const audits = first ? await ctx.db.query('sysAuditEvents').withIndex('by_entity_action_at', q =>
    q.eq('entityTable', 'commerceProducts').eq('entityId', productId).eq('action', 'category.commit')
      .gte('at', since).lte('at', now)).order('desc').take(101) : [];
  if (history.length > 100 || exceptions.length > 100 || audits.length > 100)
    return review('Commission rate history requires reconciliation');
  const schedules = history.filter(row => row.status === 'approved' || row.status === 'retired')
    .map(row => ({ ...row, effectiveFrom: Math.max(row.effectiveFrom, row.approvedAt ?? Infinity) }));
  const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
  for (const row of schedules) {
    if (row.approvedAt === undefined || !validTime(row.approvedAt) || !validTime(row.effectiveFrom) ||
        row.approvedAt > row.effectiveFrom || (row.effectiveTo !== undefined &&
          (!validTime(row.effectiveTo) || row.effectiveTo < row.effectiveFrom)))
      return review('Commission schedule effective history is invalid');
  }
  for (const row of exceptions) {
    if (!validTime(row.effectiveFrom) || !validTime(row.createdAt) || row.createdAt > row.effectiveFrom ||
        (row.effectiveTo !== undefined && (!validTime(row.effectiveTo) || row.effectiveTo <= row.effectiveFrom)) ||
        !completeExceptionRates(row.rates) || !row.visibleNote.trim())
      return review('Commission exception requires a complete, valid visible schedule');
  }
  const relevant = schedules.filter(row => row.effectiveFrom <= now && (row.effectiveTo === undefined || row.effectiveTo >= since));
  const values = new Map(relevant.map(row => [row._id, checkedSchedule(row.value)]));
  const relevantExceptions = exceptions.filter(row => row.effectiveFrom <= now && (row.effectiveTo === undefined || row.effectiveTo >= since));
  // Reconstruct category intervals backwards and retain both sides of a millisecond
  // transition: an already-snapshotted product click may precede the audit transaction.
  const categories: { from: number; to: number; category: Category }[] = [];
  let current: Category = category, end = now;
  for (const row of audits) {
    if (!validTime(row.at) || row.after !== current) return review('Commission category history is inconsistent');
    categories.push({ from: row.at, to: end, category: current });
    current = categoryValue(row.before); end = row.at;
  }
  categories.push({ from: since, to: end, category: current });
  const points = new Set([since, now]);
  const addBoundary = (at: number | undefined) => {
    if (at === undefined) return;
    for (const point of [at - 1, at, at + 1]) if (point >= since && point <= now) points.add(point);
  };
  for (const row of [...relevant, ...relevantExceptions]) { addBoundary(row.effectiveFrom); addBoundary(row.effectiveTo); }
  for (const row of audits) addBoundary(row.at);
  const live = (row: { effectiveFrom: number; effectiveTo?: number }, at: number) =>
    row.effectiveFrom <= at && (row.effectiveTo === undefined || row.effectiveTo > at);
  let bps = 0;
  for (const at of points) {
    const selected = relevant.filter(row => live(row, at));
    if (selected.length !== 1 || (at === now && selected[0]._id !== active.id))
      return review('Protected commission schedule has a gap or overlap');
    const selectedExceptions = relevantExceptions.filter(row => live(row, at));
    if (selectedExceptions.length > 1) return review('Commission exception effective periods overlap');
    const fundedSchedules = first ? relevant.filter(row => live(row, at) || row.effectiveTo === at) : selected;
    const fundedExceptions: (Doc<'prgSkuCommissionExceptions'> | undefined)[] = [...selectedExceptions];
    if (!selectedExceptions.length) fundedExceptions.push(undefined);
    if (first) fundedExceptions.push(...relevantExceptions.filter(row => row.effectiveTo === at));
    for (const row of fundedSchedules) {
      const schedule = values.get(row._id)!;
      for (const interval of categories.filter(c => c.from <= at && c.to >= at)) {
        for (const exception of fundedExceptions) {
          const rates = exception ? exception.rates.map(r => r.rateBps) :
            schedule.tiers.map(t => interval.category === 'review_required' ? 0 : t.rates[interval.category]);
          bps = Math.max(bps, ...rates.map(rate => Math.min(rate, schedule.ceilingBps)));
        }
      }
    }
  }
  const boundaries = [...schedules, ...exceptions].flatMap(row => [row.effectiveFrom, row.effectiveTo])
    .filter((at): at is number => at !== undefined && at > now);
  if (first) boundaries.push(Math.min(first.expiresAt, first.at + ATTRIBUTION_WINDOW_MS));
  return { bps, versions: [...new Set([active.id, ...relevant.map(r => r._id), ...relevantExceptions.map(r => r._id),
    ...audits.map(r => r._id), ...(first ? [first._id] : [])])],
    validUntil: boundaries.length ? Math.min(...boundaries) : undefined };
}

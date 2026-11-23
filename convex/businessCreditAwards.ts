// Business awards are source-bound ledger events. Unallocated refunds never become guessed merchandise.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { applyCreditEvent } from './ldgCore';
import { audit, claimKey, keyExists, openReview } from './sysCore';
import { CommerceError } from '../lib/errors';

type Ctx = MutationCtx | QueryCtx;
type Qualification = { status: 'qualified' | 'ineligible' | 'review'; reason: string };
const LIMIT = 100;
const validMoney = (n: number) => Number.isSafeInteger(n) && n >= 0;
export async function creditUnderReview(ctx: Ctx, accountId: Id<'ldgCreditAccounts'>) {
  return !!await ctx.db.query('ldgCreditAwardReviews').withIndex('by_account_status', q => q.eq('accountId', accountId).eq('status', 'open')).first();
}

/** Bounds eligibility when a partial cash refund has no authoritative merchandise allocation. */
export async function awardQualification(ctx: Ctx, order: Doc<'ordOrders'>, minimum: number): Promise<Qualification> {
  const review = (reason: string): Qualification => ({ status: 'review', reason });
  if (!validMoney(minimum) || minimum <= 0) return review('Award terms need review');
  if (order.status === 'cancelled') return { status: 'ineligible', reason: 'Qualifying order cancelled' };
  const cashRefund = order.confirmedCashRefundMinor ?? 0;
  if (!validMoney(cashRefund) || cashRefund > order.totals.total) return review('Refund evidence does not reconcile');
  if (order.totals.total > 0 && cashRefund === order.totals.total) return { status: 'ineligible', reason: 'Qualifying payment fully refunded' };
  const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', order._id)).take(LIMIT + 1);
  if (!lines.length || lines.length > LIMIT) return review('Complete order lines required');
  let lower = 0, upper = 0, grossTotal = 0, creditTotal = 0, allocatedCash = 0;
  for (const line of lines) {
    const gross = line.unitPackMinor * line.packs - line.discountMinor;
    if (![line.unitPackMinor, line.packs, line.discountMinor, gross, line.creditMinor, line.refundedMinor].every(validMoney) || line.packs < 1 || line.creditMinor > gross || line.refundedMinor > gross) return review('Invalid line financial evidence');
    grossTotal += gross; creditTotal += line.creditMinor;
    const basis = gross - line.creditMinor;
    const returns = await ctx.db.query('ordReturns').withIndex('by_line', q => q.eq('orderLineId', line._id)).take(LIMIT + 1);
    if (returns.length > LIMIT) return review('Complete return history required');
    const refunded = returns.filter(r => r.status === 'refunded');
    if (refunded.some(r => ![r.refund.merchandise, r.refund.tax, r.refund.delivery, r.refund.creditRestored, r.refund.cash, r.restockingMinor].every(validMoney) || r.refund.creditRestored > r.refund.merchandise || r.refund.cash !== r.refund.merchandise - r.refund.creditRestored + r.refund.tax + r.refund.delivery)) return review('Invalid return allocation');
    const merchandise = refunded.reduce((n, r) => n + r.refund.merchandise, 0);
    const restocking = refunded.reduce((n, r) => n + r.restockingMinor, 0);
    const restored = refunded.reduce((n, r) => n + r.refund.creditRestored, 0);
    allocatedCash += refunded.reduce((n, r) => n + r.refund.cash, 0);
    if (merchandise > line.refundedMinor || merchandise + restocking > gross || restored > line.creditMinor) return review('Return allocation differs from order line');
    if (merchandise === line.refundedMinor) {
      const kept = Math.max(0, basis - merchandise - restocking + restored);
      lower += kept; upper += kept;
    } else {
      // The line establishes gross merchandise refunded; the credit-funded share is not guessed.
      lower += Math.max(0, basis - line.refundedMinor - restocking);
      upper += Math.max(0, basis - line.refundedMinor - restocking + Math.min(line.creditMinor, line.refundedMinor));
    }
  }
  if (![lower, upper, grossTotal, creditTotal, allocatedCash].every(validMoney)
    || grossTotal !== order.totals.merchandise - order.totals.discount || creditTotal !== order.totals.credit) return review('Order totals and lines differ');
  lower = Math.max(0, lower - Math.max(0, cashRefund - allocatedCash));
  if (upper < minimum) return { status: 'ineligible', reason: 'Refund took qualifying merchandise below the award minimum' };
  if (lower >= minimum) return { status: 'qualified', reason: 'Qualifying merchandise remains above the award minimum' };
  return review('Allocate the confirmed refund between merchandise, delivery, tax and restored credit');
}

async function setReview(ctx: MutationCtx, award: Doc<'ldgCreditEvents'>, reason: string | null) {
  const prior = await ctx.db.query('ldgCreditAwardReviews').withIndex('by_award', q => q.eq('awardEventId', award._id)).unique();
  if (reason) {
    const row = { status: 'open' as const, reason, updatedAt: Date.now() };
    if (prior) await ctx.db.patch(prior._id, row);
    else await ctx.db.insert('ldgCreditAwardReviews', { awardEventId: award._id, accountId: award.accountId, ...row });
    await openReview(ctx, 'business_credit_refund_review', 'ldgCreditEvents', award._id, reason);
  } else if (prior?.status === 'open') {
    await ctx.db.patch(prior._id, { status: 'resolved', updatedAt: Date.now() });
    const item = await ctx.db.query('sysReviewItems').withIndex('by_entity', q => q.eq('entityTable', 'ldgCreditEvents').eq('entityId', award._id))
      .filter(q => q.and(q.eq(q.field('kind'), 'business_credit_refund_review'), q.eq(q.field('status'), 'open'))).first();
    if (item) await ctx.db.patch(item._id, { status: 'resolved', resolution: 'Award reconciled to recorded order evidence', resolvedBy: 'system:credit', resolvedAt: Date.now() });
  }
}

/** Revoke this exact award once, preserving spent/reserved credit as a visible future offset. */
export async function invalidateAward(ctx: MutationCtx, award: Doc<'ldgCreditEvents'>, actor: string, reason: string) {
  if (award.type !== 'award_pending' || !award.ref || !validMoney(award.amountMinor) || award.amountMinor <= 0) throw new CommerceError('INVALID_INPUT', 'Select a valid business award');
  const account = await ctx.db.get(award.accountId);
  if (!account) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Award account missing');
  const settledKey = `award-settled:${award.ref}`;
  const settled = await ctx.db.query('ldgCreditEvents').withIndex('by_key', q => q.eq('eventKey', settledKey)).unique();
  if (settled && (settled.accountId !== award.accountId || settled.amountMinor !== award.amountMinor)) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Award settlement ownership or amount differs');
  if (!settled) {
    await applyCreditEvent(ctx, { eventKey: settledKey, userId: account.userId, type: 'award_cancelled', amountMinor: award.amountMinor, ref: award.ref, orderId: award.orderId, actor, reason });
    await audit(ctx, { actor, action: 'credit.award_cancel', entityTable: 'ldgCreditEvents', entityId: award._id, reason });
  }
  else if (settled.type === 'award_available') {
    const key = `award-reversed:${award._id}`;
    if (!(await claimKey(ctx, `${key}:audit`, 'credit-award-reversal')).duplicate) {
      const unspent = Math.min(Math.max(0, account.availableMinor), award.amountMinor);
      if (unspent) await applyCreditEvent(ctx, { eventKey: `${key}:available`, userId: account.userId, type: 'reversed', amountMinor: unspent, ref: award.ref, orderId: award.orderId, actor, reason });
      if (award.amountMinor > unspent) await applyCreditEvent(ctx, { eventKey: `${key}:offset`, userId: account.userId, type: 'offset_created', amountMinor: award.amountMinor - unspent, ref: award.ref, orderId: award.orderId, actor, reason });
      await audit(ctx, { actor, action: 'credit.award_reverse', entityTable: 'ldgCreditEvents', entityId: award._id, after: { unspent, offset: award.amountMinor - unspent }, reason });
    }
  } else if (settled.type !== 'award_cancelled') throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Award settlement is ambiguous');
  await setReview(ctx, award, null);
}

export async function reconcileAward(ctx: MutationCtx, award: Doc<'ldgCreditEvents'>): Promise<Qualification> {
  if (award.type !== 'award_pending' || !award.ref) throw new CommerceError('INVALID_INPUT', 'Invalid award source');
  const settled = await ctx.db.query('ldgCreditEvents').withIndex('by_key', q => q.eq('eventKey', `award-settled:${award.ref}`)).unique();
  if (settled && (settled.accountId !== award.accountId || settled.amountMinor !== award.amountMinor || !['award_available', 'award_cancelled'].includes(settled.type))) {
    await setReview(ctx, award, 'Award settlement ownership, amount or type differs');
    return { status: 'review', reason: 'Award settlement requires reconciliation' };
  }
  if (settled?.type === 'award_cancelled' || await keyExists(ctx, `award-reversed:${award._id}:audit`)) {
    await setReview(ctx, award, null); return { status: 'ineligible', reason: 'Award already revoked' };
  }
  const order = award.orderId ? await ctx.db.get(award.orderId) : null;
  const result: Qualification = !order || !award.awardPolicy ? { status: 'review', reason: 'Original order and accepted award terms required' }
    : await awardQualification(ctx, order, award.awardPolicy.qualifyingMinMinor);
  if (result.status === 'review') await setReview(ctx, award, result.reason);
  else if (result.status === 'ineligible') await invalidateAward(ctx, award, 'system:credit', result.reason);
  else await setReview(ctx, award, null);
  return result;
}

export async function reconcileAwardsForOrder(ctx: MutationCtx, orderId: Id<'ordOrders'>, refund?: { refundedMinor: number; chargeMinor: number }) {
  const order = await ctx.db.get(orderId);
  if (!order) return;
  if (refund) {
    if (![refund.refundedMinor, refund.chargeMinor].every(validMoney) || refund.refundedMinor > refund.chargeMinor || refund.chargeMinor !== order.totals.total) throw new CommerceError('INVALID_INPUT', 'Refund does not reconcile to the paid order');
    if (refund.refundedMinor > (order.confirmedCashRefundMinor ?? 0)) await ctx.db.patch(orderId, { confirmedCashRefundMinor: refund.refundedMinor });
  }
  const awards = await ctx.db.query('ldgCreditEvents').withIndex('by_order_type', q => q.eq('orderId', orderId).eq('type', 'award_pending')).take(2);
  if (awards.length > 1) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Multiple business awards on one order require reconciliation');
  for (const award of awards) await reconcileAward(ctx, award);
}

// Commission ledger v2 (spec S29, v2 §10, §16, §17). Obligations are earned per order line from
// the frozen attribution snapshot, clear 30 days after verified payment, reverse refunds by
// cumulative cents (never more than earned), hold disputed amounts and restore them once if won.
// After a transfer, reversals become offsets against future earnings; a bank account is never
// debited. Every event is keyed and applied exactly once (ldgCore).
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireUser } from './holmAccess';
import { applyCommissionEvent, payable } from './ldgCore';
import { activeConfig, maybeConfig } from './sysConfig';
import { audit, bumpMetric, openReview } from './sysCore';
import { beneficiaryOf } from './prgCore';
import { flag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { allocate } from '../lib/money';
import type { ClearingPolicy } from '../lib/config';

const DAY = 86_400_000;

/** Basis for a line: eligible merchandise actually paid after discounts and applied store credit. */
export const lineBasis = (l: Pick<Doc<'ordOrderLines'>, 'unitPackMinor' | 'packs' | 'discountMinor' | 'creditMinor'>) => Math.max(0, l.unitPackMinor * l.packs - l.discountMinor - l.creditMinor);

/**
 * Creates one obligation per eligible attributed line of a paid order (idempotent per line).
 * Trade orders, self-referrals and ineligible lines earn nothing because they have no eligible
 * snapshot line. The order records which accrual path it used so legacy and v2 never both pay.
 */
export async function accrueForOrder(ctx: MutationCtx, orderId: Id<'ordOrders'>, honorFrozenRates = false) {
  // Verified payment completion honors its accepted snapshot even if new accrual is paused.
  // Payout execution remains separately gated; no new eligibility or rate is invented.
  if (!flag('COMMISSION_ACCRUAL_V2_ENABLED') && !honorFrozenRates) return 0;
  const order = await ctx.db.get(orderId);
  if (!order?.intentId || order.channel !== 'retail' || order.accrualPath === 'legacy') return 0;
  const intent = await ctx.db.get(order.intentId);
  const snap = intent?.attributionSnapshotId ? await ctx.db.get(intent.attributionSnapshotId) : null;
  await ctx.db.patch(order._id, { accrualPath: 'v2' });
  if (!snap) return 0;
  const clearing = (await activeConfig<ClearingPolicy>(ctx, 'clearingPolicy', 'clearing')).value;
  const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect();
  let created = 0;
  for (const line of lines) {
    const s = snap.lines.find((x) => x.lineKey === line.lineKey);
    if (!s?.eligible || s.appliedRateBps <= 0 || line.commissionCategory === 'review_required') continue;
    const basis = lineBasis(line);
    const earned = Math.floor((basis * s.appliedRateBps) / 10_000);
    if (earned <= 0) continue;
    const r = await applyCommissionEvent(ctx, {
      eventKey: `earn:${line._id}`,
      type: 'earned',
      amountMinor: earned,
      actor: 'system:accrual',
      create: { beneficiaryId: snap.beneficiaryId, source: 'retail_order', orderId: order._id, orderLineId: line._id, category: line.commissionCategory, rateBps: s.appliedRateBps, basisMinor: basis, state: 'pending', paidAt: order.paidAt, clearsAt: order.paidAt + clearing.clearAfterDays * DAY },
    });
    if (!r.duplicate) created++;
  }
  if (created) {
    await bumpMetric(ctx, 'commission.accrued', created);
    await ctx.scheduler.runAfter(0, internal.prgTiers.onEvent, { beneficiaryId: snap.beneficiaryId, watermark: `paid:${order._id}` });
  }
  return created;
}

/** Hourly: pending obligations past their clearing date clear (held ones wait for the dispute). */
export const clearDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query('ldgObligations').withIndex('by_state_clears', (q) => q.eq('state', 'pending').lte('clearsAt', now)).take(200);
    for (const o of due) await applyCommissionEvent(ctx, { eventKey: `clear:${o._id}`, obligationId: o._id, type: 'cleared', amountMinor: 0, actor: 'system:clearing', at: now });
    return due.length;
  },
});

const AFTER_PAYOUT: readonly Doc<'ldgObligations'>['state'][] = ['reserved', 'transfer_submitted', 'transferred'];

async function offset(ctx: MutationCtx, o: Doc<'ldgObligations'>, amountMinor: number, key: string, reason: string) {
  if (amountMinor === 0) return;
  await applyCommissionEvent(ctx, {
    eventKey: key,
    type: amountMinor < 0 ? 'offset' : 'manual_adjustment',
    amountMinor,
    actor: 'system:reversal',
    reason,
    create: { beneficiaryId: o.beneficiaryId, source: 'offset', orderId: o.orderId, orderLineId: o.orderLineId, category: o.category, rateBps: 0, basisMinor: 0, state: 'cleared', clearsAt: Date.now() },
  });
}

/**
 * Applies a cumulative merchandise refund to one line's obligation. Before payout the earned
 * amount is reversed; after payout an offset is created. Repeats and reordering apply once.
 */
async function applyLineRefund(ctx: MutationCtx, o: Doc<'ldgObligations'>, cumulativeRefundedBasis: number, ref: string) {
  // Cumulative cents: only the change since the last applied refund total counts, so repeated,
  // replayed or reordered refund events never reverse twice.
  const prev = o.refundedBasisMinor;
  const refunded = Math.min(o.basisMinor, Math.max(prev, cumulativeRefundedBasis));
  if (refunded === prev) return;
  const keep = (r: number) => Math.floor(((o.basisMinor - r) * o.rateBps) / 10_000);
  const delta = Math.min(keep(prev) - keep(refunded), Math.max(0, payable(o)));
  if (AFTER_PAYOUT.includes(o.state)) {
    await offset(ctx, o, -delta, `refund-offset:${ref}:${o._id}:${refunded}`, 'Refunded after payout');
    await ctx.db.patch(o._id, { refundedBasisMinor: refunded, updatedAt: Date.now() });
  } else if (o.state === 'void' || delta <= 0) await ctx.db.patch(o._id, { refundedBasisMinor: refunded, updatedAt: Date.now() });
  else await applyCommissionEvent(ctx, { eventKey: `refund:${ref}:${o._id}:${refunded}`, obligationId: o._id, type: 'refund_reversal', amountMinor: -delta, cumulativeRefundedMinor: refunded, actor: 'system:refund' });
}

/**
 * Payment events for v2 orders: refunds (Stripe reports the running total), disputes opened, won
 * or lost. Credit-funded shares are reinstated as credit (ldgCredits), never cash.
 */
export const onPaymentEvent = internalMutation({
  args: { paymentIntentId: v.string(), kind: v.union(v.literal('refund'), v.literal('dispute'), v.literal('dispute_won'), v.literal('dispute_lost')), refundedCents: v.optional(v.number()), chargeCents: v.optional(v.number()), disputeId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const did = a.disputeId ?? a.paymentIntentId;
    const order = await ctx.db.query('ordOrders').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId)).first();
    if (!order) return { handled: false };
    const obligations = (await ctx.db.query('ldgObligations').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect()).filter((o) => o.source === 'retail_order');
    const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect();
    if (a.kind === 'refund') {
      const charge = a.chargeCents ?? order.totals.total;
      const refunded = Math.min(a.refundedCents ?? 0, charge);
      // Line-level returns are authoritative; otherwise the refund is shared by value.
      const recorded = lines.reduce((t, l) => t + l.refundedMinor, 0);
      const netMerch = lines.reduce((t, l) => t + lineBasis(l), 0);
      const merchRefund = recorded > 0 ? null : charge > 0 ? Math.floor((refunded * netMerch) / charge) : 0;
      const shares = merchRefund === null ? lines.map((l) => Math.min(lineBasis(l), l.refundedMinor)) : allocate(Math.min(merchRefund, netMerch), lines.map((l) => lineBasis(l)));
      for (const o of obligations) {
        const i = lines.findIndex((l) => l._id === o.orderLineId);
        if (i >= 0) await applyLineRefund(ctx, o, shares[i], a.paymentIntentId);
      }
      if (flag('CREDIT_V2_ENABLED') && order.totals.credit > 0 && charge > 0) await ctx.runMutation(internal.ldgCredits.reinstateForOrder, { orderId: order._id, refundedCents: refunded, chargeCents: charge });
    } else {
      for (const o of obligations) {
        if (a.kind === 'dispute') {
          if (o.state === 'pending' || o.state === 'cleared') await applyCommissionEvent(ctx, { eventKey: `dispute:${did}:${o._id}`, obligationId: o._id, type: 'dispute_hold', amountMinor: 0, actor: 'system:dispute' });
          else if (AFTER_PAYOUT.includes(o.state)) await offset(ctx, o, -payable(o), `dispute-offset:${did}:${o._id}`, 'Payment disputed after payout');
        } else if (a.kind === 'dispute_won') {
          if (o.state === 'held') await applyCommissionEvent(ctx, { eventKey: `dispute-won:${did}:${o._id}`, obligationId: o._id, type: 'dispute_release', amountMinor: 0, actor: 'system:dispute' });
          else if (AFTER_PAYOUT.includes(o.state)) await offset(ctx, o, payable(o), `dispute-won-restore:${did}:${o._id}`, 'Dispute won after payout');
        } else if (o.state === 'held') await applyCommissionEvent(ctx, { eventKey: `dispute-lost:${did}:${o._id}`, obligationId: o._id, type: 'dispute_lost', amountMinor: 0, actor: 'system:dispute' });
      }
    }
    const bens = new Set(obligations.map((o) => o.beneficiaryId));
    for (const b of bens) await ctx.scheduler.runAfter(0, internal.prgTiers.onEvent, { beneficiaryId: b, watermark: `${a.kind}:${a.paymentIntentId}:${a.refundedCents ?? ''}` });
    return { handled: true };
  },
});

// ---------------- manual adjustments (two people above the threshold) ----------------
type LedgerPolicy = { secondConfirmationAtMinor: number };

export const requestAdjustment = mutation({
  args: { beneficiaryId: v.id('prgBeneficiaries'), amountMinor: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor === 0) throw new CommerceError('INVALID_INPUT', 'Enter a non-zero amount in cents');
    if (a.reason.trim().length < 5) throw new CommerceError('INVALID_INPUT', 'Explain the adjustment');
    const policy = await maybeConfig<LedgerPolicy>(ctx, 'ledgerPolicy', 'ledger-adjustment-threshold');
    const threshold = policy?.value.secondConfirmationAtMinor ?? 0; // until D-17 is approved, every adjustment needs two people
    if (Math.abs(a.amountMinor) < threshold) return applyAdjustment(ctx, a.beneficiaryId, a.amountMinor, a.reason, admin.email, `adj:${a.beneficiaryId}:${Date.now()}`);
    const id = await openReview(ctx, 'ledger_adjustment_pending', 'prgBeneficiaries', `${a.beneficiaryId}:${Date.now()}`, JSON.stringify({ beneficiaryId: a.beneficiaryId, amountMinor: a.amountMinor, reason: a.reason, requestedBy: admin.email }));
    return { pendingReviewId: id };
  },
});

export const confirmAdjustment = mutation({
  args: { reviewId: v.id('sysReviewItems') },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const r = await ctx.db.get(a.reviewId);
    if (!r || r.kind !== 'ledger_adjustment_pending' || r.status !== 'open') throw new CommerceError('INVALID_INPUT', 'Nothing to confirm');
    const d = JSON.parse(r.detail) as { beneficiaryId: Id<'prgBeneficiaries'>; amountMinor: number; reason: string; requestedBy: string };
    if (d.requestedBy === admin.email) throw new CommerceError('FORBIDDEN', 'A second person must confirm a large adjustment');
    await ctx.db.patch(r._id, { status: 'resolved', resolvedBy: admin.email, resolvedAt: Date.now(), resolution: 'confirmed' });
    return applyAdjustment(ctx, d.beneficiaryId, d.amountMinor, `${d.reason} (confirmed by ${admin.email})`, d.requestedBy, `adj:${r._id}`);
  },
});

async function applyAdjustment(ctx: MutationCtx, beneficiaryId: Id<'prgBeneficiaries'>, amountMinor: number, reason: string, actor: string, key: string) {
  const r = await applyCommissionEvent(ctx, { eventKey: key, type: amountMinor < 0 ? 'offset' : 'manual_adjustment', amountMinor, actor, reason, create: { beneficiaryId, source: 'adjustment', rateBps: 0, basisMinor: 0, state: 'cleared', clearsAt: Date.now() } });
  await audit(ctx, { actor, action: 'ledger.adjust', entityTable: 'prgBeneficiaries', entityId: beneficiaryId, after: { amountMinor }, reason });
  return { obligationId: r.obligationId };
}

// ---------------- partner and admin views ----------------
export async function balances(ctx: MutationCtx | import('./_generated/server').QueryCtx, beneficiaryId: Id<'prgBeneficiaries'>) {
  const rows = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', beneficiaryId)).take(5000);
  const sum = (states: Doc<'ldgObligations'>['state'][]) => rows.filter((o) => states.includes(o.state)).reduce((t, o) => t + payable(o), 0);
  return { pending: sum(['pending']), held: rows.filter((o) => o.state === 'held').reduce((t, o) => t + o.heldMinor, 0), cleared: sum(['cleared']), reserved: sum(['reserved']), submitted: sum(['transfer_submitted']), transferred: sum(['transferred']) };
}

/** The partner's earnings: totals by state and orders with privacy-safe references (no buyer details). */
export const myEarnings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const b = await beneficiaryOf(ctx, me.userId);
    if (!b) return null;
    const rows = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', b._id)).order('desc').take(200);
    return {
      totals: await balances(ctx, b._id),
      entries: await Promise.all(
        rows.map(async (o) => {
          const order = o.orderId ? await ctx.db.get(o.orderId) : null;
          return { ref: order ? `…${order.number.slice(-4)}` : o.source === 'adjustment' ? 'Adjustment' : o.source === 'offset' ? 'Correction' : 'Earlier order', paidAt: o.paidAt ?? o.createdAt, category: o.category ?? null, rateBps: o.rateBps, basisMinor: o.basisMinor, amountMinor: payable(o), state: o.state, clearsAt: o.clearsAt };
        })
      ),
    };
  },
});

export const adminLedger = query({
  args: { beneficiaryId: v.id('prgBeneficiaries') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', a.beneficiaryId)).order('desc').take(500);
    return { totals: await balances(ctx, a.beneficiaryId), rows };
  },
});

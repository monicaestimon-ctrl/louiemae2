// Business referral store credit v2 (spec S31, v2 §19). A newly referred, verified business that
// pays qualifying merchandise of at least $500 (after discounts and credit, excluding delivery and
// tax) earns its referrer a one-time $100 award: pending for 30 days, then available unless a
// refund took the order below $500. Credit is non-cash, reserved atomically, redeemed on payment
// and reinstated (never paid out as cash) on refunds.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireUser, viewer } from './holmAccess';
import { applyCreditEvent, creditAccountFor } from './ldgCore';
import { activeConfig } from './sysConfig';
import { audit, bumpMetric, keyExists, openReview } from './sysCore';
import { flag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import type { CreditPolicy } from '../lib/config';

type Ctx = QueryCtx | MutationCtx;
const DAY = 86_400_000;

export async function available(ctx: Ctx, userId: Id<'users'>) {
  const acct = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  return Math.max(0, acct?.availableMinor ?? 0);
}

async function eventsByRef(ctx: Ctx, ref: string) {
  return ctx.db.query('ldgCreditEvents').withIndex('by_ref', (q) => q.eq('ref', ref)).collect();
}

/** Holds up to `maxMinor` of available credit for one checkout or quote (idempotent by ref). */
export async function reserve(ctx: MutationCtx, userId: Id<'users'>, maxMinor: number, ref: string) {
  const prior = (await eventsByRef(ctx, ref)).find((e) => e.type === 'reserved');
  if (prior) return prior.amountMinor;
  const amount = Math.min(await available(ctx, userId), Math.max(0, Math.floor(maxMinor)));
  if (amount <= 0) return 0;
  await applyCreditEvent(ctx, { eventKey: `reserve:${ref}`, userId, type: 'reserved', amountMinor: amount, ref, actor: 'system:checkout' });
  return amount;
}

/** Settles a hold: redeemed (up to the held amount; the rest released) or released entirely. */
export async function settle(ctx: MutationCtx, ref: string, outcome: 'redeemed' | 'released', usedMinor?: number, orderId?: Id<'ordOrders'>) {
  const events = await eventsByRef(ctx, ref);
  const held = events.find((e) => e.type === 'reserved');
  if (!held || events.some((e) => e.type === 'redeemed' || e.type === 'reservation_released')) return 0;
  const acct = (await ctx.db.get(held.accountId))!;
  if (outcome === 'released') {
    await applyCreditEvent(ctx, { eventKey: `release:${ref}`, userId: acct.userId, type: 'reservation_released', amountMinor: held.amountMinor, ref, actor: 'system:checkout' });
    return 0;
  }
  const used = Math.min(held.amountMinor, Math.max(0, usedMinor ?? held.amountMinor));
  if (used > 0) await applyCreditEvent(ctx, { eventKey: `redeem:${ref}`, userId: acct.userId, type: 'redeemed', amountMinor: used, ref, ...(orderId ? { orderId } : {}), actor: 'system:checkout' });
  if (held.amountMinor - used > 0) await applyCreditEvent(ctx, { eventKey: `release:${ref}`, userId: acct.userId, type: 'reservation_released', amountMinor: held.amountMinor - used, ref, actor: 'system:checkout' });
  return used;
}

/** A refund of an order that used credit restores the credit-funded share (cumulative, once). */
export const reinstateForOrder = internalMutation({
  args: { orderId: v.id('ordOrders'), refundedCents: v.number(), chargeCents: v.number() },
  handler: async (ctx, a) => {
    const order = await ctx.db.get(a.orderId);
    if (!order?.intentId || order.totals.credit <= 0) return;
    const ref = `intent:${order.intentId}`;
    const redeemed = (await eventsByRef(ctx, ref)).find((e) => e.type === 'redeemed');
    if (!redeemed) return;
    const acct = (await ctx.db.get(redeemed.accountId))!;
    // The credit-funded share of the refund: credit / (cash charge + credit), applied to the refunded merchandise share.
    const target = Math.min(redeemed.amountMinor, Math.floor((redeemed.amountMinor * Math.min(a.refundedCents, a.chargeCents)) / Math.max(1, a.chargeCents)));
    const already = (await eventsByRef(ctx, `${ref}:reinstated`)).reduce((t, e) => t + e.amountMinor, 0);
    const delta = target - already;
    if (delta > 0) await applyCreditEvent(ctx, { eventKey: `reinstate:${ref}:${target}`, userId: acct.userId, type: 'reinstated', amountMinor: delta, ref: `${ref}:reinstated`, orderId: order._id, actor: 'system:refund', reason: 'Credit-funded share of a refund' });
  },
});

// ---------------- the $100 business referral award ----------------
async function policy(ctx: Ctx) {
  return (await activeConfig<CreditPolicy>(ctx, 'creditPolicy', 'business-credit')).value;
}

/** Qualifying merchandise of a paid v2 order: after discounts and credit, excluding delivery and tax. */
const qualifying = (order: Doc<'ordOrders'>, lines: Doc<'ordOrderLines'>[]) =>
  lines.reduce((t, l) => t + Math.max(0, l.unitPackMinor * l.packs - l.discountMinor - l.creditMinor - l.refundedMinor), 0) || Math.max(0, order.totals.merchandise - order.totals.discount - order.totals.credit);

/**
 * A paid order by a referred business: opens a pending award for the referrer once per referred
 * business (unique identity), never when this order already earns the referrer a retail
 * commission (the business-referral flow was chosen before checkout instead).
 */
export async function onOrderPaid(ctx: MutationCtx, orderId: Id<'ordOrders'>) {
  if (!flag('CREDIT_V2_ENABLED')) return null;
  const order = await ctx.db.get(orderId);
  if (!order?.buyerUserId) return null;
  const ref = await ctx.db.query('holmReferrals').withIndex('by_referred', (q) => q.eq('referredUserId', order.buyerUserId!)).first();
  if (!ref || ref.status === 'credited') return null;
  const p = await policy(ctx);
  const profile = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', order.buyerUserId!)).unique();
  if (profile?.tradeStatus !== 'approved') return null; // the business must be verified
  const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect();
  if (qualifying(order, lines) < p.qualifyingMinMinor) return null;
  // "New": no earlier paid order by this business.
  const earlier = (await ctx.db.query('ordOrders').withIndex('by_buyer', (q) => q.eq('buyerUserId', order.buyerUserId!)).collect()).filter((o) => o._id !== order._id && o.paidAt < order.paidAt && o.status !== 'cancelled');
  if (earlier.length) {
    await openReview(ctx, 'credit_not_new_business', 'ordOrders', order._id, 'Referred business already had a paid order; no award.');
    return null;
  }
  // Anti-double-reward: the same beneficiary cannot also earn retail commission on this order.
  const commissions = (await ctx.db.query('ldgObligations').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect()).filter((o) => o.source === 'retail_order');
  const referrerBen = await ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', (q) => q.eq('legacyUserId', ref.referrerId)).first();
  if (referrerBen && commissions.some((o) => o.beneficiaryId === referrerBen._id)) return null;
  const org = await ctx.db.query('prgOrganizations').withIndex('by_legacy_owner', (q) => q.eq('legacyOwnerUserId', order.buyerUserId!)).first();
  const key = `award:${ref.referredUserId}`;
  if (await keyExists(ctx, key)) return null;
  await applyCreditEvent(ctx, { eventKey: key, userId: ref.referrerId, type: 'award_pending', amountMinor: p.awardMinor, ref: key, orderId: order._id, ...(org ? { referredOrganizationId: org._id } : {}), availableAt: order.paidAt + p.awardAfterDays * DAY, actor: 'system:credit', reason: 'Business referral' });
  await bumpMetric(ctx, 'credit.award_pending');
  return key;
}

/** Hourly: pending awards past 30 days become available, or are cancelled if a refund took the order below $500. */
export const awardDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!flag('CREDIT_V2_ENABLED')) return 0;
    const p = await policy(ctx);
    const now = Date.now();
    const due = await ctx.db.query('ldgCreditEvents').withIndex('by_type_available', (q) => q.eq('type', 'award_pending').lte('availableAt', now)).take(100);
    let n = 0;
    for (const e of due) {
      const settledKey = `award-settled:${e.ref}`;
      if (await keyExists(ctx, settledKey)) continue;
      const acct = (await ctx.db.get(e.accountId))!;
      const order = e.orderId ? await ctx.db.get(e.orderId) : null;
      const lines = order ? await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect() : [];
      const stillQualifies = !!order && order.status !== 'cancelled' && qualifying(order, lines) >= p.qualifyingMinMinor;
      await applyCreditEvent(ctx, { eventKey: settledKey, userId: acct.userId, type: stillQualifies ? 'award_available' : 'award_cancelled', amountMinor: e.amountMinor, ref: e.ref, ...(e.orderId ? { orderId: e.orderId } : {}), actor: 'system:credit', reason: stillQualifies ? 'Award available' : 'Refund took the order below the minimum' });
      if (stillQualifies && order?.buyerUserId) {
        const r = await ctx.db.query('holmReferrals').withIndex('by_referred', (q) => q.eq('referredUserId', order.buyerUserId!)).first();
        if (r) await ctx.db.patch(r._id, { status: 'credited', creditCents: e.amountMinor });
      }
      n++;
    }
    return n;
  },
});

/** Admin reversal of an awarded credit after a qualifying order was refunded: unspent credit is reversed, spent credit becomes a visible offset. */
export const reverseAward = mutation({
  args: { userId: v.id('users'), amountMinor: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add a reason');
    const acct = await creditAccountFor(ctx, a.userId);
    const unspent = Math.min(Math.max(0, acct.availableMinor), a.amountMinor);
    const key = `reverse:${a.userId}:${Date.now()}`;
    if (unspent > 0) await applyCreditEvent(ctx, { eventKey: `${key}:r`, userId: a.userId, type: 'reversed', amountMinor: unspent, actor: admin.email, reason: a.reason });
    if (a.amountMinor - unspent > 0) await applyCreditEvent(ctx, { eventKey: `${key}:o`, userId: a.userId, type: 'offset_created', amountMinor: a.amountMinor - unspent, actor: admin.email, reason: a.reason });
    await audit(ctx, { actor: admin.email, action: 'credit.reverse', entityTable: 'users', entityId: a.userId, after: { unspent, offset: a.amountMinor - unspent }, reason: a.reason });
  },
});

export const myCreditV2 = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    const acct = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', me.userId)).first();
    const events = acct ? await ctx.db.query('ldgCreditEvents').withIndex('by_account_at', (q) => q.eq('accountId', acct._id)).order('desc').take(50) : [];
    return {
      availableMinor: Math.max(0, acct?.availableMinor ?? 0),
      reservedMinor: acct?.reservedMinor ?? 0,
      pendingAwardMinor: acct?.pendingAwardMinor ?? 0,
      history: events.map((e) => ({ type: e.type, amountMinor: e.amountMinor, at: e.at, availableAt: e.availableAt ?? null, reason: e.reason ?? null })),
      terms: 'Store credit has no cash value, cannot be transferred, does not expire, and comes off merchandise only — never delivery or tax.',
    };
  },
});

export const accountFor = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return available(ctx, me.userId);
  },
});

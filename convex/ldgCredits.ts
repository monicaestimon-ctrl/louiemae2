// Business referral store credit v2 (spec S31, v2 §19). A newly referred, verified business that
// pays qualifying merchandise of at least $500 (after discounts and credit, excluding delivery and
// tax) earns its referrer a one-time $100 award: pending for 30 days, then available unless a
// refund took the order below $500. Credit is non-cash, reserved atomically, redeemed on payment
// and reinstated (never paid out as cash) on refunds.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireUser, viewer } from './holmAccess';
import { applyCreditEvent } from './ldgCore';
import { activeConfig } from './sysConfig';
import { bumpMetric, keyExists, openReview } from './sysCore';
import { flag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import type { CreditPolicy } from '../lib/config';
import { awardQualification, creditUnderReview, invalidateAward, reconcileAward } from './businessCreditAwards';

type Ctx = QueryCtx | MutationCtx;
const DAY = 86_400_000;

export async function available(ctx: Ctx, userId: Id<'users'>) {
  const acct = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  return acct && await creditUnderReview(ctx, acct._id) ? 0 : Math.max(0, acct?.availableMinor ?? 0);
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
  return activeConfig<CreditPolicy>(ctx, 'creditPolicy', 'business-credit');
}

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
  if (!ref || ref.status === 'credited' || ref.referrerId === order.buyerUserId || order.paidAt < ref.createdAt) return null;
  const policyRecord = await policy(ctx);
  const p = policyRecord.value;
  if (!Number.isSafeInteger(p.awardMinor) || p.awardMinor <= 0) return null;
  const profile = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', order.buyerUserId!)).unique();
  if (profile?.tradeStatus !== 'approved') return null; // the business must be verified
  if ((await awardQualification(ctx, order, p.qualifyingMinMinor)).status !== 'qualified') return null;
  // The business must have been referred before becoming a paying customer.
  const earlier = (await ctx.db.query('ordOrders').withIndex('by_buyer', (q) => q.eq('buyerUserId', order.buyerUserId!)).take(101));
  if (earlier.length > 100 || earlier.some(o => o._id !== order._id && o.paidAt < ref.createdAt)) {
    await openReview(ctx, 'credit_not_new_business', 'ordOrders', order._id, 'Review existing customer history before awarding a new-business referral.');
    return null;
  }
  // Anti-double-reward: the same beneficiary cannot also earn retail commission on this order.
  const commissions = (await ctx.db.query('ldgObligations').withIndex('by_order', (q) => q.eq('orderId', order._id)).take(101));
  if (commissions.length > 100) return null;
  const referrerBen = await ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', (q) => q.eq('legacyUserId', ref.referrerId)).first();
  if (referrerBen && commissions.some((o) => o.source === 'retail_order' && o.beneficiaryId === referrerBen._id)) return null;
  const org = await ctx.db.query('prgOrganizations').withIndex('by_legacy_owner', (q) => q.eq('legacyOwnerUserId', order.buyerUserId!)).unique();
  if (org) {
    if (org.verification !== 'verified') return null;
    const seats = await ctx.db.query('prgOrganizationMembers').withIndex('by_user', q => q.eq('userId', ref.referrerId).eq('status', 'active')).take(101);
    if (seats.length > 100 || seats.some(seat => seat.organizationId === org._id)) return null;
    if (await ctx.db.query('ldgCreditEvents').withIndex('by_referred_org', q => q.eq('referredOrganizationId', org._id)).first()) return null;
  }
  const key = `award:${ref.referredUserId}`;
  if (await keyExists(ctx, key)) return null;
  await applyCreditEvent(ctx, { eventKey: key, userId: ref.referrerId, type: 'award_pending', awardPolicy: { configId: policyRecord.id, version: policyRecord.version, qualifyingMinMinor: p.qualifyingMinMinor }, amountMinor: p.awardMinor, ref: key, orderId: order._id, ...(org ? { referredOrganizationId: org._id } : {}), availableAt: order.paidAt + p.awardAfterDays * DAY, actor: 'system:credit', reason: 'Business referral' });
  await bumpMetric(ctx, 'credit.award_pending');
  return key;
}

/** Hourly bounded walk; settled historical events cannot starve later pending awards. */
export const awardDue = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), cutoff: v.optional(v.number()) },
  handler: async (ctx, a) => {
    if (!flag('CREDIT_V2_ENABLED')) return 0;
    const cutoff = a.cutoff ?? Date.now();
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now()) throw new CommerceError('INVALID_INPUT', 'Invalid award cutoff');
    const page = await ctx.db.query('ldgCreditEvents').withIndex('by_type_available', q => q.eq('type', 'award_pending').lte('availableAt', cutoff))
      .paginate({ cursor: a.cursor ?? null, numItems: 1 });
    let n = 0;
    for (const e of page.page) {
      const settledKey = `award-settled:${e.ref}`;
      if (await keyExists(ctx, settledKey)) continue;
      const result = await reconcileAward(ctx, e);
      if (result.status !== 'qualified') continue;
      const account = await ctx.db.get(e.accountId);
      if (!account) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Award account missing');
      await applyCreditEvent(ctx, { eventKey: settledKey, userId: account.userId, type: 'award_available', amountMinor: e.amountMinor, ref: e.ref, orderId: e.orderId, actor: 'system:credit', reason: 'Award available under original terms' });
      const order = e.orderId ? await ctx.db.get(e.orderId) : null;
      if (order?.buyerUserId) {
        const referral = await ctx.db.query('holmReferrals').withIndex('by_referred', q => q.eq('referredUserId', order.buyerUserId!)).unique();
        if (referral) await ctx.db.patch(referral._id, { status: 'credited', creditCents: e.amountMinor });
      }
      n++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.ldgCredits.awardDue, { cursor: page.continueCursor, cutoff });
    return n;
  },
});

/** Source-bound, audited and retry-safe administrative fraud/refund reversal. Never moves cash. */
export const reverseAward = mutation({
  args: { awardEventId: v.id('ldgCreditEvents'), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (a.reason.trim().length < 5) throw new CommerceError('INVALID_INPUT', 'Explain the award reversal');
    const award = await ctx.db.get(a.awardEventId);
    if (!award) throw new CommerceError('INVALID_INPUT', 'Award not found');
    await invalidateAward(ctx, award, admin.email, a.reason.trim());
  },
});

export const myCreditV2 = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    const acct = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', me.userId)).first();
    const events = acct ? await ctx.db.query('ldgCreditEvents').withIndex('by_account_at', (q) => q.eq('accountId', acct._id)).order('desc').take(50) : [];
    const reviewRequired = !!acct && await creditUnderReview(ctx, acct._id);
    return {
      reviewRequired,
      reviewMessage: reviewRequired ? 'Store credit is temporarily unavailable while a referral refund is reviewed. Your credit history is preserved.' : null,
      availableMinor: reviewRequired ? 0 : Math.max(0, acct?.availableMinor ?? 0),
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

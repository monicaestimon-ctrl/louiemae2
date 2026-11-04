// Store credit (spec section 6). holmCredits is a ledger: earned (+), reserved (−, held for an
// order in progress), used (−), released (0, a hold given back) and restored (+, returned after a
// refund). The balance is the sum, so reserved credit can't be spent twice.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser, viewer } from './holmAccess';
import { HOLM_PARTNERS } from '../lib/holmPartners';
import { projectCredit } from '../lib/commerce';

const DAY = 864e5;
/** Stripe Checkout sessions expire after 24 hours; a hold still open after this is released. */
const CHECKOUT_HOLD_MS = 25 * 3600e3;

export async function creditBalance(ctx: QueryCtx, userId: Id<'users'>) {
  const rows = await ctx.db.query('holmCredits').withIndex('by_user', (q) => q.eq('userId', userId)).take(2000);
  return Math.max(0, rows.reduce((t, r) => t + r.amountCents, 0));
}

/** Holds up to `maxCents` of the member's credit for one order. Returns the amount held. */
export async function reserveCredit(ctx: MutationCtx, userId: Id<'users'>, maxCents: number, ref: string) {
  const existing = await ctx.db.query('holmCredits').withIndex('by_ref', (q) => q.eq('ref', ref)).first();
  if (existing) return -existing.amountCents;
  const amount = Math.min(await creditBalance(ctx, userId), Math.max(0, Math.floor(maxCents)));
  if (amount <= 0) return 0;
  await ctx.db.insert('holmCredits', { userId, amountCents: -amount, kind: 'reserved', ref, heldCents: amount, reason: 'Held for an order', at: Date.now() });
  return amount;
}

/**
 * Settles the hold for an order: `used` keeps up to `usedCents` (the rest goes back to the
 * balance); `released` gives it all back. Settling twice changes nothing.
 */
export async function settleCredit(ctx: MutationCtx, ref: string, outcome: 'used' | 'released', usedCents?: number, paymentIntentId?: string) {
  const row = await ctx.db.query('holmCredits').withIndex('by_ref', (q) => q.eq('ref', ref)).first();
  if (!row || row.kind !== 'reserved') return 0;
  const held = row.heldCents ?? -row.amountCents;
  if (outcome === 'released') {
    await ctx.db.patch(row._id, { kind: 'released', amountCents: 0, reason: 'Hold released', at: Date.now() });
    return 0;
  }
  const used = Math.min(held, Math.max(0, usedCents ?? held));
  await ctx.db.patch(row._id, { kind: 'used', amountCents: -used, reason: 'Used on an order', at: Date.now(), ...(paymentIntentId ? { paymentIntentId } : {}) });
  return used;
}

/** The member's credit for the cart and the Hub. */
export const myCredit = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    return { balanceCents: await creditBalance(ctx, me.userId), autoApply: !!me.profile?.creditAutoApply };
  },
});

/** The Hub toggle: apply credit to the next order automatically, or save it. */
export const setCreditAutoApply = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!me.profile) throw new Error('Finish setting up your account first.');
    await ctx.db.patch(me.profile._id, { creditAutoApply: a.on, updatedAt: Date.now() });
  },
});

/** A storefront checkout session failed to start or expired: give its hold back. */
export const releaseCheckout = internalMutation({
  args: { retailCheckoutId: v.string() },
  handler: (ctx, a) => settleCredit(ctx, `checkout:${a.retailCheckoutId}`, 'released'),
});

/** A storefront checkout was paid: the held credit is used. */
export const useCheckout = internalMutation({
  args: { retailCheckoutId: v.id('retailCheckouts'), paymentIntentId: v.optional(v.string()) },
  handler: (ctx, a) => settleCredit(ctx, `checkout:${a.retailCheckoutId}`, 'used', undefined, a.paymentIntentId),
});

/**
 * A storefront payment that used credit was refunded: the refunded share of the credit goes
 * back to the balance. Stripe reports the running refund total, so repeats apply once.
 */
export const restoreOnRefund = internalMutation({
  args: { paymentIntentId: v.string(), refundedCents: v.number(), chargeCents: v.number() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query('holmCredits').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId)).first();
    if (!row || row.kind !== 'used' || a.chargeCents <= 0) return;
    const used = -row.amountCents;
    const target = Math.min(used, Math.round((used * Math.min(a.refundedCents, a.chargeCents)) / a.chargeCents));
    const delta = target - (row.restoredCents ?? 0);
    if (delta <= 0) return;
    await ctx.db.insert('holmCredits', { userId: row.userId, amountCents: delta, kind: 'restored', ref: `${row.ref}:restored`, reason: 'Returned after a refund', at: Date.now() });
    await ctx.db.patch(row._id, { restoredCents: target });
  },
});

/**
 * Hourly safety net for holds: a storefront checkout that never completed (its session has
 * expired) and a /trade quote that was cancelled or not paid in time give the credit back; a
 * quote that was paid uses it.
 */
export const settleStaleHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const holds = await ctx.db.query('holmCredits').withIndex('by_kind', (q) => q.eq('kind', 'reserved')).take(200);
    for (const h of holds) {
      const [type, id] = (h.ref ?? '').split(':');
      if (type === 'checkout') {
        if (now - h.at > CHECKOUT_HOLD_MS) await settleCredit(ctx, h.ref!, 'released');
      } else if (type === 'project') {
        const pid = ctx.db.normalizeId('commerceProjects', id);
        const p = pid ? await ctx.db.get(pid) : null;
        if (p?.paidAt) await settleCredit(ctx, h.ref!, 'used', projectCredit(p));
        else if (!p || p.status === 'cancelled' || now - p.createdAt > HOLM_PARTNERS.quoteHoldDays * DAY) await settleCredit(ctx, h.ref!, 'released');
      }
    }
  },
});

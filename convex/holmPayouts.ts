// Automatic partner payouts through Stripe Connect (spec section 9.1): the database side. The
// Stripe calls live in holmConnect.ts. Nothing here pays anyone unless PARTNER_PAYOUTS_ENABLED
// is "true" in the deployment, which the owner sets once Connect is turned on in Stripe.
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { isPartner, viewer } from './holmAccess';
import { HOLM_PARTNERS } from '../lib/holmPartners';

export const payoutsEnabled = () => process.env.PARTNER_PAYOUTS_ENABLED === 'true';

/**
 * A run must hold a payout's lease to send its transfer or to free it. Convex stops any action
 * after 10 minutes, so once a lease is an hour old its holder can no longer be running: only
 * then can another run take it over. Taking a lease is a mutation, so two runs can't both win.
 */
export const LEASE_MS = 3600e3;
const newToken = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
function takeLease(p: Doc<'holmPayouts'>, now: number) {
  return p.status === 'processing' && (!p.leaseAt || now - p.leaseAt >= LEASE_MS);
}

/** Cleared commission (and adjustments) for a partner that isn't already in a payout. */
export async function unpaidCleared(ctx: QueryCtx, partnerId: Id<'users'>) {
  const rows = await ctx.db
    .query('holmCommissions')
    .withIndex('by_partner_status', (q) => q.eq('partnerId', partnerId).eq('status', 'cleared'))
    .take(2000);
  return rows.filter((c) => !c.payoutId);
}

/** What the setup action needs about the signed-in partner. */
export const connectContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me || !isPartner(me.profile)) return null;
    return { userId: me.userId, email: me.email, accountId: me.profile!.stripeAccountId ?? null };
  },
});

export const setConnectAccount = internalMutation({
  args: { userId: v.id('users'), accountId: v.string() },
  handler: async (ctx, a) => {
    const p = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', a.userId)).unique();
    if (p && !p.stripeAccountId) await ctx.db.patch(p._id, { stripeAccountId: a.accountId });
  },
});

/** Stripe's view of a connected account: ready for payouts, or what Stripe still needs. */
export const setConnectStatus = internalMutation({
  args: { accountId: v.string(), ready: v.boolean(), due: v.array(v.string()) },
  handler: async (ctx, a) => {
    const p = await ctx.db.query('holmProfiles').withIndex('by_stripe_account', (q) => q.eq('stripeAccountId', a.accountId)).unique();
    if (p) await ctx.db.patch(p._id, { payoutsReady: a.ready, payoutsDue: a.due.slice(0, 20) });
  },
});

/** Payouts an earlier run started but didn't finish (an unclear transfer outcome). */
export const openPayouts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('holmPayouts').withIndex('by_status', (q) => q.eq('status', 'processing')).take(500);
    return rows.filter((p) => p.accountId).map((p) => ({ payoutId: p._id, accountId: p.accountId!, startedAt: p.paidAt, leaseAt: p.leaseAt ?? 0 }));
  },
});

/** Take an unfinished payout's lease to settle it, if no other run can still be working on it. */
export const leasePayout = internalMutation({
  args: { payoutId: v.id('holmPayouts') },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.payoutId);
    const now = Date.now();
    if (!p || !takeLease(p, now)) return null;
    const token = newToken();
    await ctx.db.patch(p._id, { leaseToken: token, leaseAt: now });
    return token;
  },
});

/** Partners with a connected account, for the monthly run. */
export const payoutTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const partners = await ctx.db.query('holmProfiles').withIndex('by_partner_status', (q) => q.eq('partnerStatus', 'active')).take(2000);
    return partners.filter((p) => p.stripeAccountId).map((p) => ({ userId: p.userId, accountId: p.stripeAccountId! }));
  },
});

/**
 * Starts this month's payout for one partner: everything cleared and not yet paid, if it
 * reaches the minimum. The rows are tied to the payout so nothing is paid twice; a payout
 * already started for the month is returned again so a retry resumes it.
 */
export const claimPayout = internalMutation({
  args: { partnerId: v.id('users'), period: v.string(), accountId: v.string() },
  handler: async (ctx, a) => {
    const month = await ctx.db
      .query('holmPayouts')
      .withIndex('by_partner_period', (q) => q.eq('partnerId', a.partnerId).eq('period', a.period))
      .take(10);
    if (month.some((x) => x.status === 'paid')) return null;
    const open = month.find((x) => x.status === 'processing');
    if (open) {
      // Resume it only if no other run can still be sending it.
      if (!takeLease(open, Date.now())) return null;
      const token = newToken();
      await ctx.db.patch(open._id, { leaseToken: token, leaseAt: Date.now() });
      return { payoutId: open._id, amountCents: open.amountCents, token };
    }
    // (a failed attempt this month leaves its rows free, so it can be tried again)
    const rows = await unpaidCleared(ctx, a.partnerId);
    const amount = rows.reduce((t, c) => t + c.amountCents, 0);
    if (amount < HOLM_PARTNERS.payoutMinCents) return null; // carries over to next month
    const token = newToken();
    const payoutId = await ctx.db.insert('holmPayouts', {
      partnerId: a.partnerId,
      amountCents: amount,
      reference: '',
      paidBy: 'Stripe',
      paidAt: Date.now(),
      method: 'stripe',
      status: 'processing',
      period: a.period,
      accountId: a.accountId,
      leaseToken: token,
      leaseAt: Date.now(),
    });
    for (const c of rows) await ctx.db.patch(c._id, { payoutId });
    return { payoutId, amountCents: amount, token };
  },
});

/** The transfer went through: the commission is paid and the partner hears about it. */
export const completePayout = internalMutation({
  args: { payoutId: v.id('holmPayouts'), transferId: v.string() },
  handler: async (ctx, a) => {
    const payout = await ctx.db.get(a.payoutId);
    if (!payout || payout.status !== 'processing') return;
    await ctx.db.patch(payout._id, { status: 'paid', reference: a.transferId, paidAt: Date.now() });
    for (const c of await rowsOf(ctx, payout)) await ctx.db.patch(c._id, { status: 'paid' });
    const user = await ctx.db.get(payout.partnerId);
    if (typeof user?.email === 'string')
      await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
        key: `payout:${payout._id}`,
        to: user.email,
        subject: 'Your Louie Mae commission is on its way',
        text: `We sent $${(payout.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} in partner commission to your connected bank account through Stripe. Stripe pays it into your bank on its usual schedule, usually within a few business days.\n\nPartner terms: https://www.louiemae.com/trade#partner-terms`,
      });
  },
});

/**
 * No transfer was made: the commission is free again. Only the run holding the payout's lease
 * can do this, so it can never happen while another run may still be sending the transfer.
 */
export const failPayout = internalMutation({
  args: { payoutId: v.id('holmPayouts'), error: v.string(), token: v.string() },
  handler: async (ctx, a) => {
    const payout = await ctx.db.get(a.payoutId);
    if (!payout || payout.status !== 'processing' || payout.leaseToken !== a.token) return;
    for (const c of await rowsOf(ctx, payout)) await ctx.db.patch(c._id, { payoutId: undefined });
    await ctx.db.patch(payout._id, { status: 'failed', error: a.error.slice(0, 300) });
  },
});

async function rowsOf(ctx: MutationCtx, payout: Doc<'holmPayouts'>) {
  const rows = await ctx.db
    .query('holmCommissions')
    .withIndex('by_partner_status', (q) => q.eq('partnerId', payout.partnerId).eq('status', 'cleared'))
    .take(2000);
  return rows.filter((c) => c.payoutId === payout._id);
}

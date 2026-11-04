'use node';
// Automatic partner payouts through Stripe Connect Express (spec section 9.1): the Stripe side.
// Partners connect their own bank account on Stripe's pages; Louie Mae never sees bank details.
// Every call is off unless PARTNER_PAYOUTS_ENABLED is "true".
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';

const enabled = () => process.env.PARTNER_PAYOUTS_ENABLED === 'true';
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
const SITE = 'https://www.louiemae.com';
const statusOf = (a: Stripe.Account) => ({
  ready: !!a.payouts_enabled && a.capabilities?.transfers === 'active',
  due: [...(a.requirements?.currently_due ?? []), ...(a.requirements?.past_due ?? [])],
});

/** "Set up payouts": creates the partner's Express account once, then sends them to Stripe. */
export const startPayoutSetup = action({
  args: { returnTo: v.union(v.literal('trade'), v.literal('creators')) },
  handler: async (ctx, a): Promise<string> => {
    if (!enabled()) throw new Error('Automatic payouts are not switched on yet.');
    const me = await ctx.runQuery(internal.holmPayouts.connectContext, {});
    if (!me) throw new Error('Join the partner program first.');
    const s = stripe();
    let accountId = me.accountId;
    if (!accountId) {
      const account = await s.accounts.create(
        {
          type: 'express',
          country: 'US',
          email: me.email || undefined,
          capabilities: { transfers: { requested: true } },
          metadata: { userId: me.userId },
        },
        { idempotencyKey: `holm-connect:${me.userId}` }
      );
      accountId = account.id;
      await ctx.runMutation(internal.holmPayouts.setConnectAccount, { userId: me.userId, accountId });
    }
    const back = a.returnTo === 'creators' ? `${SITE}/#creators` : `${SITE}/trade#hub`;
    const link = await s.accountLinks.create({ account: accountId, refresh_url: back, return_url: back, type: 'account_onboarding' });
    return link.url;
  },
});

/** Back from Stripe (or "Check again"): read whether payouts are ready. */
export const refreshPayoutStatus = action({
  args: {},
  handler: async (ctx) => {
    if (!enabled()) return null;
    const me = await ctx.runQuery(internal.holmPayouts.connectContext, {});
    if (!me?.accountId) return null;
    const st = statusOf(await stripe().accounts.retrieve(me.accountId));
    await ctx.runMutation(internal.holmPayouts.setConnectStatus, { accountId: me.accountId, ...st });
    return st;
  },
});

/**
 * The 15th of each month: one Stripe transfer per partner whose payouts are ready and whose
 * cleared balance is $50 or more. Each payout is keyed by its own record, so a retry can never
 * pay twice; a failed transfer frees the commission for the next run.
 */
export const runMonthlyPayouts = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!enabled()) return { paid: 0, skipped: 'disabled' as const };
    const s = stripe();
    const period = new Date().toISOString().slice(0, 7);
    const targets = await ctx.runQuery(internal.holmPayouts.payoutTargets, {});
    let paid = 0;
    for (const t of targets) {
      try {
        const st = statusOf(await s.accounts.retrieve(t.accountId));
        await ctx.runMutation(internal.holmPayouts.setConnectStatus, { accountId: t.accountId, ...st });
        if (!st.ready) continue; // carries over until Stripe has what it needs
      } catch (err) {
        console.error('Could not read connected account', t.accountId, (err as Error)?.message);
        continue;
      }
      const claim = await ctx.runMutation(internal.holmPayouts.claimPayout, { partnerId: t.userId, period, accountId: t.accountId });
      if (!claim) continue;
      try {
        const transfer = await s.transfers.create(
          {
            amount: claim.amountCents,
            currency: 'usd',
            destination: t.accountId,
            description: `Louie Mae partner commission ${period}`,
            metadata: { payoutId: claim.payoutId, partnerId: t.userId, period },
          },
          { idempotencyKey: `holm-payout:${claim.payoutId}` }
        );
        await ctx.runMutation(internal.holmPayouts.completePayout, { payoutId: claim.payoutId, transferId: transfer.id });
        paid++;
      } catch (err) {
        await ctx.runMutation(internal.holmPayouts.failPayout, { payoutId: claim.payoutId, error: String((err as Error)?.message || err) });
      }
    }
    return { paid };
  },
});

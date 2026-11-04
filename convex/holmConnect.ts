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

/** Stripe refused the request outright, so no transfer exists and the commission can be freed. */
const definitelyRejected = (err: unknown) => {
  const type = (err as { type?: string })?.type;
  return type === 'StripeInvalidRequestError' || type === 'StripePermissionError' || type === 'StripeAuthenticationError';
};

/**
 * The 15th of each month: one Stripe transfer per partner whose payouts are ready and whose
 * cleared balance is $50 or more. Each payout is keyed by its own record, so a retry can never
 * pay twice. Only a definite rejection frees the commission; an unclear outcome (a timeout, a
 * server error) leaves the payout processing, and the next run asks Stripe what happened.
 */
export const runMonthlyPayouts = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!enabled()) return { paid: 0, skipped: 'disabled' as const };
    const s = stripe();
    const period = new Date().toISOString().slice(0, 7);
    let paid = 0;
    // First, settle any payout an earlier run left unfinished: find its transfer in Stripe by
    // the payout id it carries. Found: it was paid. Not found: Stripe never made it, so free it.
    // A run may only settle a payout whose lease it takes: no other run can still be sending it.
    for (const open of await ctx.runQuery(internal.holmPayouts.openPayouts, {})) {
      const token = await ctx.runMutation(internal.holmPayouts.leasePayout, { payoutId: open.payoutId });
      if (!token) continue;
      try {
        let found: Stripe.Transfer | undefined;
        let after: string | undefined;
        // Every page of the account's transfers since the payout started.
        for (;;) {
          const page = await s.transfers.list({
            destination: open.accountId,
            created: { gte: Math.floor(open.startedAt / 1000) - 3600 },
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          });
          found = page.data.find((tr) => tr.metadata?.payoutId === open.payoutId);
          if (found || !page.has_more || !page.data.length) break;
          after = page.data[page.data.length - 1].id;
        }
        if (found) await ctx.runMutation(internal.holmPayouts.completePayout, { payoutId: open.payoutId, transferId: found.id });
        else await ctx.runMutation(internal.holmPayouts.failPayout, { payoutId: open.payoutId, token, error: 'No transfer was made; the commission goes in this run.' });
      } catch (err) {
        console.error('Could not check an unfinished payout', open.payoutId, (err as Error)?.message);
      }
    }
    const targets = await ctx.runQuery(internal.holmPayouts.payoutTargets, {});
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
      let transferId: string;
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
        transferId = transfer.id;
      } catch (err) {
        if (definitelyRejected(err))
          await ctx.runMutation(internal.holmPayouts.failPayout, { payoutId: claim.payoutId, token: claim.token, error: String((err as Error)?.message || err) });
        else console.error('Transfer outcome unknown; the payout stays processing for the next run', claim.payoutId, (err as Error)?.message);
        continue;
      }
      // Outside the try: if recording fails, the payout stays processing and is settled from Stripe next run.
      await ctx.runMutation(internal.holmPayouts.completePayout, { payoutId: claim.payoutId, transferId });
      paid++;
    }
    return { paid };
  },
});

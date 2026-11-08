'use node';
// Payout runs v2 — the Stripe side (spec S30). Runs only when PAYOUT_EXECUTION_ENABLED is the
// sole automatic payout route. Transfers carry the attempt's idempotency key; a timeout or 5xx
// is "uncertain" and is reconciled by listing transfers before any retry. This build never
// executes against Stripe in tests (mocked) and moves no money by itself.
import Stripe from 'stripe';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { payoutRoute } from '../lib/flags';
import { inLocalWindow } from '../lib/tiers';
import type { PayoutSchedule } from '../lib/config';

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

const definitelyRejected = (err: unknown) => {
  const type = (err as { type?: string })?.type;
  return type === 'StripeInvalidRequestError' || type === 'StripePermissionError' || type === 'StripeAuthenticationError';
};

/** Runs (or resumes) one period's monthly payouts end to end. */
export const runPeriod = internalAction({
  args: { period: v.string() },
  handler: async (ctx, a) => {
    const route = payoutRoute();
    if (route !== 'v2') return { skipped: route === 'conflict' ? 'both payout routes are on' : 'v2 payouts off' };
    const { runId } = await ctx.runMutation(internal.ldgPayouts.openRun, { period: a.period, kind: 'monthly', by: 'cron' });
    let cursor: string | null = null;
    for (let i = 0; i < 1000; i++) {
      const r: { isDone: boolean; continueCursor: string | null } = await ctx.runMutation(internal.ldgPayouts.planPage, { runId, cursor });
      if (r.isDone) break;
      cursor = r.continueCursor;
    }
    const s = stripe();
    const balance = await s.balance.retrieve();
    const availableMinor = balance.available.filter((b) => b.currency === 'usd').reduce((t, b) => t + b.amount, 0);
    if (!(await ctx.runMutation(internal.ldgPayouts.recordFunding, { runId, availableMinor }))) return { aborted: 'insufficient platform balance' };
    let sent = 0;
    for (const t of await ctx.runQuery(internal.ldgPayouts.attemptsToSubmit, { runId })) {
      if (!(await ctx.runMutation(internal.ldgPayouts.markSubmitted, { attemptId: t._id }))) continue;
      try {
        const transfer = await s.transfers.create(
          { amount: t.amountMinor, currency: 'usd', destination: t.destination, description: `Louie Mae partner commission ${a.period}`, metadata: { attemptId: t._id, runId, period: a.period } },
          { idempotencyKey: t.idempotencyKey }
        );
        await ctx.runMutation(internal.ldgPayouts.recordResult, { attemptId: t._id, outcome: 'succeeded', transferId: transfer.id });
        sent++;
      } catch (err) {
        await ctx.runMutation(internal.ldgPayouts.recordResult, { attemptId: t._id, outcome: definitelyRejected(err) ? 'failed' : 'uncertain', error: String((err as Error)?.message ?? err) });
      }
    }
    await ctx.runMutation(internal.ldgPayouts.finishRun, { runId });
    return { sent };
  },
});

/** Resolves uncertain transfers by finding them in Stripe by attempt id; never re-sends blindly. */
export const reconcileUncertain = internalAction({
  args: {},
  handler: async (ctx) => {
    if (payoutRoute() !== 'v2') return 0;
    const s = stripe();
    let resolved = 0;
    for (const t of await ctx.runQuery(internal.ldgPayouts.uncertainAttempts, {})) {
      let found: Stripe.Transfer | undefined;
      let after: string | undefined;
      for (;;) {
        const page = await s.transfers.list({ destination: t.destination, created: { gte: Math.floor((t.submittedAt ?? t.createdAt) / 1000) - 3600 }, limit: 100, ...(after ? { starting_after: after } : {}) });
        found = page.data.find((tr) => tr.metadata?.attemptId === t._id);
        if (found || !page.has_more || !page.data.length) break;
        after = page.data[page.data.length - 1].id;
      }
      if (found) await ctx.runMutation(internal.ldgPayouts.recordResult, { attemptId: t._id, outcome: 'succeeded', transferId: found.id });
      else if (Date.now() - (t.submittedAt ?? t.createdAt) > 3600e3) await ctx.runMutation(internal.ldgPayouts.recordResult, { attemptId: t._id, outcome: 'failed', error: 'No transfer exists in Stripe for this attempt' });
      resolved++;
    }
    return resolved;
  },
});

/** Hourly: on the configured local day and hour (09:00 America/Chicago on the 15th), start the month's run. */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (payoutRoute() !== 'v2') return;
    const schedule = await ctx.runQuery(internal.sysConfig.active, { kind: 'payoutSchedule', key: 'payout-schedule' }).catch(() => null);
    if (!schedule) return;
    const s = schedule.value as PayoutSchedule;
    const date = inLocalWindow(Date.now(), s.tz, s.localTime);
    if (!date || Number(date.slice(8, 10)) !== s.day) return;
    await ctx.runAction(internal.ldgPayoutActions.runPeriod, { period: date.slice(0, 7) });
  },
});

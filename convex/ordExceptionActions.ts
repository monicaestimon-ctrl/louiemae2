'use node';
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';

/** Read-only provider verification. No create/refund/capture/cancel/payment methods are called. */
export const verify = action({
  args: { id: v.id('ordPaidExceptions') },
  handler: async (ctx, a): Promise<Id<'ordPaymentVerifications'>> => {
    const work = await ctx.runQuery(internal.ordExceptionRefunds.work, a);
    if (!(await ctx.runMutation(internal.ordExceptionRefunds.permit, {})))
      throw new CommerceError('RATE_LIMITED');
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || !/^(sk|rk)_(live|test)_/.test(key))
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'Payment verification is not configured'
      );
    const live = /^(sk|rk)_live_/.test(key);
    const stripe = new Stripe(key, { timeout: 4000, maxNetworkRetries: 0 });
    try {
      const session = await stripe.checkout.sessions.retrieve(work.sessionId, {
        expand: ['payment_intent.latest_charge'],
      });
      const payment = typeof session.payment_intent === 'object' ? session.payment_intent : null;
      const charge = typeof payment?.latest_charge === 'object' ? payment.latest_charge : null;
      if (
        session.id !== work.sessionId ||
        session.metadata?.intentId !== work.intentId ||
        session.livemode !== live ||
        session.payment_status !== 'paid' ||
        !payment ||
        payment.id !== work.paymentIntentId ||
        payment.livemode !== live ||
        payment.status !== 'succeeded' ||
        !charge ||
        charge.livemode !== live ||
        !charge.paid ||
        session.amount_total !== charge.amount ||
        payment.amount_received !== charge.amount ||
        session.currency !== charge.currency ||
        payment.currency !== charge.currency
      )
        throw new Error('Payment identity or amount does not reconcile');
      const refunds = await stripe.refunds.list({ payment_intent: payment.id, limit: 100 });
      if (refunds.has_more) throw new Error('Refund history requires manual review');
      let succeededRefundMinor = 0,
        pendingRefundMinor = 0;
      for (const refund of refunds.data) {
        const refundPayment =
          typeof refund.payment_intent === 'string'
            ? refund.payment_intent
            : refund.payment_intent?.id;
        const refundCharge = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
        if (
          refundPayment !== payment.id ||
          refundCharge !== charge.id ||
          refund.currency !== charge.currency ||
          !Number.isSafeInteger(refund.amount) ||
          refund.amount < 0
        )
          throw new Error('Refund identity mismatch');
        if (refund.status === 'succeeded') succeededRefundMinor += refund.amount;
        else if (refund.status !== 'failed' && refund.status !== 'canceled')
          pendingRefundMinor += refund.amount;
      }
      return await ctx.runMutation(internal.ordExceptionRefunds.record, {
        id: a.id,
        intentId: work.intentId,
        sessionId: session.id,
        paymentIntentId: payment.id,
        chargeId: charge.id,
        amountMinor: charge.amount,
        currency: charge.currency,
        livemode: live,
        captured: charge.captured,
        disputed: charge.disputed,
        succeededRefundMinor,
        pendingRefundMinor,
        refundIds: refunds.data.map((r) => r.id),
      });
    } catch {
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'Provider verification is incomplete. Keep the exception open and retry or investigate in Stripe.'
      );
    }
  },
});

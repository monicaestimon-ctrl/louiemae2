'use node';
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { acceptsPlatformPayment } from '../lib/paymentMode';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';

function client() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error('Payments are not configured.');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
async function recoverSession(ctx: ActionCtx, o: Doc<'trendsiOrders'>, stripe: Stripe) {
  if (o.sessionId)
    return stripe.checkout.sessions.retrieve(o.sessionId, {
      expand: ['payment_intent.latest_charge'],
    });
  if (!o.stripeCustomerId) return null;
  const page = await stripe.checkout.sessions.list({ customer: o.stripeCustomerId, limit: 100 });
  if (page.has_more) throw Error('Payment history needs reconciliation in Stripe.');
  const matches = page.data.filter(
    (s) =>
      s.metadata?.trendsiOrderId === o._id &&
      s.metadata?.revision === String(o.paymentAttemptRevision)
  );
  if (matches.length > 1) throw Error('Multiple payment sessions require review in Stripe.');
  if (!matches.length) return null;
  const s = matches[0];
  await ctx.runMutation(internal.trendsiManual.attachSession, {
    id: o._id,
    revision: o.paymentAttemptRevision!,
    sessionId: s.id,
    url: s.url ?? '',
  });
  return stripe.checkout.sessions.retrieve(s.id, { expand: ['payment_intent.latest_charge'] });
}
export const createLink = action({
  args: { id: v.id('trendsiOrders'), revision: v.number() },
  handler: async (ctx, a): Promise<{ url: string }> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    if (process.env.TRENDSI_MANUAL_ENABLED !== 'true')
      throw Error('Manual orders are not enabled.');
    const stripe = client();
    const o = await ctx.runMutation(internal.trendsiManual.claimPayment, a);
    const recovered = await recoverSession(ctx, o, stripe);
    if (recovered) {
      await reconcile(ctx, o._id);
      const existing = recovered;
      if (existing.status !== 'open' || !existing.url)
        throw Error('Payment is complete or expired. Refresh the request.');
      return { url: existing.url };
    }
    if (!o.sessionExpiresAt || o.sessionExpiresAt <= Date.now() + 30 * 60_000)
      throw Error('Payment setup needs reconciliation. Use Check payment before retrying.');
    const key = `trendsi:${o._id}:${o.paymentAttemptRevision}`;
    const address = {
      line1: o.address.line1,
      line2: o.address.line2,
      city: o.address.city,
      state: o.address.state,
      postal_code: o.address.postalCode,
      country: o.address.country,
    };
    // A dedicated immutable destination per quote prevents a later address edit changing the
    // reviewed shipping charge. Stripe Tax uses this customer's saved shipping address.
    const customer = await stripe.customers.create(
      {
        name: o.name,
        email: o.email,
        phone: o.phone || undefined,
        address,
        shipping: { name: o.name, address, phone: o.phone || undefined },
        metadata: { trendsiOrderId: o._id },
      },
      { idempotencyKey: `${key}:customer` }
    );
    await ctx.runMutation(internal.trendsiManual.attachCustomer, {
      id: o._id,
      revision: o.paymentAttemptRevision!,
      customerId: customer.id,
    });
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customer.id,
        payment_method_types: ['card'],
        billing_address_collection: 'required',
        automatic_tax: { enabled: true },
        line_items: o.items.map((i) => ({
          price_data: {
            currency: 'usd',
            tax_behavior: 'exclusive',
            unit_amount: i.unitMinor,
            product_data: { name: `${i.name} — ${i.variantName}` },
          },
          quantity: i.quantity,
        })),
        shipping_options: [
          {
            shipping_rate_data: {
              display_name: o.deliveryEstimate!,
              type: 'fixed_amount',
              fixed_amount: { amount: o.shippingMinor!, currency: 'usd' },
              tax_behavior: 'exclusive',
            },
          },
        ],
        payment_intent_data: {
          metadata: { trendsiOrderId: o._id },
          shipping: { name: o.name, address, phone: o.phone || undefined },
        },
        metadata: { trendsiOrderId: o._id, revision: String(o.paymentAttemptRevision) },
        custom_text: {
          submit: {
            message: `Delivery to ${o.address.line1}, ${o.address.city}, ${o.address.state} ${o.address.postalCode}. Contact Louie Mae before paying if this address needs to change.`,
          },
        },
        expires_at: Math.floor(o.sessionExpiresAt / 1000),
        success_url: `https://www.louiemae.com/#checkout/success?trendsi=${o._id}&access=${o.token}`,
        cancel_url: `https://www.louiemae.com/#checkout/success?trendsi=${o._id}&access=${o.token}`,
      },
      { idempotencyKey: `${key}:session` }
    );
    if (!session.url) throw Error('Payment link was not returned. Check payment before retrying.');
    await ctx.runMutation(internal.trendsiManual.attachSession, {
      id: o._id,
      revision: o.paymentAttemptRevision!,
      sessionId: session.id,
      url: session.url,
    });
    return { url: session.url };
  },
});

async function reconcile(ctx: ActionCtx, id: Id<'trendsiOrders'>): Promise<void> {
  const o = await ctx.runQuery(internal.trendsiManual.record, { id });
  if (!o) throw Error('Request not found.');
  const stripe = client();
  const s = await recoverSession(ctx, o, stripe);
  if (!s) {
    if (o.sessionExpiresAt && o.sessionExpiresAt + 60_000 <= Date.now()) {
      await ctx.runMutation(internal.trendsiManual.resetUncreatedPayment, {
        id: o._id,
        revision: o.paymentAttemptRevision!,
      });
      return;
    }
    throw Error(
      'No payment session found. Retry Prepare / recover payment link, or check again after this attempt expires.'
    );
  }
  if (
    !acceptsPlatformPayment(s.livemode) ||
    s.metadata?.trendsiOrderId !== id ||
    s.metadata?.revision !== String(o.paymentAttemptRevision)
  )
    throw Error('Payment identity does not match this request.');
  const merchandise = o.items.reduce((n, i) => n + i.unitMinor * i.quantity, 0);
  const tax = s.total_details?.amount_tax ?? 0;
  const intent = typeof s.payment_intent === 'object' ? s.payment_intent : null;
  const charge = typeof intent?.latest_charge === 'object' ? intent.latest_charge : null;
  let hold: string | undefined;
  if (
    s.payment_status === 'paid' &&
    (s.currency !== 'usd' ||
      s.amount_subtotal !== merchandise ||
      s.shipping_cost?.amount_subtotal !== o.shippingMinor ||
      s.amount_total !== merchandise + (o.shippingMinor ?? 0) + tax ||
      s.automatic_tax.status !== 'complete')
  )
    hold = 'Payment totals or tax require review.';
  if (charge?.disputed || (charge?.amount_refunded ?? 0) > 0)
    hold = 'Payment has a refund or dispute. Review in Stripe before fulfillment.';
  await ctx.runMutation(internal.trendsiManual.paymentResult, {
    id,
    sessionId: s.id,
    paid: s.payment_status === 'paid',
    expired: s.status === 'expired',
    ...(intent ? { paymentIntentId: intent.id } : {}),
    totalMinor: s.amount_total ?? 0,
    taxMinor: tax,
    fullyRefunded: Boolean(charge && charge.amount > 0 && charge.amount_refunded >= charge.amount),
    ...(hold ? { hold } : {}),
  });
}
export const check = action({
  args: { id: v.id('trendsiOrders') },
  handler: async (ctx, a): Promise<void> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    await reconcile(ctx, a.id);
  },
});
export const receive = internalAction({
  args: { id: v.id('trendsiOrders') },
  handler: async (ctx, a): Promise<void> => {
    await reconcile(ctx, a.id);
  },
});
export const receiveByPayment = internalAction({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, a): Promise<boolean> => {
    const order = await ctx.runQuery(internal.trendsiManual.byPayment, a);
    if (!order) return false;
    await reconcile(ctx, order._id);
    return true;
  },
});

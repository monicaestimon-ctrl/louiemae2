// Verified payment events (spec S19, S38, v2 §12, §21). Every signed Stripe event for a v2
// checkout is stored first (dedupe by event id), then processed durably. Duplicate or out-of-order
// events never duplicate orders, commissions, credits or fulfillment tasks; a payment confirmed
// after an expiry or a failed check becomes a paid-order exception, never a second charge.
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { bumpMetric, openReview } from './sysCore';
import { createOrderFromIntent } from './ordFulfillment';
import { releaseIntent } from './ordCheckout';
import { accrueForOrder } from './ldgCommissions';
import { onOrderPaid, settle as settleCredit } from './ldgCredits';
import { convertPaidQuote } from './dlvQuoteLifecycle';
import { paymentStockFailure, retainPaidCommitments } from './ordInventory';

export type SessionPayload = {
  id: string;
  intentId: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  email: string;
  shipping?: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string };
};

/** Stores a verified event once and schedules processing. Returns false for a duplicate. */
export const receive = internalMutation({
  args: { eventId: v.string(), type: v.string(), livemode: v.boolean(), account: v.optional(v.string()), payloadHash: v.string(), payload: v.any() },
  handler: async (ctx, a) => {
    const seen = await ctx.db.query('sysPaymentEvents').withIndex('by_event', (q) => q.eq('eventId', a.eventId)).first();
    if (seen) return false;
    const id = await ctx.db.insert('sysPaymentEvents', { provider: 'stripe', eventId: a.eventId, type: a.type, livemode: a.livemode, ...(a.account ? { account: a.account } : {}), payloadHash: a.payloadHash, payload: a.payload, receivedAt: Date.now(), status: 'received', attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.ordPayments.process, { id });
    return true;
  },
});

async function handleSession(ctx: MutationCtx, s: SessionPayload, kind: 'completed' | 'expired') {
  const intentId = ctx.db.normalizeId('ordCheckoutIntents', s.intentId);
  const intent = intentId ? await ctx.db.get(intentId) : null;
  if (!intent) return 'ignored';
  if (kind === 'expired') {
    if (intent.status === 'session_open' || intent.status === 'created') await releaseIntent(ctx, intent, 'expired');
    return 'processed';
  }
  if (s.payment_status !== 'paid') return 'ignored';
  if (intent.status === 'paid') return 'processed'; // duplicate delivery
  const existing = await ctx.db.query('ordOrders').withIndex('by_payment', (q) => q.eq('paymentIntentId', s.payment_intent ?? '')).first();
  if (existing && s.payment_intent) return 'processed';
  const evidence = { sessionId: s.id, amount: s.amount_total, currency: s.currency, paymentIntent: s.payment_intent, intentStatus: intent.status };
  const mismatch = s.currency !== 'usd' || s.amount_total !== intent.totalMinor || (intent.stripeSessionId && intent.stripeSessionId !== s.id);
  const expired = intent.status !== 'session_open' || intent.expiresAt <= Date.now();
  const stockFailure = !mismatch && !expired ? await paymentStockFailure(ctx, intent) : null;
  if (mismatch || expired || stockFailure) {
    const prior=await ctx.db.query('ordPaidExceptions').withIndex('by_session',q=>q.eq('stripeSessionId',s.id)).first();
    if(prior)return 'processed';
    await ctx.db.insert('ordPaidExceptions', { intentId: intent._id, ...(s.payment_intent ? { paymentIntentId: s.payment_intent } : {}), stripeSessionId: s.id, reason: mismatch ? 'total_mismatch' : expired ? 'intent_expired' : 'stock_failed', evidence: { ...evidence, stockFailure }, status: 'open', createdAt: Date.now() });
    await ctx.db.patch(intent._id, { status: 'exception' });
    await retainPaidCommitments(ctx, intent._id);
    await bumpMetric(ctx, 'payment.exception');
    return 'processed';
  }
  await ctx.db.patch(intent._id, { status: 'paid' });
  const orderId = await createOrderFromIntent(ctx, intent, { ...(s.payment_intent ? { paymentIntentId: s.payment_intent } : {}), email: (s.email || intent.buyer.email || '').toLowerCase(), ...((intent.shippingAddress ?? s.shipping) ? { shippingAddress: intent.shippingAddress ?? s.shipping } : {}), paidAt: Date.now() });
  if (intent.creditReservationRef) await settleCredit(ctx, intent.creditReservationRef, 'redeemed', intent.creditMinor, orderId);
  await accrueForOrder(ctx, orderId);
  await convertPaidQuote(ctx, intent.estimateId, orderId);
  await onOrderPaid(ctx, orderId);
  if(intent.taxCalculationRef){
    const id=await ctx.db.insert('dlvTaxTransactions',{orderId,calculationRef:intent.taxCalculationRef,status:'pending',attempts:0,nextAttemptAt:Date.now(),createdAt:Date.now()});
    await ctx.scheduler.runAfter(0,internal.dlvTaxActions.commit,{id});
  }
  if (!intent.taxCalculationRef) await openReview(ctx,'manual_sale_tax_reporting','ordOrders',orderId,'Paid manual quote requires tax-reporting evidence. Use the frozen quote tax and address; do not charge the customer again.');
  await bumpMetric(ctx, 'payment.order_created');
  return 'processed';
}

export const process = internalMutation({
  args: { id: v.id('sysPaymentEvents') },
  handler: async (ctx, a) => {
    const ev = await ctx.db.get(a.id);
    if (!ev || ev.status === 'processed' || ev.status === 'ignored') return;
    let outcome: 'processed' | 'ignored' = 'ignored';
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') outcome = await handleSession(ctx, ev.payload as SessionPayload, 'completed');
    else if (ev.type === 'checkout.session.expired' || ev.type === 'checkout.session.async_payment_failed') outcome = await handleSession(ctx, ev.payload as SessionPayload, 'expired');
    await ctx.db.patch(ev._id, { status: outcome, attempts: ev.attempts + 1, processedAt: Date.now() });
  },
});

/** Re-queues events left unprocessed (e.g. after a platform restart); backlog feeds the 15-minute alert. */
export const recoverBacklog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db.query('sysPaymentEvents').withIndex('by_status_received', (q) => q.eq('status', 'received').lte('receivedAt', Date.now() - 5 * 60_000)).take(50);
    for (const ev of stale) await ctx.scheduler.runAfter(0, internal.ordPayments.process, { id: ev._id });
    return stale.length;
  },
});

export const backlog = internalQuery({
  args: {},
  handler: async (ctx) => {
    const oldest = await ctx.db.query('sysPaymentEvents').withIndex('by_status_received', (q) => q.eq('status', 'received')).first();
    return { oldestReceivedAt: oldest?.receivedAt ?? null };
  },
});

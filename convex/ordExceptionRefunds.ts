import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';
import { audit, rateLimit } from './sysCore';
import { digest } from './dlvSecurity';
import { settle as settleCredit } from './ldgCredits';
import { acceptsPlatformPayment } from '../lib/paymentMode';

export const proofFields = {
  sessionId: v.string(),
  paymentIntentId: v.string(),
  chargeId: v.string(),
  amountMinor: v.number(),
  currency: v.string(),
  livemode: v.boolean(),
  captured: v.boolean(),
  disputed: v.boolean(),
  succeededRefundMinor: v.number(),
  pendingRefundMinor: v.number(),
  refundIds: v.array(v.string()),
  succeededRefundIds: v.optional(v.array(v.string())),
};

export const work = internalQuery({
  args: { id: v.id('ordPaidExceptions') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    const exception = await ctx.db.get(a.id);
    const intent = exception?.intentId ? await ctx.db.get(exception.intentId) : null;
    if (
      !exception ||
      exception.status !== 'open' ||
      !intent ||
      intent.status !== 'exception' ||
      !exception.stripeSessionId ||
      !exception.paymentIntentId
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'This exception needs finance investigation before provider verification'
      );
    return {
      exceptionId: exception._id,
      intentId: intent._id,
      sessionId: exception.stripeSessionId,
      paymentIntentId: exception.paymentIntentId,
      paymentStateVersion: exception.paymentStateVersion ?? 0,
    };
  },
});

/** Separate transaction: failed provider reads still consume their staff request budget. */
export const permit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    return rateLimit(ctx, `exception-verification:${await digest(actor.email)}`, 10, 2);
  },
});

export const record = internalMutation({
  args: {
    id: v.id('ordPaidExceptions'),
    intentId: v.id('ordCheckoutIntents'),
    expectedPaymentStateVersion: v.optional(v.number()),
    ...proofFields,
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    if (!acceptsPlatformPayment(a.livemode))
      throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED');
    const exception = await ctx.db.get(a.id);
    const intent = await ctx.db.get(a.intentId);
    if (
      !exception ||
      exception.status !== 'open' ||
      exception.intentId !== a.intentId ||
      exception.stripeSessionId !== a.sessionId ||
      exception.paymentIntentId !== a.paymentIntentId ||
      (exception.paymentStateVersion ?? 0) !== (a.expectedPaymentStateVersion ?? 0) ||
      intent?.status !== 'exception'
    )
      throw new CommerceError('INVALID_INPUT', 'Exception changed during provider verification');
    if (
      ![a.amountMinor, a.succeededRefundMinor, a.pendingRefundMinor].every(
        (n) => Number.isSafeInteger(n) && n >= 0
      ) ||
      a.amountMinor <= 0 ||
      a.succeededRefundMinor + a.pendingRefundMinor > a.amountMinor ||
      a.refundIds.length > 100 ||
      (a.succeededRefundIds?.some((id) => !a.refundIds.includes(id)) ?? false)
    )
      throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED');
    const { id, expectedPaymentStateVersion, ...proof } = a;
    const verificationId = await ctx.db.insert('ordPaymentVerifications', {
      ...proof,
      exceptionId: id,
      paymentStateVersion: expectedPaymentStateVersion ?? 0,
      verifiedAt: Date.now(),
      validUntil: Date.now() + 5 * 60000,
      verifiedBy: actor.email,
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'paid_exception.payment_verified',
      entityTable: 'ordPaymentVerifications',
      entityId: verificationId,
    });
    return verificationId;
  },
});

export const detail = query({
  args: { id: v.id('ordPaidExceptions') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const exception = await ctx.db.get(a.id);
    if (!exception) throw new CommerceError('INVALID_INPUT');
    const proof = await ctx.db
      .query('ordPaymentVerifications')
      .withIndex('by_exception', (q) => q.eq('exceptionId', a.id))
      .order('desc')
      .first();
    return { exception, proof, canApprove: actor.approver };
  },
});

/** Records a verified completed refund; does not issue a refund or contact the customer. */
export const closeRefunded = mutation({
  args: {
    id: v.id('ordPaidExceptions'),
    verificationId: v.id('ordPaymentVerifications'),
    customerAgreement: v.string(),
    supplierCancellationEvidence: v.string(),
    noOutstandingFulfillment: v.boolean(),
    requestKey: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (
      !a.noOutstandingFulfillment ||
      !/^[\w-]{16,80}$/.test(a.requestKey) ||
      [a.customerAgreement, a.supplierCancellationEvidence].some(
        (s) => s.trim().length < 5 || s.length > 1000
      )
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Record customer agreement and supplier cancellation or confirmed no-handoff evidence'
      );
    const key = `exception-refund:${await digest(actor.email)}:${a.requestKey}`,
      hash = await digest(a);
    const prior = await ctx.db
      .query('sysIdempotencyKeys')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first();
    if (prior) {
      if (prior.scope !== hash || prior.resultRef !== a.id)
        throw new CommerceError('INVALID_INPUT', 'Changed reconciliation retry');
      return a.id;
    }
    const ex = await ctx.db.get(a.id),
      proof = await ctx.db.get(a.verificationId);
    const intent = ex?.intentId ? await ctx.db.get(ex.intentId) : null;
    const latest = await ctx.db
      .query('ordPaymentVerifications')
      .withIndex('by_exception', (q) => q.eq('exceptionId', a.id))
      .order('desc')
      .first();
    if (
      !ex ||
      ex.status !== 'open' ||
      !intent ||
      intent.status !== 'exception' ||
      !proof ||
      latest?._id !== proof._id ||
      proof.exceptionId !== ex._id ||
      proof.intentId !== intent._id ||
      proof.sessionId !== ex.stripeSessionId ||
      proof.paymentIntentId !== ex.paymentIntentId ||
      (proof.paymentStateVersion ?? 0) !== (ex.paymentStateVersion ?? 0) ||
      proof.validUntil <= Date.now() ||
      proof.verifiedAt > Date.now()
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Refresh payment verification before recording this resolution'
      );
    if (
      !acceptsPlatformPayment(proof.livemode) ||
      !proof.captured ||
      proof.disputed ||
      proof.currency !== 'usd' ||
      proof.amountMinor <= 0 ||
      proof.succeededRefundMinor !== proof.amountMinor ||
      proof.pendingRefundMinor !== 0
    )
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'A full successful refund is required; pending, partial and disputed payments remain open'
      );
    const order = await ctx.db
      .query('ordOrders')
      .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
      .first();
    const paymentOrder = await ctx.db
      .query('ordOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', proof.paymentIntentId))
      .first();
    if (order || paymentOrder)
      throw new CommerceError(
        'INVALID_INPUT',
        'This payment has an order; use its return and fulfillment reconciliation'
      );
    if (intent.creditReservationRef)
      await settleCredit(ctx, intent.creditReservationRef, 'released');
    for (const row of await ctx.db
      .query('ordInventoryReservations')
      .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
      .collect()) {
      if (row.status === 'held' || row.status === 'consumed')
        await ctx.db.patch(row._id, { status: 'released' });
    }
    await ctx.db.patch(intent._id, { status: 'refunded' });
    await ctx.db.patch(ex._id, {
      status: 'resolved',
      resolutionKind: 'verified_refund',
      resolution: a.customerAgreement.trim(),
      paymentVerificationId: proof._id,
      resolvedBy: actor.email,
      resolvedAt: Date.now(),
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'paid_exception.verified_refund_recorded',
      entityTable: 'ordPaidExceptions',
      entityId: ex._id,
      before: ex,
      after: {
        verificationId: proof._id,
        supplierCancellationEvidence: a.supplierCancellationEvidence.trim(),
        intentStatus: 'refunded',
      },
      reason: a.customerAgreement.trim(),
      requestId: key,
    });
    await ctx.db.insert('sysIdempotencyKeys', {
      key,
      scope: hash,
      resultRef: ex._id,
      createdAt: Date.now(),
    });
    return ex._id;
  },
});

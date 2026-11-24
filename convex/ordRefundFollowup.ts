import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { audit, openReview } from './sysCore';
import { CommerceError } from '../lib/errors';

export const refundEventTypes = new Set([
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
]);

/** Signed event evidence is a review signal, never permission to issue another refund or order. */
export async function handleRefundUpdate(ctx: MutationCtx, ev: Doc<'sysPaymentEvents'>) {
  const p = ev.payload as Record<string, unknown>;
  if (
    !p ||
    typeof p.id !== 'string' ||
    typeof p.paymentIntentId !== 'string' ||
    typeof p.chargeId !== 'string' ||
    typeof p.status !== 'string' ||
    !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(p.status) ||
    !Number.isSafeInteger(p.created) ||
    typeof p.created !== 'number' ||
    p.created <= 0
  )
    throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Invalid refund event evidence');
  const failure = p.status === 'failed' || p.status === 'canceled';
  const exceptions = await ctx.db
    .query('ordPaidExceptions')
    .withIndex('by_payment', (q) => q.eq('paymentIntentId', p.paymentIntentId as string))
    .take(101);
  if (exceptions.length > 100)
    throw new CommerceError(
      'PAYMENT_RECONCILIATION_REQUIRED',
      'Payment exception references need investigation'
    );
  for (const ex of exceptions) {
    const version = (ex.paymentStateVersion ?? 0) + 1;
    await ctx.db.patch(ex._id, { paymentStateVersion: version });
    if (!failure) continue;
    const proof = ex.paymentVerificationId ? await ctx.db.get(ex.paymentVerificationId) : null;
    // A failed refund already excluded by a later provider read must not undo that newer resolution.
    // Legacy proofs have no successful-ID set. Provider event times have whole-second precision;
    // a same-second failure is ambiguous and must reopen review, not be dismissed by milliseconds.
    const previouslySuccessful = proof?.succeededRefundIds
      ? proof.succeededRefundIds.includes(p.id)
      : !!proof?.refundIds.includes(p.id) && p.created >= Math.floor(proof.verifiedAt / 1000);
    if (
      ex.status !== 'resolved' ||
      ex.resolutionKind !== 'verified_refund' ||
      !proof ||
      proof.chargeId !== p.chargeId ||
      !previouslySuccessful
    )
      continue;
    const intent = ex.intentId ? await ctx.db.get(ex.intentId) : null;
    const order = await ctx.db
      .query('ordOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', p.paymentIntentId as string))
      .first();
    const followup = {
      eventId: ev.eventId,
      refundId: p.id,
      status: p.status,
      receivedAt: ev.receivedAt,
    };
    await ctx.db.patch(ex._id, { status: 'open', refundFollowup: followup });
    // Retain the previous resolution and proof as history. Do not recreate cancelled fulfillment or credit holds.
    if (intent?.status === 'refunded' && !order)
      await ctx.db.patch(intent._id, { status: 'exception' });
    await openReview(
      ctx,
      'refund_failure_followup',
      'ordPaidExceptions',
      ex._id,
      'A refund supporting the recorded resolution failed or was canceled. Verify the current payment in Stripe and arrange a reviewed resolution; do not automatically charge, refund or fulfill again.'
    );
    await audit(ctx, {
      actor: 'stripe:webhook',
      action: 'paid_exception.refund_reopened',
      entityTable: 'ordPaidExceptions',
      entityId: ex._id,
      before: ex,
      after: { status: 'open', paymentStateVersion: version, refundFollowup: followup },
      requestId: ev.eventId,
    });
  }
  if (failure) {
    const order = await ctx.db
      .query('ordOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', p.paymentIntentId as string))
      .first();
    if (order)
      await openReview(
        ctx,
        'refund_failure_followup',
        'ordOrders',
        order._id,
        'A provider refund failed or was canceled. Reconcile the actual refund, credit, tax and commission records before any corrective action; this event does not reverse ledger history automatically.'
      );
  }
  return 'processed' as const;
}

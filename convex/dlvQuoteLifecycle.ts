import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { audit } from './sysCore';
import { CommerceError } from '../lib/errors';

export const closedRequestStates = ['cancelled', 'declined', 'converted'] as const;
export function requestState(
  r: Doc<'dlvQuoteRequests'>,
  q: Doc<'ordQuoteVersions'> | null,
  now = Date.now()
) {
  if (r.orderId) return 'converted' as const;
  if ((closedRequestStates as readonly string[]).includes(r.status)) return r.status;
  if (q?.status === 'superseded') return 'superseded' as const;
  if (q && q.expiresAt <= now) return 'expired' as const;
  return r.status;
}

/** New versions cannot invalidate a customer's active payment or paid order. */
export async function assertRequestRevisable(ctx: MutationCtx, projectId: Id<'commerceProjects'>) {
  const r = await ctx.db
    .query('dlvQuoteRequests')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .unique();
  if (!r) return null; // Existing non-delivery project quote workflow.
  if (r.orderId || (closedRequestStates as readonly string[]).includes(r.status))
    throw new CommerceError('INVALID_INPUT', 'Closed delivery requests cannot be revised');
  const q = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
  const intent = q?.checkoutIntentId ? await ctx.db.get(q.checkoutIntentId) : null;
  if (intent && !['failed', 'expired'].includes(intent.status))
    throw new CommerceError(
      'PAYMENT_RECONCILIATION_REQUIRED',
      'Resolve the existing payment before revising this request'
    );
  if (q?.status === 'accepted' && q.expiresAt > Date.now())
    throw new CommerceError('INVALID_INPUT', 'An accepted current quote stays frozen');
  return r;
}

/** Only the verified payment path calls this. Expiry never erases a valid frozen payment. */
export async function convertPaidQuote(
  ctx: MutationCtx,
  estimateId: Id<'dlvEstimates'>,
  orderId: Id<'ordOrders'>
) {
  const estimate = await ctx.db.get(estimateId);
  if (!estimate?.manualQuoteVersionId) return;
  const r = await ctx.db
    .query('dlvQuoteRequests')
    .withIndex('by_quote', (q) => q.eq('quoteVersionId', estimate.manualQuoteVersionId))
    .unique();
  if (!r) return;
  if (r.orderId) {
    if (r.orderId !== orderId) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED');
    return;
  }
  await ctx.db.patch(r._id, { status: 'converted', orderId, updatedAt: Date.now() });
  await audit(ctx, {
    actor: 'verified-payment',
    action: 'delivery.quote.converted',
    entityTable: 'dlvQuoteRequests',
    entityId: r._id,
    after: { orderId, quoteVersionId: r.quoteVersionId },
  });
}

/** Bounded expiry maintenance. Accepted quote terms stay immutable, including during payment. */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let count = 0;
    for (const status of ['ready_for_review', 'sent', 'accepted'] as const) {
      const rows = await ctx.db
        .query('dlvQuoteRequests')
        .withIndex('by_status_expiry', (q) =>
          q.eq('status', status).gt('quoteExpiresAt', 0).lte('quoteExpiresAt', now)
        )
        .take(50);
      for (const r of rows) {
        const q = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
        if (!q || q.expiresAt > now || r.orderId) continue;
        await ctx.db.patch(r._id, { status: 'expired', updatedAt: now });
        if (q.status === 'draft' || q.status === 'sent')
          await ctx.db.patch(q._id, { status: 'expired' });
        await audit(ctx, {
          actor: 'system',
          action: 'delivery.quote.expired',
          entityTable: 'dlvQuoteRequests',
          entityId: r._id,
          after: { quoteVersionId: q._id },
        });
        count++;
      }
    }
    return count;
  },
});

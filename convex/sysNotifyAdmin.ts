import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { audit } from './sysCore';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';

export const reviewQueue = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.union(
      v.literal('queued'),
      v.literal('sending'),
      v.literal('failed'),
      v.literal('sent'),
      v.literal('suppressed')
    ),
  },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      throw new CommerceError('INVALID_INPUT');
    const rows = await ctx.db
      .query('sysNotifications')
      .withIndex('by_status_next', (q) => q.eq('status', a.status))
      .paginate(a.paginationOpts);
    return {
      ...rows,
      page: rows.page.map((n) => ({
        id: n._id,
        template: n.template,
        recipient: n.to,
        status: n.status,
        attempts: n.attempts,
        acceptedAt: n.sentAt ?? null,
        providerId: n.providerId ?? null,
        error: n.lastError ?? null,
        reviewRequired: n.reviewRequired === true || (n.status === 'sent' && !n.providerId),
        legacy: n.deliveryVersion !== 2,
        createdAt: n.createdAt,
      })),
    };
  },
});
export const resolve = mutation({
  args: {
    id: v.id('sysNotifications'),
    decision: v.union(
      v.literal('confirm_accepted'),
      v.literal('cancel'),
      v.literal('retry_not_sent')
    ),
    evidence: v.string(),
    providerId: v.optional(v.string()),
    confirmedNotSent: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    const n = await ctx.db.get(a.id);
    if (!n || !a.evidence.trim() || a.evidence.length > 2000)
      throw new CommerceError('INVALID_INPUT');
    if (n.status === 'sending' && (n.leaseUntil ?? Infinity) > Date.now())
      throw new CommerceError('INVALID_INPUT', 'Wait for the active worker to settle');
    if (a.decision === 'confirm_accepted') {
      if (!a.providerId || !/^[a-zA-Z0-9_-]{1,200}$/.test(a.providerId))
        throw new CommerceError('INVALID_INPUT', 'Provider receipt reference required');
      if (n.providerId && n.providerId !== a.providerId)
        throw new CommerceError('INVALID_INPUT', 'Accepted provider reference is immutable');
      await ctx.db.patch(n._id, {
        status: 'sent',
        providerId: a.providerId,
        sentAt: n.sentAt ?? Date.now(),
        reviewRequired: false,
        leaseUntil: undefined,
      });
    } else if (a.decision === 'cancel') {
      if (n.providerId)
        throw new CommerceError('INVALID_INPUT', 'An accepted email cannot be unsent');
      await ctx.db.patch(n._id, {
        status: 'suppressed',
        reviewRequired: false,
        leaseUntil: undefined,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      });
    } else {
      if (n.category !== 'transactional')
        throw new CommerceError(
          'INVALID_INPUT',
          'Marketing messages use their separate consent workflow'
        );
      if (!a.confirmedNotSent || n.providerId)
        throw new CommerceError(
          'INVALID_INPUT',
          'Verify the provider did not accept the message before retry'
        );
      await ctx.db.patch(n._id, {
        deliveryVersion: 2,
        generation: (n.generation ?? 0) + 1,
        status: 'queued',
        attempts: 0,
        firstAttemptAt: undefined,
        envelope: undefined,
        reviewRequired: false,
        leaseUntil: undefined,
        lastError: undefined,
        sentAt: undefined,
        nextAttemptAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.sysNotify.deliver, { id: n._id });
    }
    for (const review of await ctx.db
      .query('sysReviewItems')
      .withIndex('by_entity', (q) => q.eq('entityTable', 'sysNotifications').eq('entityId', n._id))
      .collect())
      if (review.kind === 'notification_delivery' && review.status === 'open')
        await ctx.db.patch(review._id, {
          status: 'resolved',
          resolvedAt: Date.now(),
          resolvedBy: actor.email,
          resolution: a.evidence,
        });
    await audit(ctx, {
      actor: actor.email,
      action: `notification.${a.decision}`,
      entityTable: 'sysNotifications',
      entityId: n._id,
      reason: a.evidence,
      before: { status: n.status, attempts: n.attempts },
      after: { decision: a.decision, providerId: a.providerId ?? null },
    });
  },
});

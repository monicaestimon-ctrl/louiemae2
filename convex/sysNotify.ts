// Durable transactional outbox. Provider acceptance is not proof of inbox delivery.
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { openReview } from './sysCore';

export type NotifyInput = {
  dedupeKey: string;
  audience: 'customer' | 'partner' | 'admin';
  template: string;
  to: string;
  subject: string;
  text: string;
  payload?: unknown;
};
const MAX_ATTEMPTS = 5,
  LEASE_MS = 120000,
  SAFE_RETRY_MS = 23 * 3600000;
export async function notify(ctx: MutationCtx, n: NotifyInput) {
  const old = await ctx.db
    .query('sysNotifications')
    .withIndex('by_dedupe', (q) => q.eq('dedupeKey', n.dedupeKey))
    .first();
  if (old) return old._id;
  const now = Date.now();
  const id = await ctx.db.insert('sysNotifications', {
    ...n,
    deliveryVersion: 2,
    generation: 0,
    category: 'transactional',
    status: 'queued',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.sysNotify.deliver, { id });
  return id;
}
export async function holdNotification(
  ctx: MutationCtx,
  n: Doc<'sysNotifications'>,
  reason: string
) {
  await ctx.db.patch(n._id, {
    status: 'failed',
    reviewRequired: true,
    lastError: reason,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
    leaseUntil: undefined,
  });
  await openReview(ctx, 'notification_delivery', 'sysNotifications', n._id, reason);
}
export const claim = internalMutation({
  args: { id: v.id('sysNotifications') },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.id),
      now = Date.now();
    if (!n || !['queued', 'failed'].includes(n.status) || n.reviewRequired || n.nextAttemptAt > now)
      return null;
    if (n.category !== 'transactional') {
      await holdNotification(ctx, n, 'Marketing messages require their separate consent workflow');
      return null;
    }
    if (n.deliveryVersion !== 2) {
      await holdNotification(
        ctx,
        n,
        'Legacy send outcome requires provider reconciliation before retry'
      );
      return null;
    }
    if (
      n.attempts >= MAX_ATTEMPTS ||
      (n.firstAttemptAt !== undefined && now - n.firstAttemptAt >= SAFE_RETRY_MS)
    ) {
      await holdNotification(ctx, n, 'Retry limit or safe provider idempotency window reached');
      return null;
    }
    const to = n.to === 'owner' ? process.env.FURNITURE_QUOTE_EMAIL : n.to;
    const envelope = n.envelope ?? {
      from: process.env.FURNITURE_EMAIL_FROM || 'Louie Mae <withlove@louiemae.com>',
      to: to ?? '',
      subject: n.subject,
      text: `${n.text}\n\nLouie Mae · louiemae.com`,
      ...(process.env.FURNITURE_QUOTE_EMAIL ? { replyTo: process.env.FURNITURE_QUOTE_EMAIL } : {}),
    };
    if (!envelope.to || !process.env.RESEND_API_KEY) {
      await holdNotification(ctx, n, 'Notification recipient or provider configuration is missing');
      return null;
    }
    const attempts = n.attempts + 1;
    await ctx.db.patch(n._id, {
      status: 'sending',
      attempts,
      leaseUntil: now + LEASE_MS,
      firstAttemptAt: n.firstAttemptAt ?? now,
      envelope,
    });
    return { ...n, attempts, envelope };
  },
});
export const result = internalMutation({
  args: {
    id: v.id('sysNotifications'),
    attempt: v.optional(v.number()),
    generation: v.optional(v.number()),
    ok: v.boolean(),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.id);
    if (!n || n.status !== 'sending' || a.attempt !== n.attempts || a.generation !== n.generation)
      return false;
    if (a.ok && a.providerId && /^[a-zA-Z0-9_-]{1,200}$/.test(a.providerId)) {
      await ctx.db.patch(n._id, {
        status: 'sent',
        providerId: a.providerId,
        sentAt: Date.now(),
        leaseUntil: undefined,
        lastError: undefined,
        reviewRequired: false,
      });
      return true;
    }
    const reason = (a.error ?? 'Provider acceptance receipt is missing').slice(0, 300);
    const next = Date.now() + 60000 * 2 ** (n.attempts - 1) + Math.floor(Math.random() * 15000);
    if (
      !a.retryable ||
      n.attempts >= MAX_ATTEMPTS ||
      next - (n.firstAttemptAt ?? n.createdAt) >= SAFE_RETRY_MS
    ) {
      await holdNotification(ctx, n, reason);
      return true;
    }
    await ctx.db.patch(n._id, {
      status: 'failed',
      lastError: reason,
      leaseUntil: undefined,
      nextAttemptAt: next,
    });
    await ctx.scheduler.runAt(next, internal.sysNotify.deliver, { id: n._id });
    return true;
  },
});
export const deliver = internalAction({
  args: { id: v.id('sysNotifications') },
  handler: async (ctx, a): Promise<void> => {
    const n = await ctx.runMutation(internal.sysNotify.claim, a);
    if (!n) return;
    try {
      const receipt = await ctx.runAction(internal.sysNotifySender.send, {
        key: `notify-v2:${n._id}:${n.generation ?? 0}`,
        envelope: n.envelope,
      });
      await ctx.runMutation(internal.sysNotify.result, {
        id: a.id,
        attempt: n.attempts,
        generation: n.generation ?? 0,
        ...receipt,
      });
    } catch {
      await ctx.runMutation(internal.sysNotify.result, {
        id: a.id,
        attempt: n.attempts,
        generation: n.generation ?? 0,
        ok: false,
        retryable: true,
        error: 'Notification worker interrupted; reconcile within the safe retry window',
      });
    }
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    let scheduled = 0;
    for (const status of ['queued', 'failed'] as const) {
      const rows = await ctx.db
        .query('sysNotifications')
        .withIndex('by_status_next', (q) => q.eq('status', status).lte('nextAttemptAt', Date.now()))
        .take(25);
      for (const n of rows)
        if (!n.reviewRequired) {
          await ctx.scheduler.runAfter(0, internal.sysNotify.deliver, { id: n._id });
          scheduled++;
        }
    }
    const stale = await ctx.db
      .query('sysNotifications')
      .withIndex('by_status_lease', (q) => q.eq('status', 'sending').lt('leaseUntil', Date.now()))
      .take(25);
    for (const n of stale) {
      if (
        n.deliveryVersion !== 2 ||
        n.attempts >= MAX_ATTEMPTS ||
        Date.now() - (n.firstAttemptAt ?? n.createdAt) >= SAFE_RETRY_MS
      )
        await holdNotification(ctx, n, 'Abandoned notification requires provider reconciliation');
      else {
        await ctx.db.patch(n._id, {
          status: 'failed',
          leaseUntil: undefined,
          nextAttemptAt: Date.now(),
          lastError: 'Recovered abandoned send claim',
        });
        await ctx.scheduler.runAfter(0, internal.sysNotify.deliver, { id: n._id });
        scheduled++;
      }
    }
    return scheduled;
  },
});
export const backlog = internalQuery({
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db
      .query('sysNotifications')
      .withIndex('by_status_next', (q) => q.eq('status', 'queued'))
      .take(500);
    const failed = await ctx.db
      .query('sysNotifications')
      .withIndex('by_status_next', (q) => q.eq('status', 'failed'))
      .take(500);
    return {
      queued: queued.length,
      failed: failed.length,
      oldestQueuedAt: queued[0]?.createdAt ?? null,
    };
  },
});

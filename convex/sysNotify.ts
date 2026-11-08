// Durable notifications (spec S36, v2 §20). Each message is stored first with a dedupe key, then
// a worker sends it with retries and provider idempotency. Transactional messages ignore
// marketing opt-outs; marketing messages are never queued here without consent.
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';

export type NotifyInput = {
  dedupeKey: string;
  audience: 'customer' | 'partner' | 'admin';
  template: string;
  to: string;
  subject: string;
  text: string;
  payload?: unknown;
};

/** Queues a transactional message once per dedupe key and wakes the worker. */
export async function notify(ctx: MutationCtx, n: NotifyInput) {
  const existing = await ctx.db.query('sysNotifications').withIndex('by_dedupe', (q) => q.eq('dedupeKey', n.dedupeKey)).first();
  if (existing) return existing._id;
  const now = Date.now();
  const id = await ctx.db.insert('sysNotifications', { ...n, category: 'transactional', status: 'queued', attempts: 0, nextAttemptAt: now, createdAt: now });
  await ctx.scheduler.runAfter(0, internal.sysNotify.deliver, { id });
  return id;
}

export const claim = internalMutation({
  args: { id: v.id('sysNotifications') },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.id);
    if (!n || (n.status !== 'queued' && n.status !== 'failed') || n.nextAttemptAt > Date.now()) return null;
    await ctx.db.patch(n._id, { status: 'sending', attempts: n.attempts + 1 });
    return n;
  },
});

export const result = internalMutation({
  args: { id: v.id('sysNotifications'), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.id);
    if (!n) return;
    if (a.ok) return ctx.db.patch(n._id, { status: 'sent', sentAt: Date.now() });
    const retry = n.attempts < 5;
    const next = Date.now() + 60_000 * 2 ** n.attempts;
    await ctx.db.patch(n._id, { status: retry ? 'failed' : 'failed', lastError: (a.error ?? 'send failed').slice(0, 300), nextAttemptAt: retry ? next : Number.MAX_SAFE_INTEGER });
    if (retry) await ctx.scheduler.runAt(next, internal.sysNotify.deliver, { id: n._id });
  },
});

/** Sends one queued message through the existing email sender (Resend, idempotent by key). */
export const deliver = internalAction({
  args: { id: v.id('sysNotifications') },
  handler: async (ctx, a) => {
    const n = await ctx.runMutation(internal.sysNotify.claim, { id: a.id });
    if (!n) return;
    try {
      await ctx.runAction(internal.holmEmail.send, { key: `notify:${n.dedupeKey}`, to: n.to, subject: n.subject, text: n.text });
      await ctx.runMutation(internal.sysNotify.result, { id: a.id, ok: true });
    } catch (e) {
      await ctx.runMutation(internal.sysNotify.result, { id: a.id, ok: false, error: String((e as Error).message) });
    }
  },
});

export const backlog = internalQuery({
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db.query('sysNotifications').withIndex('by_status_next', (q) => q.eq('status', 'queued')).take(500);
    const failed = await ctx.db.query('sysNotifications').withIndex('by_status_next', (q) => q.eq('status', 'failed')).take(500);
    return { queued: queued.length, failed: failed.length, oldestQueuedAt: queued[0]?.createdAt ?? null };
  },
});

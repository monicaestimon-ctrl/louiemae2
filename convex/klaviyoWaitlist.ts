import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';

export const dispatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.KLAVIYO_WAITLIST_ENABLED !== 'true' || !process.env.KLAVIYO_PRIVATE_API_KEY || !process.env.KLAVIYO_WAITLIST_LIST_ID) return;
    const jobs = await ctx.db.query('klaviyoWaitlistJobs').withIndex('by_due', q => q.gt('nextAttemptAt', 0).lte('nextAttemptAt', Date.now())).take(20);
    for (const job of jobs) {
      const attempt = job.attempts + 1;
      await ctx.db.patch(job._id, { attempts: attempt, nextAttemptAt: Date.now() + 10 * 60000 });
      await ctx.scheduler.runAfter(0, internal.klaviyoWaitlistWorker.sync, { id: job._id, attempt });
    }
  },
});

export const readJob = internalQuery({
  args: { id: v.id('klaviyoWaitlistJobs'), attempt: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.attempts !== args.attempt || job.nextAttemptAt === undefined) return null;
    const signup = await ctx.db.get(job.signupId);
    if (!signup) return null;
    const subscriber = await ctx.db.query('subscribers').withIndex('by_email', q => q.eq('email', signup.email)).first();
    return { job, signup, unsubscribed: signup.status === 'unsubscribed' || subscriber?.status === 'unsubscribed' };
  },
});

export const finish = internalMutation({
  args: { id: v.id('klaviyoWaitlistJobs'), attempt: v.number(),
    outcome: v.union(v.literal('accepted'), v.literal('suppressed'), v.literal('retry'), v.literal('failed')),
    unsubscribe: v.boolean(), errorCode: v.optional(v.number()), delayMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.attempts !== args.attempt) return;
    const signup = await ctx.db.get(job.signupId);
    if (!signup) { await ctx.db.delete(job._id); return; }
    const subscriber = await ctx.db.query('subscribers').withIndex('by_email', q => q.eq('email', signup.email)).first();
    const unsubscribed = signup.status === 'unsubscribed' || subscriber?.status === 'unsubscribed';
    // An unsubscribe arriving while the HTTP request was in flight always wins.
    const needsUnsubscribe = unsubscribed && !args.unsubscribe && args.outcome !== 'suppressed';
    if (args.outcome === 'suppressed') {
      await ctx.db.patch(signup._id, { status: 'unsubscribed' });
      if (subscriber) await ctx.db.patch(subscriber._id, { status: 'unsubscribed' });
    }
    const retry = args.outcome === 'retry' || needsUnsubscribe;
    await ctx.db.patch(job._id, {
      state: retry ? 'pending' : args.outcome === 'retry' ? 'pending' : args.outcome,
      nextAttemptAt: retry ? Date.now() + Math.max(60000, args.delayMs ?? 60000) : undefined,
      errorCode: args.errorCode, updatedAt: Date.now(),
    });
  },
});

// Explicit operator action, paginated. Historical consent does not trigger welcome
// flows or double-opt-in emails. Never run an automatic import on deployment.
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('waitlistSignups').paginate({ cursor, numItems: 100 });
    let queued = 0;
    for (const signup of page.page) {
      if (signup.status !== 'active') continue;
      const exists = await ctx.db.query('klaviyoWaitlistJobs').withIndex('by_signup', q => q.eq('signupId', signup._id)).unique();
      if (exists) continue;
      await ctx.db.insert('klaviyoWaitlistJobs', { signupId: signup._id, historical: true,
        state: 'pending', attempts: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() });
      queued++;
    }
    return { queued, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const jobs = await ctx.db.query('klaviyoWaitlistJobs').order('desc').take(100);
    return { enabled: process.env.KLAVIYO_WAITLIST_ENABLED === 'true',
      configured: Boolean(process.env.KLAVIYO_PRIVATE_API_KEY && process.env.KLAVIYO_WAITLIST_LIST_ID),
      recentJobs: jobs.map(({ state, attempts, errorCode, updatedAt }) => ({ state, attempts, errorCode, updatedAt })) };
  },
});

export const retryFailed = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('klaviyoWaitlistJobs').paginate({ cursor, numItems: 100 });
    let queued = 0;
    for (const job of page.page) if (job.state === 'failed') {
      await ctx.db.patch(job._id, { state: 'pending', nextAttemptAt: Date.now(), updatedAt: Date.now() });
      queued++;
    }
    return { queued, cursor: page.continueCursor, isDone: page.isDone };
  },
});

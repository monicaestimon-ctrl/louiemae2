import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query, internalMutation } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { normalizeWaitlistEmail, WAITLIST_CONSENT_VERSION } from '../lib/waitlistValidation';
import { internal } from './_generated/api';

export const register = mutation({
  args: { secret: v.string(), email: v.string(), rateKey: v.string(), consent: v.boolean() },
  handler: async (ctx, args) => {
    if (!process.env.WAITLIST_INTAKE_SECRET || args.secret !== process.env.WAITLIST_INTAKE_SECRET) throw new Error('Unauthorized');
    const email = normalizeWaitlistEmail(args.email);
    if (!email || !args.consent || !/^[a-f0-9]{64}$/.test(args.rateKey)) throw new Error('Invalid signup');
    const now = Date.now();
    const limit = await ctx.db.query('waitlistRateLimits').withIndex('by_key', q => q.eq('key', args.rateKey)).unique();
    if (limit && limit.expiresAt > now && limit.count >= 10) return { ok: false };
    if (limit) await ctx.db.patch(limit._id, { count: limit.expiresAt > now ? limit.count + 1 : 1, expiresAt: limit.expiresAt > now ? limit.expiresAt : now + 3600000 });
    else {
      const id = await ctx.db.insert('waitlistRateLimits', { key: args.rateKey, count: 1, expiresAt: now + 3600000 });
      await ctx.scheduler.runAfter(3601000, internal.waitlist.expireRateLimit, {id});
    }
    // Bounded cleanup prevents retention of expired network hashes, even without traffic-driven cron setup.
    const expired = await ctx.db.query('waitlistRateLimits').withIndex('by_expiry', q => q.lt('expiresAt', now)).take(30);
    for (const row of expired) if (row._id !== limit?._id) await ctx.db.delete(row._id);
    const existing = await ctx.db.query('waitlistSignups').withIndex('by_email', q => q.eq('email', email)).unique();
    // Repeat submissions remain idempotent and do not reveal list membership or undo opt-outs.
    const subscriber = await ctx.db.query('subscribers').withIndex('by_email', q => q.eq('email', email)).first();
    if (!existing) await ctx.db.insert('waitlistSignups', { email, createdAt: now, consentVersion: WAITLIST_CONSENT_VERSION, source: 'prelaunch', status: subscriber?.status ?? 'active' });
    if (!subscriber && !existing) await ctx.db.insert('subscribers', { email, dateSubscribed: new Date(now).toISOString().slice(0,10), status:'active', tags:['prelaunch-waitlist'], openRate:0 });
    else if (subscriber && !subscriber.tags.includes('prelaunch-waitlist')) await ctx.db.patch(subscriber._id, { tags:[...subscriber.tags,'prelaunch-waitlist'] });
    return { ok: true };
  },
});

export const expireRateLimit = internalMutation({
  args: {id: v.id('waitlistRateLimits')},
  handler: async (ctx, {id}) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.expiresAt <= Date.now()) await ctx.db.delete(id);
    else await ctx.scheduler.runAfter(row.expiresAt - Date.now() + 1000, internal.waitlist.expireRateLimit, {id});
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('waitlistSignups').order('desc').paginate(args.paginationOpts);
  },
});

export const unsubscribe = mutation({
  args: { id: v.id('waitlistSignups') },
  handler: async (ctx, {id}) => {
    await requireCjAdminIdentity(ctx);
    const signup = await ctx.db.get(id);
    if (!signup) return;
    await ctx.db.patch(id, { status: 'unsubscribed' });
    const subscriber = await ctx.db.query('subscribers').withIndex('by_email', q => q.eq('email', signup.email)).first();
    if (subscriber) await ctx.db.patch(subscriber._id, {status:'unsubscribed'});
  },
});

// Internal-only cleanup for the exact QA addresses created during deployment checks.
export const removeTestSignup = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, {email}) => {
    if (!/^louie-mae-qa-[a-z0-9-]+@example\.com$/.test(email)) throw new Error('Only reserved QA addresses can be removed');
    for (const table of ['waitlistSignups', 'subscribers'] as const) {
      const rows = await ctx.db.query(table).withIndex('by_email', q => q.eq('email', email)).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
  },
});

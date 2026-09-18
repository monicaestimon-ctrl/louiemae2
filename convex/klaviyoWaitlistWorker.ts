"use node";

// The provider client uses AbortSignal.timeout for bounded network requests.
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { KlaviyoError, syncKlaviyoWaitlist, getKlaviyoSuppressedEmails } from '../lib/klaviyo';

export const sync = internalAction({
  args: { id: v.id('klaviyoWaitlistJobs'), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;
    const listId = process.env.KLAVIYO_WAITLIST_LIST_ID;
    if (!apiKey || !listId) return;
    const data = await ctx.runQuery(internal.klaviyoWaitlist.readJob, args);
    if (!data) return;
    if (process.env.KLAVIYO_WAITLIST_ENABLED !== 'true' && data.signup.email !== process.env.KLAVIYO_WAITLIST_TEST_EMAIL?.trim().toLowerCase()) return;
    try {
      const outcome = await syncKlaviyoWaitlist({ apiKey, listId,
        email: data.signup.email, unsubscribe: data.unsubscribed,
        historical: data.job.historical, consentedAt: data.signup.createdAt });
      await ctx.runMutation(internal.klaviyoWaitlist.finish, { ...args, outcome, unsubscribe: data.unsubscribed });
    } catch (error) {
      const code = error instanceof KlaviyoError ? error.status : 0;
      const retryable = code === 0 || code === 429 || code >= 500;
      await ctx.runMutation(internal.klaviyoWaitlist.finish, { ...args,
        outcome: retryable ? 'retry' : 'failed', unsubscribe: data.unsubscribed, errorCode: code,
        delayMs: Math.max(error instanceof KlaviyoError ? error.retryAfterMs : 60000,
          Math.min(86400000, 60000 * 2 ** Math.min(args.attempt, 10))) });
    }
  },
});

// Klaviyo stops its own sends immediately. This periodically updates our local
// records too, without needing webhook permissions or ever restoring consent.
export const reconcileConsent = internalAction({
  args: { cursor: v.union(v.string(), v.null()), attempt: v.optional(v.number()) },
  handler: async (ctx, { cursor, attempt = 0 }): Promise<void> => {
    const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;
    if (!apiKey || !process.env.KLAVIYO_WAITLIST_LIST_ID) return;
    const page = await ctx.runQuery(internal.klaviyoWaitlist.consentPage, { cursor });
    try {
      const emails = await getKlaviyoSuppressedEmails(apiKey, page.emails);
      await ctx.runMutation(internal.klaviyoWaitlist.mirrorSuppressions, { emails });
    } catch (error) {
      const code = error instanceof KlaviyoError ? error.status : 0;
      if (attempt < 3 && (code === 0 || code === 429 || code >= 500)) {
        await ctx.scheduler.runAfter(60000 * 2 ** attempt, internal.klaviyoWaitlistWorker.reconcileConsent, { cursor, attempt: attempt + 1 });
      }
      // Keep logs free of contacts/provider response bodies. A later cron retries.
      console.warn('Klaviyo consent reconciliation incomplete', { status: code });
      return;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(1000, internal.klaviyoWaitlistWorker.reconcileConsent, { cursor: page.cursor });
  },
});

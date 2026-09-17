import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { KlaviyoError, syncKlaviyoWaitlist } from '../lib/klaviyo';

export const sync = internalAction({
  args: { id: v.id('klaviyoWaitlistJobs'), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;
    const listId = process.env.KLAVIYO_WAITLIST_LIST_ID;
    if (process.env.KLAVIYO_WAITLIST_ENABLED !== 'true' || !apiKey || !listId) return;
    const data = await ctx.runQuery(internal.klaviyoWaitlist.readJob, args);
    if (!data) return;
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

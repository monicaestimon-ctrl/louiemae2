'use node';
import { Resend } from 'resend';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

/** House of Louie Mae notifications. `to: 'owner'` sends to the team inbox. */
export const send = internalAction({
  args: {
    key: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    replyTo: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const owner = process.env.FURNITURE_QUOTE_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    const to = a.to === 'owner' ? owner : a.to;
    if (!apiKey || !to) {
      console.warn(`House email not sent (${a.key}): email is not configured.`);
      return;
    }
    const attempt = a.attempt ?? 0;
    try {
      const result = await new Resend(apiKey).emails.send(
        {
          from: process.env.FURNITURE_EMAIL_FROM || 'Louie Mae <withlove@louiemae.com>',
          to,
          ...(a.replyTo || owner ? { replyTo: a.replyTo || owner } : {}),
          subject: a.subject,
          text: `${a.text}\n\nHouse of Louie Mae · louiemae.com/trade`,
        },
        { idempotencyKey: `holm:${a.key}` }
      );
      if (result.error) throw new Error('Email failed');
    } catch {
      if (attempt < 2)
        await ctx.scheduler.runAfter(60000 * (attempt + 1), internal.holmEmail.send, {
          ...a,
          attempt: attempt + 1,
        });
    }
  },
});

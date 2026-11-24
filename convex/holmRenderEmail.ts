'use node';
import { Resend } from 'resend';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

// Until email is configured, check again every hour for two days so no render goes unannounced.
const CONFIG_WAIT = 60 * 60_000;
const CONFIG_CHECKS = 48;

/** Emails the member that their AI render is ready, retrying twice once email is configured. */
export const notify = internalAction({
  args: { id: v.id('holmRenderRequests'), attempt: v.number(), waits: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const retry = async () => {
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: a.attempt < 2 ? 'retrying' : 'failed' });
      if (a.attempt < 2) await ctx.scheduler.runAfter(60000 * (a.attempt + 1), internal.holmRenderEmail.notify, { id: a.id, attempt: a.attempt + 1, waits: a.waits });
    };
    let r;
    try {
      r = await ctx.runQuery(internal.holmRender.record, { id: a.id });
    } catch {
      return retry();
    }
    if (!r || r.emailStatus === 'sent' || !r.email || !r.resultUrl) return;
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: 'configuration_required' });
      const waits = (a.waits ?? 0) + 1;
      if (waits < CONFIG_CHECKS) await ctx.scheduler.runAfter(CONFIG_WAIT, internal.holmRenderEmail.notify, { id: a.id, attempt: a.attempt, waits });
      return;
    }
    const site = (process.env.SITE_URL || 'https://www.louiemae.com').replace(/\/$/, '');
    const text = [
      `Your render of ${r.title} is ready.`,
      '',
      `See it and download it here: ${r.resultUrl}`,
      '',
      `It's also in the Space Planner: ${site}/trade`,
      '',
      'House of Louie Mae',
    ].join('\n');
    try {
      const result = await new Resend(key).emails.send(
        {
          from: process.env.FURNITURE_EMAIL_FROM || 'Louie Mae <withlove@louiemae.com>',
          to: r.email,
          subject: `Your render of ${r.title} is ready`,
          text,
        },
        { idempotencyKey: `render:${r._id}` }
      );
      if (result.error) throw new Error('Email failed');
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: 'sent' });
    } catch {
      await retry();
    }
  },
});

'use node';
import { Resend } from 'resend';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

// Until email is configured, check again every hour for two days so no request is lost.
const CONFIG_WAIT = 60 * 60_000;
const CONFIG_CHECKS = 48;

/** Emails the House team a new render request, retrying twice once email is configured. */
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
    if (!r || r.emailStatus === 'sent') return;
    const to = process.env.FURNITURE_QUOTE_EMAIL,
      key = process.env.RESEND_API_KEY;
    if (!to || !key) {
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: 'configuration_required' });
      const waits = (a.waits ?? 0) + 1;
      if (waits < CONFIG_CHECKS) await ctx.scheduler.runAfter(CONFIG_WAIT, internal.holmRenderEmail.notify, { id: a.id, attempt: a.attempt, waits });
      return;
    }
    const reference = String(r._id).slice(-8).toUpperCase();
    const text = [
      `House of Louie Mae — render request ${reference}`,
      '',
      `Room: ${r.title}`,
      `From: ${r.email || 'a signed-in member'}`,
      r.snapshotUrl ? `Snapshot: ${r.snapshotUrl}` : 'No snapshot attached.',
      '',
      'Brief:',
      r.prompt,
      '',
      r.camera ? `Camera: ${JSON.stringify(r.camera)}` : '',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    try {
      const result = await new Resend(key).emails.send(
        {
          from: process.env.FURNITURE_EMAIL_FROM || 'Louie Mae <withlove@louiemae.com>',
          to,
          ...(r.email ? { replyTo: r.email } : {}),
          subject: `House of Louie Mae — render request ${reference}`,
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

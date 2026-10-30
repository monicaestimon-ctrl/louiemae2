'use node';
import { Resend } from 'resend';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

/** Emails the House team a new render request, retrying twice. */
export const notify = internalAction({
  args: { id: v.id('holmRenderRequests'), attempt: v.number() },
  handler: async (ctx, a) => {
    const r = await ctx.runQuery(internal.holmRender.record, { id: a.id });
    if (!r || r.emailStatus === 'sent') return;
    const to = process.env.FURNITURE_QUOTE_EMAIL,
      key = process.env.RESEND_API_KEY;
    if (!to || !key) {
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: 'configuration_required' });
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
      await ctx.runMutation(internal.holmRender.emailStatus, { id: a.id, status: a.attempt < 2 ? 'retrying' : 'failed' });
      if (a.attempt < 2) await ctx.scheduler.runAfter(60000 * (a.attempt + 1), internal.holmRenderEmail.notify, { id: a.id, attempt: a.attempt + 1 });
    }
  },
});

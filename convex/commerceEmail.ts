'use node';
import { Resend } from 'resend';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
export const deliver = internalAction({
  args: {
    id: v.id('commerceProjects'),
    audience: v.union(v.literal('customer'), v.literal('owner')),
    attempt: v.number(),
  },
  handler: async (ctx, a) => {
    const p = await ctx.runQuery(internal.commerceProjects.record, { id: a.id });
    if (!p || (a.audience === 'customer' ? p.customerEmailStatus : p.ownerEmailStatus) === 'sent')
      return;
    const owner = process.env.FURNITURE_QUOTE_EMAIL,
      key = process.env.RESEND_API_KEY;
    if (!owner || !key) {
      await ctx.runMutation(internal.commerceProjects.emailStatus, {
        id: a.id,
        audience: a.audience,
        status: 'configuration_required',
      });
      return;
    }
    // Provider idempotency expires after 24 hours. An older uncertain send needs manual reconciliation.
    if (p.createdAt < Date.now() - 20 * 3600000) {
      await ctx.runMutation(internal.commerceProjects.emailStatus, {
        id: a.id,
        audience: a.audience,
        status: 'manual_review_required',
      });
      return;
    }
    const brand = p.channel === 'house' ? 'House of Louie Mae' : 'Louie Mae';
    const text = `${brand} — quote request\n\n${a.audience === 'owner' ? 'A new request is ready for review in Project quotes & fulfillment.' : 'Thank you. Your request is saved. We will confirm availability, delivery timing, and your final price before requesting payment.'}\n\n${p.requested.map((l) => `${l.name} / ${l.variantName} × ${l.quantity} — estimated $${(l.unitPrice / 100).toFixed(2)} each`).join('\n')}\n\n${p.name}\n${p.email}\n${p.phone}\n${p.business}\n${p.address.line1}, ${p.address.city}, ${p.address.state} ${p.address.postalCode}, ${p.address.country}\n${p.notes}\n\nEstimates exclude delivery and tax. No payment has been taken.${a.audience === 'owner' ? '\nhttps://louiemae.com/furniture/admin' : '\nReply to this email with any changes.'}`;
    try {
      const result = await new Resend(key).emails.send(
        {
          from: process.env.FURNITURE_EMAIL_FROM || 'Louie Mae <withlove@louiemae.com>',
          to: a.audience === 'owner' ? owner : p.email,
          replyTo: a.audience === 'owner' ? p.email : owner,
          subject: `${brand} — quote request ${String(p._id).slice(-8).toUpperCase()}`,
          text,
        },
        { idempotencyKey: `commerce:${p._id}:${a.audience}` }
      );
      if (result.error) throw new Error('Email failed');
      await ctx.runMutation(internal.commerceProjects.emailStatus, {
        id: a.id,
        audience: a.audience,
        status: 'sent',
      });
    } catch {
      await ctx.runMutation(internal.commerceProjects.emailStatus, {
        id: a.id,
        audience: a.audience,
        status: a.attempt < 2 ? 'retrying' : 'failed',
      });
      if (a.attempt < 2)
        await ctx.scheduler.runAfter(60000 * (a.attempt + 1), internal.commerceEmail.deliver, {
          ...a,
          attempt: a.attempt + 1,
        });
    }
  },
});

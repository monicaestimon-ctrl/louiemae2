'use node';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { Resend } from 'resend';
import { range } from '../lib/furniture';

export const deliver = internalAction({
  args: {
    id: v.id('furnitureQuotes'),
    audience: v.union(v.literal('customer'), v.literal('owner')),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.furniture.emailRecord, { id: args.id });
    if (
      !request ||
      (args.audience === 'customer' ? request.customerEmailStatus : request.ownerEmailStatus) ===
        'sent'
    )
      return;
    const owner = process.env.FURNITURE_QUOTE_EMAIL;
    const key = process.env.RESEND_API_KEY;
    if (!key || !owner) {
      await ctx.runMutation(internal.furniture.emailStatus, {
        id: args.id,
        audience: args.audience,
        status: 'configuration_required',
      });
      return;
    }
    const ref = String(args.id).slice(-8).toUpperCase();
    const text = `House of Louie Mae — quote request ${ref}\n\n${args.audience === 'customer' ? 'Thank you. Your request has been received. We will confirm availability and prepare your final delivered quote. No payment has been taken.' : 'A new furniture quote request is ready for review.'}\n\n${request.items.map((i) => `${i.name} — ${i.variant}\nQuantity: ${i.quantity} · Estimated ${range(i.lower, i.upper)} each`).join('\n\n')}\n\nMerchandise estimate: ${range(request.lower, request.upper)}\nDelivery and applicable tax are not included. Final pricing depends on availability, quantity and delivery requirements.\n\n${request.name}\n${request.business}\n${request.email}\n${request.phone}\n${request.address}\nService: ${request.service}\nNotes: ${request.notes}\n\n${args.audience === 'owner' ? 'Review: https://louiemae.com/furniture/admin' : 'Reply to this email with any changes to your project.'}`;
    try {
      const result = await new Resend(key).emails.send(
        {
          from: process.env.FURNITURE_EMAIL_FROM || 'House of Louie Mae <withlove@louiemae.com>',
          to: args.audience === 'customer' ? request.email : owner,
          replyTo: args.audience === 'customer' ? owner : request.email,
          subject: `Furniture quote request ${ref}`,
          text,
        },
        { idempotencyKey: `furniture-${args.id}-${args.audience}` }
      );
      if (result.error) throw new Error(result.error.message);
      await ctx.runMutation(internal.furniture.emailStatus, {
        id: args.id,
        audience: args.audience,
        status: 'sent',
      });
    } catch {
      await ctx.runMutation(internal.furniture.emailStatus, {
        id: args.id,
        audience: args.audience,
        status: args.attempt < 2 ? 'retrying' : 'failed',
      });
      if (args.attempt < 2)
        await ctx.scheduler.runAfter((args.attempt + 1) * 60000, internal.furnitureEmail.deliver, {
          ...args,
          attempt: args.attempt + 1,
        });
    }
  },
});

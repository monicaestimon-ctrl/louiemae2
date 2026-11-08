// Returns, refunds and goodwill (spec S22, v2 §13). Terms come from an approved returnPolicy per
// supplier and category. A refund is split into merchandise, tax, delivery, restored credit and
// cash by the accepted policy and the actual event; credit-funded shares go back as credit, never
// cash. Recording a refund here does not move money: the payment refund is a separate,
// authorized operations step, and its Stripe event drives commission reversal.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireDeliveryRole } from './dlvAccess';
import { activeConfig } from './sysConfig';
import { audit } from './sysCore';
import { CommerceError } from '../lib/errors';

export type ReturnPolicy = { windowDays: number; restockingBps: number; refundOriginalDelivery: boolean; customerPaysReturnFreight: boolean; damageClaimDays: number; requiresAuthorization: boolean };

/** Refund split for returning `pieces` of a line, using the policy. Pure arithmetic, exact cents. */
export function refundSplit(line: { pieces: number; unitPackMinor: number; packs: number; discountMinor: number; creditMinor: number; taxMinor: number; deliveryAllocMinor: number; deliveryTaxAllocMinor?:number; refundedMinor: number }, pieces: number, policy: ReturnPolicy, goodwill: boolean, previousPieces=0) {
  if (!Number.isInteger(pieces) || pieces < 1 || pieces > line.pieces) throw new CommerceError('INVALID_INPUT', 'Return quantity is not valid');
  if(!Number.isInteger(previousPieces)||previousPieces<0||previousPieces+pieces>line.pieces)throw new CommerceError('INVALID_INPUT','Invalid cumulative returned quantity');
  const share = (x: number) => Math.floor((x * (previousPieces+pieces)) / line.pieces)-Math.floor((x*previousPieces)/line.pieces);
  const gross = share(line.unitPackMinor * line.packs - line.discountMinor);
  const restocking = goodwill ? 0 : Math.floor((gross * policy.restockingBps) / 10_000);
  const merchandise = gross - restocking;
  const creditRestored = Math.min(share(line.creditMinor), merchandise);
  const tax = share(line.taxMinor) + (policy.refundOriginalDelivery || goodwill ? share(line.deliveryTaxAllocMinor??0) : 0);
  const delivery = policy.refundOriginalDelivery || goodwill ? share(line.deliveryAllocMinor) : 0;
  const cash = merchandise - creditRestored + tax + delivery;
  return { merchandise, tax, delivery, creditRestored, cash, restocking };
}

export const request = mutation({
  args: { orderLineId: v.id('ordOrderLines'), pieces: v.number(), reason: v.string(), goodwill: v.boolean() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, a.goodwill ? 'approver' : 'finance');
    const line = await ctx.db.get(a.orderLineId);
    if (!line) throw new CommerceError('INVALID_INPUT', 'Order line not found');
    const order = (await ctx.db.get(line.orderId))!;
    const policyKey = `returns-${line.supplierCode}-${line.commissionCategory}`;
    const policy = (await activeConfig<ReturnPolicy>(ctx, 'returnPolicy', policyKey)).value;
    if (!a.goodwill && Date.now() - order.paidAt > policy.windowDays * 86_400_000) throw new CommerceError('INVALID_INPUT', 'Outside the return window', 'This item is outside the return window.');
    const prior = await ctx.db.query('ordReturns').withIndex('by_line', (q) => q.eq('orderLineId', line._id)).collect();
    const returned = prior.filter((r) => r.status !== 'rejected').reduce((t, r) => t + r.pieces, 0);
    if (returned + a.pieces > line.pieces) throw new CommerceError('INVALID_INPUT', 'More pieces than were ordered');
    const refund = refundSplit(line, a.pieces, policy, a.goodwill, returned);
    const id = await ctx.db.insert('ordReturns', {
      orderLineId: line._id,
      policyKey,
      reason: a.reason,
      pieces: a.pieces,
      restockingMinor: refund.restocking,
      refund: { merchandise: refund.merchandise, tax: refund.tax, delivery: refund.delivery, creditRestored: refund.creditRestored, cash: refund.cash },
      goodwill: a.goodwill,
      status: policy.requiresAuthorization ? 'requested' : 'authorized',
      ...(policy.requiresAuthorization ? {} : { authorizedAt: Date.now() }),
      createdBy: admin.email,
      createdAt: Date.now(),
    });
    await audit(ctx, { actor: admin.email, action: a.goodwill ? 'return.goodwill' : 'return.request', entityTable: 'ordReturns', entityId: id, after: refund, reason: a.reason });
    return { id, refund };
  },
});

export const transition = mutation({
  args: { returnId: v.id('ordReturns'), to: v.union(v.literal('authorized'), v.literal('received'), v.literal('refunded'), v.literal('rejected')), condition: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, a.to === 'received' ? 'finance' : 'approver');
    const r = await ctx.db.get(a.returnId);
    if (!r) throw new CommerceError('INVALID_INPUT', 'Return not found');
    const allowed: Record<string, string[]> = { requested: ['authorized', 'rejected'], authorized: ['received', 'refunded', 'rejected'], received: ['refunded', 'rejected'] };
    if (!allowed[r.status]?.includes(a.to)) throw new CommerceError('INVALID_INPUT', `Cannot move a ${r.status} return to ${a.to}`);
    await ctx.db.patch(r._id, { status: a.to, ...(a.to === 'authorized' ? { authorizedAt: Date.now() } : {}), ...(a.condition ? { condition: a.condition } : {}) });
    if (a.to === 'refunded') {
      const line = (await ctx.db.get(r.orderLineId))!;
      await ctx.db.patch(line._id, { refundedMinor: line.refundedMinor + r.refund.merchandise, ...(line.refundedMinor + r.refund.merchandise >= line.unitPackMinor * line.packs - line.discountMinor ? { status: 'refunded' as const } : {}) });
    }
    await audit(ctx, { actor: admin.email, action: `return.${a.to}`, entityTable: 'ordReturns', entityId: r._id });
  },
});

export const forOrder = query({
  args: { orderId: v.id('ordOrders') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', a.orderId)).collect();
    return (await Promise.all(lines.map((l) => ctx.db.query('ordReturns').withIndex('by_line', (q) => q.eq('orderLineId', l._id)).collect()))).flat();
  },
});

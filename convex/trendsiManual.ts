import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { trendsiAddress, trendsiStatus } from './trendsiTables';
import { digest } from './dlvSecurity';
import {
  canPreparePayment,
  positiveQuantity,
  validMinor,
  shipmentStatus,
} from '../lib/trendsiManual';
import { sourcePropertyEntries } from '../lib/sourceProperties';
const properties = (p: Parameters<typeof sourcePropertyEntries>[0]) =>
  Object.fromEntries(sourcePropertyEntries(p).map((e) => [e.key, e.value]));

async function event(
  ctx: MutationCtx,
  orderId: Id<'trendsiOrders'>,
  actor: string,
  action: string,
  note = ''
) {
  await ctx.db.insert('trendsiOrderEvents', { orderId, actor, action, note, at: Date.now() });
}
async function releaseHolds(ctx: MutationCtx, orderId: Id<'trendsiOrders'>) {
  for (const hold of await ctx.db
    .query('trendsiStockHolds')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))
    .collect())
    if (hold.active) await ctx.db.patch(hold._id, { active: false });
}
export const enabled = query({
  args: {},
  handler: () => process.env.TRENDSI_MANUAL_ENABLED === 'true',
});
export const receipt = query({
  args: { id: v.id('trendsiOrders'), access: v.string() },
  handler: async (ctx, a) => {
    const o = await ctx.db.get(a.id);
    if (!o || a.access !== o.token) return null;
    return {
      number: `LM-T-${o._id.slice(-8).toUpperCase()}`,
      paid: Boolean(o.paidAt),
      review: o.status === 'exception',
      status: o.status,
      totalMinor: o.paidTotalMinor ?? null,
    };
  },
});
export const submit = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: trendsiAddress,
    notes: v.string(),
    website: v.string(),
    items: v.array(
      v.object({ productId: v.id('products'), variantId: v.string(), quantity: v.number() })
    ),
  },
  handler: async (ctx, a) => {
    if (process.env.TRENDSI_MANUAL_ENABLED !== 'true')
      throw Error('Order requests are not available yet.');
    const email = a.email.trim().toLowerCase();
    if (
      a.website ||
      !/^[\w-]{20,80}$/.test(a.token) ||
      !a.name.trim() ||
      a.name.length > 150 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      a.phone.length > 40 ||
      a.notes.length > 2000 ||
      !a.address.line1.trim() ||
      !a.address.city.trim() ||
      !/^[A-Z]{2}$/.test(a.address.state) ||
      !/^\d{5}(-\d{4})?$/.test(a.address.postalCode) ||
      Object.values(a.address).some((s) => s.length > 200) ||
      !a.items.length ||
      a.items.length > 20
    )
      throw Error('Please check your order and contact details.');
    const requestHash = await digest({ ...a, token: undefined, email });
    const old = await ctx.db
      .query('trendsiOrders')
      .withIndex('by_token', (q) => q.eq('token', a.token))
      .unique();
    if (old) {
      if (old.requestHash !== requestHash) throw Error('Start a new request for these changes.');
      return { number: `LM-T-${old._id.slice(-8).toUpperCase()}` };
    }
    const recent = await ctx.db
      .query('trendsiOrders')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .take(3);
    if (recent.length === 3 && recent[2].createdAt > Date.now() - 3600_000)
      throw Error('Please wait before submitting another request.');
    const seen = new Set<string>();
    const items = [];
    for (const s of a.items) {
      const key = `${s.productId}:${s.variantId}`;
      if (seen.has(key) || !positiveQuantity(s.quantity))
        throw Error('Check the selected quantities.');
      seen.add(key);
      const p = await ctx.db.get(s.productId),
        option = p?.variants?.find((o) => o.id === s.variantId);
      const props = properties(p?.sourceProperties);
      if (!p || p.storefrontStatus !== 'published' || props.supplier !== 'Trendsi' || !option)
        throw Error('This selection is unavailable.');
      let variants: { id: number; sku: string }[];
      try {
        variants = JSON.parse(props.supplierVariants || '[]');
        if (!Array.isArray(variants)) throw Error();
      } catch {
        throw Error('This item needs review.');
      }
      const source = variants.find((x) => `trendsi-${x.id}` === option.id);
      const supplierProductId = props.supplierProductId;
      const unitMinor = Math.round((p.price + option.priceAdjustment) * 100);
      if (
        !source?.sku ||
        !/^\d+$/.test(supplierProductId || '') ||
        !validMinor(unitMinor) ||
        unitMinor === 0
      )
        throw Error('This item needs review.');
      items.push({
        productId: p._id,
        variantId: option.id,
        name: p.name,
        variantName: option.name,
        supplierProductId,
        supplierSku: source.sku,
        sourceUrl: `https://www.trendsi.com/products/detail?id=${supplierProductId}&skuId=${source.id}`,
        quantity: s.quantity,
        unitMinor,
      });
    }
    const now = Date.now();
    const id = await ctx.db.insert('trendsiOrders', {
      token: a.token,
      requestHash,
      name: a.name.trim(),
      email,
      phone: a.phone.trim(),
      address: a.address,
      notes: a.notes.trim(),
      items,
      status: 'requested',
      revision: 1,
      shipments: [],
      createdAt: now,
      updatedAt: now,
    });
    await event(ctx, id, 'customer', 'requested');
    return { number: `LM-T-${id.slice(-8).toUpperCase()}` };
  },
});
export const list = query({
  args: { status: v.optional(trendsiStatus), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    return a.status
      ? ctx.db
          .query('trendsiOrders')
          .withIndex('by_status', (q) => q.eq('status', a.status!))
          .order('desc')
          .paginate(a.paginationOpts)
      : ctx.db.query('trendsiOrders').order('desc').paginate(a.paginationOpts);
  },
});
export const detail = query({
  args: { id: v.id('trendsiOrders') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const order = await ctx.db.get(a.id);
    return {
      order,
      events: await ctx.db
        .query('trendsiOrderEvents')
        .withIndex('by_order', (q) => q.eq('orderId', a.id))
        .order('desc')
        .take(60),
      stock: order
        ? await Promise.all(
            order.items.map(async (item) => {
              const p = await ctx.db.get(item.productId);
              const props = properties(p?.sourceProperties);
              return {
                productId: item.productId,
                checkedAt: props.trendsiInventoryLastSuccessAt ?? null,
                status: props.trendsiInventoryStatus ?? 'not_checked',
              };
            })
          )
        : [],
    };
  },
});
export const confirm = mutation({
  args: {
    id: v.id('trendsiOrders'),
    revision: v.number(),
    shippingMinor: v.number(),
    deliveryEstimate: v.string(),
    stockEvidence: v.string(),
    quantities: v.array(v.number()),
    confirmed: v.boolean(),
  },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx),
      o = await ctx.db.get(a.id);
    if (
      !o ||
      o.revision !== a.revision ||
      !['requested', 'confirmed'].includes(o.status) ||
      o.sessionId
    )
      throw Error('Reload the request before confirming.');
    if (
      !a.confirmed ||
      !validMinor(a.shippingMinor) ||
      !a.deliveryEstimate.trim() ||
      a.deliveryEstimate.length > 300 ||
      a.stockEvidence.trim().length < 5 ||
      a.stockEvidence.length > 1000 ||
      a.quantities.length !== o.items.length ||
      a.quantities.some((n, i) => !Number.isSafeInteger(n) || n < o.items[i].quantity)
    )
      throw Error('Confirm supplier stock for every item, shipping, and a delivery estimate.');
    const now = Date.now();
    for (const [index, item] of o.items.entries()) {
      const held = await ctx.db
        .query('trendsiStockHolds')
        .withIndex('by_variant', (q) =>
          q.eq('productId', item.productId).eq('variantId', item.variantId).eq('active', true)
        )
        .take(201);
      if (held.length > 200)
        throw Error('Too many outstanding stock holds; reconcile orders first.');
      const others = held.filter(
        (h) => h.orderId !== o._id && (h.expiresAt === undefined || h.expiresAt > now)
      );
      if (others.reduce((n, h) => n + h.quantity, 0) + item.quantity > a.quantities[index])
        throw Error(
          'Other pending orders already hold part of this quantity. Review those orders first.'
        );
    }
    await releaseHolds(ctx, o._id);
    for (const item of o.items)
      await ctx.db.insert('trendsiStockHolds', {
        orderId: o._id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        active: true,
        expiresAt: now + 30 * 60_000,
      });
    await ctx.db.patch(o._id, {
      status: 'confirmed',
      revision: o.revision + 1,
      shippingMinor: a.shippingMinor,
      deliveryEstimate: a.deliveryEstimate.trim(),
      stockEvidence: a.stockEvidence.trim(),
      stockConfirmedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await event(ctx, o._id, actor.email, 'stock_and_shipping_confirmed', a.stockEvidence);
  },
});
export const claimPayment = internalMutation({
  args: { id: v.id('trendsiOrders'), revision: v.number() },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx),
      o = await ctx.db.get(a.id);
    if (!o || o.revision !== a.revision) throw Error('Reload before creating payment.');
    if (o.status === 'payment_pending') return o;
    if (!canPreparePayment(o, Date.now()))
      throw Error('Reconfirm supplier stock and shipping before creating payment.');
    const holds = await ctx.db
      .query('trendsiStockHolds')
      .withIndex('by_order', (q) => q.eq('orderId', o._id))
      .collect();
    const active = holds.filter((h) => h.active);
    if (
      active.length !== o.items.length ||
      active.some((h) => !h.expiresAt || h.expiresAt <= Date.now())
    )
      throw Error('Stock confirmation expired. Reconfirm before payment.');
    for (const hold of active) await ctx.db.patch(hold._id, { expiresAt: undefined });
    const patch = {
      status: 'payment_pending' as const,
      paymentAttemptRevision: o.revision,
      sessionExpiresAt: Date.now() + 35 * 60_000,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(o._id, patch);
    await event(ctx, o._id, actor.email, 'payment_link_requested');
    return { ...o, ...patch };
  },
});
export const record = internalQuery({
  args: { id: v.id('trendsiOrders') },
  handler: (ctx, a) => ctx.db.get(a.id),
});
export const attachCustomer = internalMutation({
  args: { id: v.id('trendsiOrders'), revision: v.number(), customerId: v.string() },
  handler: async (ctx, a) => {
    const o = await ctx.db.get(a.id);
    if (
      !o ||
      o.paymentAttemptRevision !== a.revision ||
      (o.stripeCustomerId && o.stripeCustomerId !== a.customerId)
    )
      throw Error('Payment attempt changed.');
    await ctx.db.patch(o._id, { stripeCustomerId: a.customerId });
  },
});
export const resetUncreatedPayment = internalMutation({
  args: { id: v.id('trendsiOrders'), revision: v.number() },
  handler: async (ctx, a) => {
    const o = await ctx.db.get(a.id);
    if (
      !o ||
      o.paymentAttemptRevision !== a.revision ||
      o.sessionId ||
      o.paidAt ||
      !o.sessionExpiresAt ||
      o.sessionExpiresAt + 60_000 > Date.now()
    )
      throw Error('Payment attempt cannot be reset yet.');
    await releaseHolds(ctx, o._id);
    await ctx.db.patch(o._id, {
      status: 'requested',
      revision: o.revision + 1,
      stockConfirmedAt: undefined,
      paymentAttemptRevision: undefined,
      sessionExpiresAt: undefined,
      stripeCustomerId: undefined,
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      o._id,
      'stripe',
      'uncreated_payment_reconciled',
      'No session found after the attempt expired; stock must be reconfirmed.'
    );
  },
});
export const byPayment = internalQuery({
  args: { paymentIntentId: v.string() },
  handler: (ctx, a) =>
    ctx.db
      .query('trendsiOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId))
      .unique(),
});
export const resolveException = mutation({
  args: { id: v.id('trendsiOrders'), revision: v.number(), note: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx),
      o = await ctx.db.get(a.id);
    if (
      !o ||
      o.status !== 'exception' ||
      o.revision !== a.revision ||
      o.paymentHold ||
      a.note.trim().length < 5 ||
      a.note.length > 1000
    )
      throw Error('Resolve payment holds in Stripe first, then record the operational resolution.');
    const status = o.shipments.length
      ? shipmentStatus(o.items, o.shipments)
      : o.supplierReference
        ? 'ordered'
        : o.paidAt
          ? 'paid'
          : o.sessionId || o.paymentAttemptRevision
            ? 'payment_pending'
            : 'requested';
    await ctx.db.patch(o._id, { status, revision: o.revision + 1, updatedAt: Date.now() });
    await event(ctx, o._id, actor.email, 'exception_resolved', a.note.trim());
  },
});
export const attachSession = internalMutation({
  args: { id: v.id('trendsiOrders'), revision: v.number(), sessionId: v.string(), url: v.string() },
  handler: async (ctx, a) => {
    const o = await ctx.db.get(a.id);
    if (
      !o ||
      o.paymentAttemptRevision !== a.revision ||
      (o.sessionId && o.sessionId !== a.sessionId)
    )
      throw Error('Payment attempt changed.');
    await ctx.db.patch(o._id, { sessionId: a.sessionId, paymentUrl: a.url, updatedAt: Date.now() });
  },
});
export const paymentResult = internalMutation({
  args: {
    id: v.id('trendsiOrders'),
    sessionId: v.string(),
    paid: v.boolean(),
    expired: v.boolean(),
    paymentIntentId: v.optional(v.string()),
    totalMinor: v.number(),
    taxMinor: v.number(),
    fullyRefunded: v.optional(v.boolean()),
    hold: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const o = await ctx.db.get(a.id);
    if (!o || o.sessionId !== a.sessionId) throw Error('Unknown payment session.');
    if (a.fullyRefunded) {
      if (o.status === 'refunded') return;
      await releaseHolds(ctx, o._id);
      await ctx.db.patch(o._id, {
        status: 'refunded',
        paymentIntentId: a.paymentIntentId,
        paymentHold: undefined,
        revision: o.revision + 1,
        updatedAt: Date.now(),
      });
      await event(
        ctx,
        o._id,
        'stripe',
        'refund_verified',
        'Full refund verified in Stripe. Supplier cancellation or returns must be handled manually.'
      );
      return;
    }
    if (o.status === 'refunded') return;
    if (a.hold) {
      if (o.paymentHold === a.hold) return;
      await ctx.db.patch(o._id, {
        status: 'exception',
        paymentHold: a.hold,
        paymentIntentId: a.paymentIntentId,
        updatedAt: Date.now(),
      });
      await event(ctx, o._id, 'stripe', 'payment_exception', a.hold);
      return;
    }
    if (a.paid && !o.paidAt) {
      await ctx.db.patch(o._id, {
        status: o.status === 'exception' ? 'exception' : 'paid',
        paidAt: Date.now(),
        paymentIntentId: a.paymentIntentId,
        paidTotalMinor: a.totalMinor,
        taxMinor: a.taxMinor,
        updatedAt: Date.now(),
      });
      await event(ctx, o._id, 'stripe', 'payment_verified');
    } else if (a.expired && !o.paidAt && o.status === 'payment_pending') {
      await releaseHolds(ctx, o._id);
      await ctx.db.patch(o._id, {
        status: 'requested',
        revision: o.revision + 1,
        sessionId: undefined,
        paymentUrl: undefined,
        stockConfirmedAt: undefined,
        paymentAttemptRevision: undefined,
        sessionExpiresAt: undefined,
        stripeCustomerId: undefined,
        updatedAt: Date.now(),
      });
      await event(
        ctx,
        o._id,
        'stripe',
        'payment_expired',
        'Reconfirm stock before a new payment link.'
      );
    }
    if (a.paid && o.paymentHold) {
      await ctx.db.patch(o._id, { paymentHold: undefined, updatedAt: Date.now() });
      await event(
        ctx,
        o._id,
        'stripe',
        'payment_hold_cleared',
        'Payment reverified; staff must record the operational resolution before resuming.'
      );
    }
  },
});
export const progress = mutation({
  args: {
    id: v.id('trendsiOrders'),
    revision: v.number(),
    action: v.union(
      v.literal('ordered'),
      v.literal('delivered'),
      v.literal('exception'),
      v.literal('cancelled')
    ),
    note: v.string(),
    supplierReference: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx),
      o = await ctx.db.get(a.id);
    if (!o || o.revision !== a.revision || !a.note.trim() || a.note.length > 1000)
      throw Error('Reload and add an operations note.');
    if (
      a.action === 'ordered' &&
      (o.status !== 'paid' ||
        !o.paidAt ||
        o.paymentHold ||
        !a.supplierReference?.trim() ||
        a.supplierReference.length > 150)
    )
      throw Error('Verify payment and record the Trendsi order number first.');
    if (a.action === 'delivered' && o.status !== 'shipped')
      throw Error('All ordered units must be shipped first.');
    if (
      a.action === 'cancelled' &&
      (!['requested', 'confirmed'].includes(o.status) || o.paidAt || o.sessionId)
    )
      throw Error('Reconcile payment before cancellation. Paid refunds require Stripe review.');
    if (a.action === 'exception' && ['cancelled', 'delivered', 'refunded'].includes(o.status))
      throw Error('This request is closed.');
    await ctx.db.patch(o._id, {
      status: a.action,
      revision: o.revision + 1,
      updatedAt: Date.now(),
      ...(a.action === 'ordered' ? { supplierReference: a.supplierReference!.trim() } : {}),
    });
    if (a.action === 'ordered' || a.action === 'cancelled') await releaseHolds(ctx, o._id);
    await event(ctx, o._id, actor.email, a.action, a.note);
  },
});
export const ship = mutation({
  args: {
    id: v.id('trendsiOrders'),
    revision: v.number(),
    lineIndex: v.number(),
    quantity: v.number(),
    carrier: v.string(),
    tracking: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx),
      o = await ctx.db.get(a.id);
    if (
      !o ||
      o.revision !== a.revision ||
      !['ordered', 'partially_shipped'].includes(o.status) ||
      !o.paidAt ||
      o.paymentHold ||
      !a.carrier.trim() ||
      a.carrier.length > 80 ||
      !a.tracking.trim() ||
      a.tracking.length > 150
    )
      throw Error('Verify the order and shipment details.');
    const shipments = [
      ...o.shipments,
      {
        lineIndex: a.lineIndex,
        quantity: a.quantity,
        carrier: a.carrier.trim(),
        tracking: a.tracking.trim(),
        at: Date.now(),
      },
    ];
    await ctx.db.patch(o._id, {
      shipments,
      status: shipmentStatus(o.items, shipments),
      revision: o.revision + 1,
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      o._id,
      actor.email,
      'shipment_recorded',
      `${a.carrier}: ${a.tracking} · ${a.quantity} units`
    );
  },
});

import { customerFacing } from '../lib/delivery/publicErrors';
// Parent and child orders, manual dealer queues and shipments (spec S21, v2 §13). After verified
// payment the immutable lines are partitioned into supplier child orders; every physical piece
// belongs to exactly one allocation. Zuo goes to the Zuo manual dealer-order queue and Ashcroft
// to its own; nothing is sent to CJ or auto-purchased in a dealer account.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { audit, openReview } from './sysCore';
import { notify } from './sysNotify';
import { allocate } from '../lib/money';
import { splitDisclosure, ORDER_STATUS_LABEL } from '../lib/customerCopy';
import { CommerceError } from '../lib/errors';
import { formatUsd } from '../lib/money';
import { ownsOrder } from './ordAccess';
import { digest } from './dlvSecurity';

const ROUTE: Record<string, Doc<'ordSupplierOrders'>['route']> = { zuo: 'manual_dealer_zuo', ashcroft: 'manual_dealer_ashcroft' };

function orderNumber(intentId: string) {
  return `LM-${intentId.slice(-8).toUpperCase()}`;
}

/**
 * Creates the parent order, its immutable lines and the supplier partition from a paid intent.
 * Called once per intent inside the verified-payment mutation.
 */
export async function createOrderFromIntent(ctx: MutationCtx, intent: Doc<'ordCheckoutIntents'>, p: { paymentIntentId?: string; email: string; shippingAddress?: Doc<'ordOrders'>['shippingAddress']; paidAt: number }) {
  const lines = intent.lineSnapshot;
  const taxShares = allocate(intent.taxMinor, lines.map((l) => l.unitPackMinor * l.packs));
  const deliveryTaxShares=allocate(intent.deliveryTaxMinor??0,lines.map(l=>l.unitPackMinor*l.packs));
  const deliveryShares = allocate(intent.deliveryMinor, lines.map((l) => l.unitPackMinor * l.packs));
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {const key=`${l.supplierCode}:${l.originZip??''}:${l.service??'curbside'}`;groups.set(key,[...(groups.get(key)??[]),i])});
  const splitKnown = groups.size > 1;
  const orderId = await ctx.db.insert('ordOrders', {
    ...(intent.serviceTerms ? { serviceTerms: intent.serviceTerms } : {}),
    number: orderNumber(intent._id),
    intentId: intent._id,
    channel: intent.channel,
    ...(intent.buyer.userId ? { buyerUserId: intent.buyer.userId } : {}),
    email: p.email,
    ...(p.shippingAddress ? { shippingAddress: p.shippingAddress } : {}),
    ...(p.paymentIntentId ? { paymentIntentId: p.paymentIntentId } : {}),
    paidAt: p.paidAt,
    totals: { merchandise: intent.merchandiseMinor, discount: 0, credit: intent.creditMinor, delivery: intent.deliveryMinor, tax: intent.taxMinor, total: intent.totalMinor },
    splitKnown,
    accrualPath: 'none',
    status: 'paid',
    createdAt: Date.now(),
  });
  const lineIds: Id<'ordOrderLines'>[] = [];
  for (const [i, l] of lines.entries()) {
    const variant = l.supplierSku ? null : await ctx.db.get(l.variantId);
    const supplierSku = l.supplierSku ?? variant?.supplierSku;
    if (!supplierSku) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Missing supplier identity');
    lineIds.push(
      await ctx.db.insert('ordOrderLines', {
        orderId,
        lineNo: i + 1,
        lineKey: l.lineKey,
        variantId: l.variantId,
        productId: l.productId,
        name: l.name,
        packs: l.packs,
        pieces: l.pieces,
        unitPackMinor: l.unitPackMinor,
        discountMinor: l.discountMinor,
        creditMinor: l.creditMinor,
        taxMinor: l.taxMinor ?? taxShares[i],
        deliveryTaxAllocMinor:deliveryTaxShares[i],
        deliveryAllocMinor: l.deliveryAllocMinor ?? deliveryShares[i],
        commissionCategory: l.commissionCategory,
        supplierCode: l.supplierCode,
        supplierSku,
        supplierSkuSource: l.supplierSku ? 'checkout_snapshot' : 'canonical_at_order',
        ...(l.warehouseId ? { warehouseId: l.warehouseId } : {}),
        ...(l.costRevisionId ? { costRevisionId: l.costRevisionId } : {}),
        ...(l.priceRevisionId ? { priceRevisionId: l.priceRevisionId } : {}),
        refundedMinor: 0,
        status: 'open',
      })
    );
  }
  const now = Date.now();
  for (const [, idx] of groups) {
    const first=lines[idx[0]],supplierCode=first.supplierCode;
    const route = ROUTE[supplierCode];
    if (!route) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', `No fulfillment route for ${supplierCode}`);
    const childId = await ctx.db.insert('ordSupplierOrders', { orderId, supplierCode, ...(first.originZip?{warehouseCode:first.originZip}:{}),service:first.service??'curbside', route, status: 'queued', submission: { mode: 'none' }, exceptions: [], createdAt: now, updatedAt: now });
    for (const i of idx) await ctx.db.insert('ordAllocations', { orderLineId: lineIds[i], supplierOrderId: childId, pieces: lines[i].pieces, packs: lines[i].packs, status: 'open' });
  }
  for (const r of await ctx.db.query('ordInventoryReservations').withIndex('by_intent', (q) => q.eq('intentId', intent._id)).collect()) await ctx.db.patch(r._id, { status: 'consumed' });
  const itemsText = lines.map((l) => `• ${l.name} × ${l.packs} — ${formatUsd(l.unitPackMinor * l.packs)}`).join('\n');
  const address = intent.shippingAddress ?? p.shippingAddress;
  const destinationText = address
    ? [
        address.recipientName,
        address.line1,
        address.line2,
        `${address.city}, ${address.state} ${address.postalCode}`,
        address.phone,
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  await notify(ctx, {
    dedupeKey: `order-confirmation:${orderId}`,
    audience: 'customer',
    template: 'order_confirmation',
    to: p.email,
    subject: `Your Louie Mae order ${orderNumber(intent._id)}`,
    text: `Thank you for your order.\n\n${itemsText}\n\nDelivery: ${formatUsd(intent.deliveryMinor)}\nTax: ${formatUsd(intent.taxMinor)}\nTotal: ${formatUsd(intent.totalMinor)}\n\n${intent.serviceTerms ? [intent.serviceTerms.label, ...intent.serviceTerms.details].join('\n') : ''}\n\n${splitDisclosure(splitKnown)}\n\nDelivery destination:\n${destinationText}`,
  });
  return orderId;
}

/** Rolls the parent status up from child allocations (never "delivered" while anything is outstanding). */
export async function rollUp(ctx: MutationCtx, orderId: Id<'ordOrders'>) {
  const children = await ctx.db.query('ordSupplierOrders').withIndex('by_order', (q) => q.eq('orderId', orderId)).collect();
  const allocs = (await Promise.all(children.map((c) => ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect()))).flat();
  const live = allocs.filter((a) => a.status !== 'cancelled');
  const order = (await ctx.db.get(orderId))!;
  let shipped = 0, delivered = 0;
  const total = live.reduce((n, a) => n + a.pieces, 0);
  for (const al of live) {
    for (const item of await ctx.db.query('ordShipmentItems').withIndex('by_allocation', q => q.eq('allocationId', al._id)).collect()) {
      const shipment = await ctx.db.get(item.shipmentId);
      if (!shipment) continue;
      shipped += item.pieces;
      if (shipment.status === 'delivered') delivered += item.pieces;
    }
  }
  let status: Doc<'ordOrders'>['status'] = 'paid';
  if (!live.length) status = 'cancelled';
  else if (delivered >= total) status = 'delivered';
  else if (delivered > 0) status = 'partially_delivered';
  else if (shipped >= total) status = 'shipped';
  else if (shipped > 0) status = 'partially_shipped';
  if (status !== order.status) await ctx.db.patch(orderId, { status });
  return status;
}

async function child(ctx: QueryCtx, id: Id<'ordSupplierOrders'>) {
  const c = await ctx.db.get(id);
  if (!c) throw new CommerceError('INVALID_INPUT', 'Supplier order not found');
  return c;
}

/** The manual dealer-order queue for a route: what to order, for whom, and its state. */
export const dealerQueue = query({
  args: { route: v.union(v.literal('manual_dealer_zuo'), v.literal('manual_dealer_ashcroft')), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    const rows = await ctx.db
      .query('ordSupplierOrders')
      .withIndex('by_route_status', (q) => (a.status ? q.eq('route', a.route).eq('status', a.status as Doc<'ordSupplierOrders'>['status']) : q.eq('route', a.route)))
      .order('desc')
      .take(200);
    return Promise.all(
      rows.map(async (c) => {
        const order = await ctx.db.get(c.orderId);
        const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
        const items = await Promise.all(
          allocs.map(async (al) => {
            const line = await ctx.db.get(al.orderLineId);
            const variant = line ? await ctx.db.get(line.variantId) : null;
            return { allocationId: al._id, name: line?.name ?? '', supplierSku: line?.supplierSku ?? variant?.supplierSku ?? '', packs: al.packs, pieces: al.pieces, status: al.status };
          })
        );
        return { ...c, orderNumber: order?.number, shippingAddress: order?.shippingAddress, paidAt: order?.paidAt, items };
      })
    );
  },
});

/** Operations placed the dealer order by hand (manual handoff; mutually exclusive with EDI). */
export const markSubmitted = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), supplierPo: v.string(), acceptedCostMinor: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    const c = await child(ctx, a.supplierOrderId);
    if (c.submission.mode === 'edi') throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Submitted by EDI; reconcile before any manual order');
    if (!Number.isSafeInteger(a.acceptedCostMinor) || a.acceptedCostMinor < 0 || a.supplierPo.length > 200) throw new CommerceError('INVALID_INPUT', 'Use a valid supplier PO and nonnegative whole-cent cost');
    if (c.submission.mode === 'manual' && c.supplierPo === a.supplierPo.trim() && c.acceptedCostMinor === a.acceptedCostMinor) return;
    if (c.status !== 'queued') throw new CommerceError('INVALID_INPUT', `Already ${c.status}`);
    if (!a.supplierPo.trim()) throw new CommerceError('INVALID_INPUT', 'Record the supplier PO');
    await ctx.db.patch(c._id, { status: 'submitted', supplierPo: a.supplierPo.trim(), acceptedCostMinor: a.acceptedCostMinor, submission: { mode: 'manual', handoffAt: Date.now(), by: admin.email }, updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: 'supplier_order.submit', entityTable: 'ordSupplierOrders', entityId: c._id, reason: a.note });
  },
});

/** Supplier acknowledgement; a cost above the accepted cost is escalated, never silently paid. */
export const acknowledge = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), confirmation: v.string(), invoicedCostMinor: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    const c = await child(ctx, a.supplierOrderId);
    if (!a.confirmation.trim() || a.confirmation.length > 500 || (a.invoicedCostMinor !== undefined && (!Number.isSafeInteger(a.invoicedCostMinor) || a.invoicedCostMinor < 0))) throw new CommerceError('INVALID_INPUT', 'Record a valid confirmation and whole-cent supplier amount');
    if (c.supplierConfirmation === a.confirmation.trim() && c.acknowledgedCostMinor === a.invoicedCostMinor) return;
    if (c.status !== 'submitted' && c.status !== 'acknowledged') throw new CommerceError('INVALID_INPUT', 'Acknowledge a submitted supplier order before recording shipment');
    const exceptions = [...c.exceptions];
    if (a.invoicedCostMinor !== undefined && c.acceptedCostMinor !== undefined && a.invoicedCostMinor > c.acceptedCostMinor) {
      exceptions.push({ at: Date.now(), kind: 'cost_discrepancy', note: `Supplier invoiced ${a.invoicedCostMinor} vs accepted ${c.acceptedCostMinor}` });
      await openReview(ctx, 'supplier_cost_discrepancy', 'ordSupplierOrders', c._id, 'Supplier invoice exceeds the accepted cost');
    }
    await ctx.db.patch(c._id, { status: 'acknowledged', supplierConfirmation: a.confirmation.trim(), ...(a.invoicedCostMinor !== undefined ? { acknowledgedCostMinor: a.invoicedCostMinor } : {}), exceptions, updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: 'supplier_order.ack', entityTable: 'ordSupplierOrders', entityId: c._id });
  },
});

/**
 * Records a shipment with exactly which allocations and pieces it carries. The customer hears
 * what shipped, the tracking link and what is still outstanding.
 */
export const recordShipment = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), requestKey: v.string(), items: v.array(v.object({ allocationId: v.id('ordAllocations'), pieces: v.number() })), carrier: v.optional(v.string()), trackingNumber: v.optional(v.string()), trackingUrl: v.optional(v.string()), estimatedWindow: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    const c = await child(ctx, a.supplierOrderId);
    if (!/^[\w-]{16,80}$/.test(a.requestKey) || !a.items.length || a.items.length > 100 || new Set(a.items.map(i => i.allocationId)).size !== a.items.length || a.items.some(i => !Number.isSafeInteger(i.pieces) || i.pieces < 1)) throw new CommerceError('INVALID_INPUT', 'Choose distinct items and whole physical-piece quantities');
    const key = `shipment:${await digest(admin.email)}:${a.requestKey}`, hash = await digest(a);
    const retry = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', q => q.eq('key', key)).first();
    if (retry) {
      if (retry.scope !== hash || !retry.resultRef) throw new CommerceError('INVALID_INPUT', 'Changed shipment retry');
      return retry.resultRef as Id<'ordShipments'>;
    }
    if (!c.submission.handoffAt || !['submitted', 'acknowledged', 'partially_shipped', 'shipped'].includes(c.status)) throw new CommerceError('INVALID_INPUT', 'Record the supplier handoff before shipment');
    if ((a.carrier?.length ?? 0) > 100 || (a.trackingNumber?.length ?? 0) > 200 || (a.trackingUrl?.length ?? 0) > 2048 || (a.estimatedWindow?.length ?? 0) > 200) throw new CommerceError('INVALID_INPUT', 'Shipment details are too long');
    if (a.trackingUrl && !/^https:\/\//.test(a.trackingUrl)) throw new CommerceError('INVALID_INPUT', 'Tracking links must be https');
    const now = Date.now();
    const shipmentId = await ctx.db.insert('ordShipments', { supplierOrderId: c._id, ...(a.carrier ? { carrier: a.carrier } : {}), ...(a.trackingNumber ? { trackingNumber: a.trackingNumber } : {}), ...(a.trackingUrl ? { trackingUrl: a.trackingUrl } : {}), ...(a.estimatedWindow ? { estimatedWindow: a.estimatedWindow } : {}), shippedAt: now, status: 'shipped', createdAt: now });
    const shippedNames: string[] = [];
    for (const it of a.items) {
      const al = await ctx.db.get(it.allocationId);
      if (!al || al.supplierOrderId !== c._id) throw new CommerceError('INVALID_INPUT', 'Item is not part of this supplier order');
      if (al.status === 'cancelled' || al.status === 'delivered') throw new CommerceError('INVALID_INPUT', 'This allocation cannot be shipped again');
      const already = (await ctx.db.query('ordShipmentItems').withIndex('by_allocation', (q) => q.eq('allocationId', al._id)).collect()).reduce((t, x) => t + x.pieces, 0);
      if (it.pieces < 1 || already + it.pieces > al.pieces) throw new CommerceError('INVALID_INPUT', 'More pieces than ordered');
      await ctx.db.insert('ordShipmentItems', { shipmentId, allocationId: al._id, pieces: it.pieces });
      if (already + it.pieces === al.pieces) await ctx.db.patch(al._id, { status: 'shipped' });
      const line = await ctx.db.get(al.orderLineId);
      shippedNames.push(`${line?.name ?? 'Item'} — ${it.pieces} piece${it.pieces === 1 ? '' : 's'}`);
    }
    const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
    await ctx.db.patch(c._id, { status: allocs.every((x) => x.status !== 'open') ? 'shipped' : 'partially_shipped', updatedAt: now });
    const status = await rollUp(ctx, c.orderId);
    const order = (await ctx.db.get(c.orderId))!;
    const outstanding = await outstandingItems(ctx, order._id);
    await notify(ctx, {
      dedupeKey: `shipment:${shipmentId}`,
      audience: 'customer',
      template: 'shipment',
      to: order.email,
      subject: `${outstanding.length ? 'Part of your order' : 'Your order'} ${order.number} has shipped`,
      text: `These items are on their way:\n${shippedNames.map((n) => `• ${n}`).join('\n')}\n${a.trackingUrl ? `\nTrack it: ${a.trackingUrl}\n` : ''}\n${outstanding.length ? `Still to ship:\n${outstanding.map((n) => `• ${n}`).join('\n')}` : 'All uncancelled items have now shipped.'}\n\nOrder status: ${ORDER_STATUS_LABEL[status]}`,
    });
    await audit(ctx, { actor: admin.email, action: 'shipment.record', entityTable: 'ordShipments', entityId: shipmentId });
    await ctx.db.insert('sysIdempotencyKeys', { key, scope: hash, resultRef: shipmentId, createdAt: now });
    return shipmentId;
  },
});

async function outstandingItems(ctx: QueryCtx, orderId: Id<'ordOrders'>) {
  const children = await ctx.db.query('ordSupplierOrders').withIndex('by_order', (q) => q.eq('orderId', orderId)).collect();
  const out: string[] = [];
  for (const c of children)
    for (const al of await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect()) {
      if (al.status !== 'open') continue;
      const line = await ctx.db.get(al.orderLineId);
      const shipped = (await ctx.db.query('ordShipmentItems').withIndex('by_allocation', q => q.eq('allocationId', al._id)).collect()).reduce((n, x) => n + x.pieces, 0);
      if (line && al.pieces > shipped) out.push(`${line.name} — ${al.pieces - shipped} piece(s)`);
    }
  return out;
}

export const markDelivered = mutation({
  args: { shipmentId: v.id('ordShipments') },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    const s = await ctx.db.get(a.shipmentId);
    if (!s) throw new CommerceError('INVALID_INPUT', 'Shipment not found');
    if (s.status === 'delivered') return;
    if (s.activeIssue || s.status !== 'shipped') throw new CommerceError('INVALID_INPUT', 'Resolve the shipment issue before confirming delivery');
    await ctx.db.patch(s._id, { status: 'delivered', deliveredAt: Date.now() });
    for (const it of await ctx.db.query('ordShipmentItems').withIndex('by_shipment', (q) => q.eq('shipmentId', s._id)).collect()) {
      const al = await ctx.db.get(it.allocationId);
      // Count only pieces in shipments that have actually been delivered.
      let delivered = 0;
      for (const x of await ctx.db.query('ordShipmentItems').withIndex('by_allocation', (q) => q.eq('allocationId', it.allocationId)).collect()) {
        const sh = await ctx.db.get(x.shipmentId);
        if (sh?.status === 'delivered') delivered += x.pieces;
      }
      if (al && al.status === 'shipped' && delivered >= al.pieces) await ctx.db.patch(al._id, { status: 'delivered' });
    }
    const c = (await ctx.db.get(s.supplierOrderId))!;
    const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
    if (allocs.every((x) => x.status === 'delivered' || x.status === 'cancelled')) await ctx.db.patch(c._id, { status: 'delivered', updatedAt: Date.now() });
    await rollUp(ctx, c.orderId);
    await audit(ctx, { actor: admin.email, action: 'shipment.delivered', entityTable: 'ordShipments', entityId: s._id });
  },
});

/**
 * A supplier rejected or cancelled lines. Only that supplier's allocations change; the other
 * supplier's accepted order is never resent or cancelled. Refunds go through ordReturns.
 */
export const cancelAllocations = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), allocationIds: v.array(v.id('ordAllocations')), reason: v.string(), requestKey: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    const c = await child(ctx, a.supplierOrderId);
    if (!/^[\w-]{16,80}$/.test(a.requestKey) || a.reason.trim().length < 5 || a.reason.length > 1000 || !a.allocationIds.length || a.allocationIds.length > 100 || new Set(a.allocationIds).size !== a.allocationIds.length) throw new CommerceError('INVALID_INPUT', 'Choose distinct allocations and record the cancellation evidence');
    const key = `supplier-cancel:${await digest(admin.email)}:${a.requestKey}`, hash = await digest(a);
    const retry = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', q => q.eq('key', key)).first();
    if (retry) { if (retry.scope !== hash) throw new CommerceError('INVALID_INPUT', 'Changed cancellation retry'); return; }
    const cancelledNames: string[] = [];
    for (const id of a.allocationIds) {
      const al = await ctx.db.get(id);
      if (!al || al.supplierOrderId !== c._id) throw new CommerceError('INVALID_INPUT', 'Allocation is not part of this supplier order');
      if (al.status !== 'open') throw new CommerceError('INVALID_INPUT', 'Only unshipped items can be cancelled');
      if (await ctx.db.query('ordShipmentItems').withIndex('by_allocation', q => q.eq('allocationId', al._id)).first()) throw new CommerceError('INVALID_INPUT', 'Partly shipped allocations need a reviewed partial return or cancellation');
      await ctx.db.patch(al._id, { status: 'cancelled' });
      await ctx.db.patch(al.orderLineId, { status: 'cancelled' });
      cancelledNames.push(`${(await ctx.db.get(al.orderLineId))?.name ?? 'Item'} — ${al.pieces} piece(s)`);
    }
    const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
    const exceptions = [...c.exceptions, { at: Date.now(), kind: 'supplier_cancel', note: a.reason }];
    await ctx.db.patch(c._id, { exceptions, status: allocs.every((x) => x.status === 'cancelled') ? 'cancelled' : c.status, updatedAt: Date.now() });
    await rollUp(ctx, c.orderId);
    const order = (await ctx.db.get(c.orderId))!;
    await notify(ctx, { dedupeKey: `cancel:${c._id}:${a.allocationIds.join(',')}`, audience: 'customer', template: 'line_cancelled', to: order.email, subject: `An update on your order ${order.number}`, text: `These items can't be supplied:\n${cancelledNames.join('\n')}\n\nWe'll contact you about a refund for the affected items; the rest of your order is unaffected. Contact Louie Mae support with order ${order.number} for help.` });
    await audit(ctx, { actor: admin.email, action: 'supplier_order.cancel_lines', entityTable: 'ordSupplierOrders', entityId: c._id, reason: a.reason });
    await ctx.db.insert('sysIdempotencyKeys', { key, scope: hash, resultRef: c._id, createdAt: Date.now() });
  },
});

/** Operations-only shipment detail with exact remaining physical-piece quantities. */
export const shipmentDetail = query({
  args: { supplierOrderId: v.id('ordSupplierOrders') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    const c = await child(ctx, a.supplierOrderId), order = await ctx.db.get(c.orderId);
    const allocations = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', q => q.eq('supplierOrderId', c._id)).collect();
    const items = await Promise.all(allocations.map(async al => {
      const line = await ctx.db.get(al.orderLineId);
      const shippedPieces = (await ctx.db.query('ordShipmentItems').withIndex('by_allocation', q => q.eq('allocationId', al._id)).collect()).reduce((n, s) => n + s.pieces, 0);
      return { allocationId: al._id, name: line?.name ?? 'Item', sku: line?.supplierSku ?? '', pieces: al.pieces, shippedPieces, remainingPieces: al.status === 'cancelled' ? 0 : Math.max(0, al.pieces - shippedPieces), status: al.status };
    }));
    const shipments = await ctx.db.query('ordShipments').withIndex('by_supplier_order', q => q.eq('supplierOrderId', c._id)).collect();
    return { supplierOrder: c, number: order?.number, address: order?.shippingAddress, serviceTerms: order?.serviceTerms, items,
      shipments: await Promise.all(shipments.map(async s => ({ ...s, items: await Promise.all((await ctx.db.query('ordShipmentItems').withIndex('by_shipment', q => q.eq('shipmentId', s._id)).collect()).map(async item => ({ name: items.find(i => i.allocationId === item.allocationId)?.name ?? 'Item', pieces: item.pieces }))) }))) };
  },
});

/** An operational incident never books a replacement shipment, changes price or issues a refund. */
export const recordShipmentIssue = mutation({
  args: { shipmentId: v.id('ordShipments'), kind: v.union(v.literal('delayed'), v.literal('lost'), v.literal('damaged'), v.literal('delivery_exception'), v.literal('resolved')), message: v.string(), evidence: v.string(), notifyCustomer: v.boolean(), requestKey: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    if (!/^[\w-]{16,80}$/.test(a.requestKey) || a.message.trim().length < 5 || a.message.length > 1000 || a.evidence.trim().length < 5 || a.evidence.length > 2000) throw new CommerceError('INVALID_INPUT', 'Record the customer-safe update and internal evidence');
    const key = `shipment-issue:${await digest(actor.email)}:${a.requestKey}`, hash = await digest(a);
    const prior = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', q => q.eq('key', key)).first();
    if (prior) { if (prior.scope !== hash) throw new CommerceError('INVALID_INPUT', 'Changed shipment issue retry'); return; }
    const shipment = await ctx.db.get(a.shipmentId);
    if (!shipment) throw new CommerceError('INVALID_INPUT', 'Shipment not found');
    if (a.kind === 'resolved' && !shipment.activeIssue && shipment.status !== 'lost' && shipment.status !== 'damaged') throw new CommerceError('INVALID_INPUT', 'No open shipment issue to resolve');
    const supplier = await child(ctx, shipment.supplierOrderId), order = (await ctx.db.get(supplier.orderId))!;
    const activeIssue = a.kind === 'resolved' ? undefined : { kind: a.kind, message: a.message.trim(), recordedAt: Date.now() };
    await ctx.db.patch(shipment._id, { activeIssue, customerUpdate: { kind: a.kind, message: a.message.trim(), recordedAt: Date.now() }, ...(a.kind === 'resolved' && ['lost', 'damaged'].includes(shipment.status) ? { status: shipment.deliveredAt ? 'delivered' as const : 'shipped' as const } : {}) });
    const names = await Promise.all((await ctx.db.query('ordShipmentItems').withIndex('by_shipment', q => q.eq('shipmentId', shipment._id)).collect()).map(async item => {
      const allocation = await ctx.db.get(item.allocationId), line = allocation ? await ctx.db.get(allocation.orderLineId) : null;
      return `${line?.name ?? 'Item'} — ${item.pieces} piece(s)`;
    }));
    if (a.notifyCustomer) await notify(ctx, { dedupeKey: key, audience: 'customer', template: 'shipment_update', to: order.email,
      subject: `Delivery update for order ${order.number}`, text: `${a.message.trim()}\n\nAffected items:\n${names.join('\n')}\n\nContact Louie Mae support with order ${order.number} for help. Other shipment groups are unaffected by this update.` });
    await audit(ctx, { actor: actor.email, action: 'shipment.issue_recorded', entityTable: 'ordShipments', entityId: shipment._id, before: shipment.activeIssue ?? null, after: { kind: a.kind, message: a.message.trim(), notifyCustomer: a.notifyCustomer }, reason: a.evidence.trim(), requestId: key });
    await rollUp(ctx, order._id);
    await ctx.db.insert('sysIdempotencyKeys', { key, scope: hash, resultRef: shipment._id, createdAt: Date.now() });
  },
});

/** Retired: unitemized expenses cannot bypass the canonical invoice/contribution ledger. */
export const recordFreightActual = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), estimatedMinor: v.number(), actualMinor: v.number(), invoiceRef: v.string() },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    await child(ctx, a.supplierOrderId);
    throw new CommerceError('INVALID_INPUT', 'Use the itemized delivery invoice workflow. Legacy freight entry is retired.');
  },
});

/** Customer-safe projection shared by authenticated order status and payment receipts. */
export async function customerOrder(ctx: QueryCtx, order: Doc<'ordOrders'>) {
    const children = await ctx.db.query('ordSupplierOrders').withIndex('by_order', (q) => q.eq('orderId', order._id)).collect();
    const shipments = await Promise.all(
      children.map(async (c, i) => {
        const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
        const ships = await ctx.db.query('ordShipments').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id)).collect();
        return {
          label: `Shipment group ${i + 1}`,
          items: await Promise.all(allocs.map(async (al) => ({ name: (await ctx.db.get(al.orderLineId))?.name ?? '', pieces: al.pieces, status: al.status }))),
          tracking: await Promise.all(ships.map(async (s) => ({ status: s.status, trackingUrl: s.trackingUrl ?? null, carrier: s.carrier ?? null, estimatedWindow: s.estimatedWindow ?? null, issue: s.activeIssue ?? null, update: s.customerUpdate ?? null,
            items: await Promise.all((await ctx.db.query('ordShipmentItems').withIndex('by_shipment', q => q.eq('shipmentId', s._id)).collect()).map(async item => {
              const al = allocs.find(a => a._id === item.allocationId), line = al ? await ctx.db.get(al.orderLineId) : null;
              return { name: line?.name ?? 'Item', pieces: item.pieces };
            }))
          }))),
        };
      })
    );
    return { serviceTerms: order.serviceTerms ?? null, number: order.number, status: order.status, statusLabel: ORDER_STATUS_LABEL[order.status], totals: order.totals, disclosure: splitDisclosure(order.splitKnown), shipments };
}

/** Email is accepted for old callers but is no longer an authorization credential. */
export const orderStatus = query({
  args: { number: v.string(), email: v.optional(v.string()), guestCapability: v.optional(v.string()) },
  handler: async (ctx, a) => customerFacing(async () => {
    if (a.number.length > 64) return null;
    const order = await ctx.db.query('ordOrders').withIndex('by_number', q => q.eq('number', a.number.trim().toUpperCase())).first();
    if (!order) return null;
    const intent = order.intentId ? await ctx.db.get(order.intentId) : null;
    if (!(await ownsOrder(ctx, { userId: order.buyerUserId, email: order.email }, intent, a.guestCapability))) return null;
    return customerOrder(ctx, order);
  }),
});

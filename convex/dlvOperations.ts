import { customerFacing } from '../lib/delivery/publicErrors';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { addressArg, lineArg } from './dlvEstimates';
import { capability, digest } from './dlvSecurity';
import { viewer, isVerified } from './holmAccess';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';
import { audit, openReview } from './sysCore';
import { notify } from './sysNotify';
import { checkQuoteLines } from './ordQuotes';
import { computeManualQuote } from './dlvManual';
import { cartHash } from './dlvEngine';
import { addressKey } from '../lib/delivery/destination';
import { closedRequestStates, requestState } from './dlvQuoteLifecycle';

async function owns(ctx: MutationCtx | QueryCtx, r: Doc<'dlvQuoteRequests'>, token?: string) {
  const me = await viewer(ctx);
  if (
    r.userId
      ? me?.userId !== r.userId
      : !token ||
        !/^[a-f0-9]{64}$/.test(token) ||
        Date.now() > r.createdAt + 90 * 86400000 ||
        (await digest(token)) !== r.guestCapabilityHash
  )
    throw new CommerceError('FORBIDDEN');
}
export const quoteRequestArgs = {
  requestKey: v.string(),
  lines: v.array(lineArg),
  channel: v.union(v.literal('retail'), v.literal('trade')),
  postalCode: v.string(),
  address: v.optional(addressArg),
  name: v.string(),
  email: v.string(),
  phone: v.string(),
  service: v.string(),
  notes: v.string(),
  consent: v.boolean(),
};
export const createRequest = internalMutation({
  args: quoteRequestArgs,
  handler: async (ctx, a) =>
    customerFacing(async () => {
      assertDeliveryBounds(a, 100);
      const me = await viewer(ctx);
      if (a.channel === 'trade' && !isVerified(me?.profile ?? null))
        throw new CommerceError('TRADE_APPROVAL_REQUIRED');
      if (
        !/^[a-f0-9]{64}$/.test(a.requestKey) ||
        !a.consent ||
        !/^\d{5}(-\d{4})?$/.test(a.postalCode) ||
        !a.name.trim() ||
        a.name.length > 150 ||
        !/^\S+@\S+\.\S+$/.test(a.email) ||
        a.email.length > 254 ||
        a.phone.length > 50 ||
        a.notes.length > 4000 ||
        a.service.length > 80 ||
        !a.lines.length ||
        a.lines.length > 100
      )
        throw new CommerceError('INVALID_INPUT');
      const email = a.email.trim().toLowerCase();
      const requestKeyHash = await digest(a.requestKey);
      const requestHash = await digest({ ...a, userId: me?.userId ?? null });
      const existing = await ctx.db
        .query('dlvQuoteRequests')
        .withIndex('by_request_key', (q) => q.eq('requestKeyHash', requestKeyHash))
        .unique();
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new CommerceError(
            'INVALID_INPUT',
            'Request key belongs to different quote details'
          );
        if (existing.createdAt + 90 * 86400000 <= Date.now())
          throw new CommerceError('QUOTE_EXPIRED');
        // The random request key is a retry capability. Rotate guest access only for an exact retry.
        const token = capability();
        if (!existing.userId)
          await ctx.db.patch(existing._id, { guestCapabilityHash: await digest(token) });
        return { id: existing._id, ...(!existing.userId ? { guestCapability: token } : {}) };
      }
      const lines = [];
      const requested = [];
      const seen = new Set<string>();
      for (const l of a.lines) {
        if (
          !Number.isSafeInteger(l.packs) ||
          l.packs < 1 ||
          l.packs > 10000 ||
          seen.has(`${l.productId}:${l.variantId}`)
        )
          throw new CommerceError('INVALID_INPUT');
        seen.add(`${l.productId}:${l.variantId}`);
        const pid = ctx.db.normalizeId('commerceProducts', l.productId);
        const p = pid ? await ctx.db.get(pid) : null;
        if (!p) throw new CommerceError('STOCK_UNAVAILABLE');
        const listing = await ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) =>
            q.eq('productId', p._id).eq('channel', a.channel === 'retail' ? 'retail' : 'house')
          )
          .unique();
        const option = listing?.snapshot.variants.find((x) => x.id === l.variantId);
        if (!listing?.published || !option) throw new CommerceError('STOCK_UNAVAILABLE');
        if (p.provider === 'zuo') {
          const vid = ctx.db.normalizeId('catVariants', l.variantId);
          const variant = vid ? await ctx.db.get(vid) : null;
          if (
            !variant ||
            variant.productId !== p._id ||
            variant.availability === 'discontinued' ||
            variant.availability === 'out_of_stock'
          )
            throw new CommerceError('STOCK_UNAVAILABLE');
        }
        lines.push({
          productId: p._id,
          variantId: l.variantId,
          packs: l.packs,
          name: listing.snapshot.name,
        });
        requested.push({
          productId: p._id,
          variantId: l.variantId,
          name: listing.snapshot.name,
          variantName: option.name,
          quantity: l.packs,
          unitPrice: option.price,
          provider: p.provider,
          sku: listing.fulfillment?.find((x) => x.id === l.variantId)?.sku ?? '',
        });
      }
      const token = capability(),
        now = Date.now();
      const projectId = await ctx.db.insert('commerceProjects', {
        token: capability(),
        channel: a.channel === 'retail' ? 'retail' : 'house',
        name: a.name.trim(),
        email,
        phone: a.phone,
        business: '',
        address: {
          line1: a.address?.line1 ?? '',
          city: a.address?.city ?? '',
          state: a.address?.state ?? '',
          postalCode: a.postalCode,
          country: a.address?.country ?? 'US',
        },
        notes: a.notes,
        requested,
        lines: requested,
        delivery: 0,
        tax: 0,
        revision: 1,
        status: 'delivery_quote_requested',
        createdAt: now,
        updatedAt: now,
      });
      const { consent: _consent, requestKey: _requestKey, ...details } = a;
      void _requestKey;
      void _consent;
      const id = await ctx.db.insert('dlvQuoteRequests', {
        ...details,
        requestKeyHash,
        requestHash,
        postalCode: a.postalCode,
        lines,
        projectId,
        email,
        name: a.name.trim(),
        ...(me ? { userId: me.userId } : { guestCapabilityHash: await digest(token) }),
        status: 'requested',
        createdAt: now,
        updatedAt: now,
      });
      // Contact acknowledgement is transactional; no marketing subscription is created.
      await notify(ctx, {
        dedupeKey: `delivery-request:${id}`,
        audience: 'customer',
        template: 'delivery_quote_requested',
        to: email,
        subject: 'Your delivery quote request',
        text: `We received your delivery quote request ${id}. Our team will review the items, address and service before you pay. This is not an order or a stock reservation.`,
      });
      return { id, ...(!me ? { guestCapability: token } : {}) };
    }),
});
export const requestStatus = query({
  args: { id: v.id('dlvQuoteRequests'), guestCapability: v.optional(v.string()) },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      const r = await ctx.db.get(a.id);
      if (!r) return null;
      await owns(ctx, r, a.guestCapability);
      const q = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
      return {
        id: r._id,
        status: requestState(r, q),
        orderPlaced: !!r.orderId,
        lines: r.lines,
        message: r.customerMessage ?? null,
        updatedAt: r.updatedAt,
        quote:
          q && ['sent', 'accepted', 'expired'].includes(q.status)
            ? {
                id: q._id,
                version: q.version,
                lines: q.lines,
                merchandiseMinor: q.lines.reduce(
                  (n, l) => n + l.unitPackMinor * l.packs - l.discountMinor,
                  0
                ),
                totalMinor:
                  q.lines.reduce((n, l) => n + l.unitPackMinor * l.packs - l.discountMinor, 0) +
                  q.deliveryMinor +
                  q.taxMinor,
                address: q.address ?? null,
                deliveryMinor: q.deliveryMinor,
                taxMinor: q.taxMinor,
                service: q.service,
                terms: q.terms,
                expiresAt: q.expiresAt,
                expired: q.expiresAt <= Date.now(),
              }
            : null,
      };
    }),
});
export const queue = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('dlvQuoteRequests').order('desc').paginate(a.paginationOpts);
    return {
      ...page,
      page: page.page.map(
        ({ guestCapabilityHash: _cap, requestKeyHash: _key, requestHash: _hash, ...row }) => {
          void _cap;
          void _key;
          void _hash;
          return row;
        }
      ),
    };
  },
});
export const updateRequest = mutation({
  args: {
    id: v.id('dlvQuoteRequests'),
    status: v.union(v.literal('needs_information'), v.literal('sourcing'), v.literal('cancelled')),
    assignedTo: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const r = await ctx.db.get(a.id);
    if (!r || ['accepted', ...closedRequestStates].includes(r.status))
      throw new CommerceError('INVALID_INPUT');
    const activeQuote = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
    if (activeQuote?.status === 'accepted')
      throw new CommerceError(
        'INVALID_INPUT',
        'Accepted quote changes require a new reviewed version'
      );
    if (a.message.length > 2000 || (a.assignedTo?.length ?? 0) > 200)
      throw new CommerceError('INVALID_INPUT');
    await ctx.db.patch(r._id, {
      status: a.status,
      assignedTo: a.assignedTo,
      customerMessage: a.message,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.request.update',
      entityTable: 'dlvQuoteRequests',
      entityId: r._id,
      reason: a.message,
    });
    await notify(ctx, {
      dedupeKey: `delivery-update:${r._id}:${await digest({ status: a.status, message: a.message })}`,
      audience: 'customer',
      template: 'delivery_quote_update',
      to: r.email,
      subject: 'An update on your delivery quote',
      text: `Your delivery request ${r._id} is ${a.status.replaceAll('_', ' ')}.\n${a.message}\nReturn to your saved private quote link, or sign in with your verified request email at https://www.louiemae.com/?deliveryQuote=${r._id}`,
    });
  },
});
export const attachQuote = mutation({
  args: { id: v.id('dlvQuoteRequests'), versionId: v.id('ordQuoteVersions') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const r = await ctx.db.get(a.id);
    const q = await ctx.db.get(a.versionId);
    if (
      !r ||
      !q ||
      q.projectId !== r.projectId ||
      (r.quoteVersionId !== undefined && r.quoteVersionId !== q._id) ||
      q.status !== 'sent' ||
      q.expiresAt <= Date.now() ||
      ['accepted', ...closedRequestStates].includes(r.status)
    )
      throw new CommerceError('INVALID_INPUT');
    await computeManualQuote(ctx, q);
    await ctx.db.patch(r._id, {
      quoteVersionId: q._id,
      quoteExpiresAt: q.expiresAt,
      status: 'sent',
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.quote.attach',
      entityTable: 'dlvQuoteRequests',
      entityId: r._id,
    });
    await notify(ctx, {
      dedupeKey: `delivery-quote-sent:${q._id}`,
      audience: 'customer',
      template: 'delivery_quote_ready',
      to: r.email,
      subject: 'Your delivery quote is ready to review',
      text: `Version ${q.version} of your delivery quote is ready. Review the full items, service, total, terms and expiry before accepting. Return to your saved private quote link, or sign in with your verified request email at https://www.louiemae.com/?deliveryQuote=${r._id}. No payment or stock reservation has been made.`,
    });
  },
});
/** Lost guest links can be recovered only through a verified account with the request email. */
export const recoverQuote = mutation({
  args: { id: v.id('dlvQuoteRequests') },
  handler: async (ctx, a) => {
    const me = await viewer(ctx);
    const user = me ? await ctx.db.get(me.userId) : null;
    const r = await ctx.db.get(a.id);
    if (
      !me ||
      !user?.emailVerificationTime ||
      !r ||
      r.email !== me.email ||
      (r.userId && r.userId !== me.userId)
    )
      throw new CommerceError('FORBIDDEN');
    await ctx.db.patch(r._id, {
      userId: me.userId,
      guestCapabilityHash: undefined,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: me.userId,
      action: 'delivery.quote.recover',
      entityTable: 'dlvQuoteRequests',
      entityId: r._id,
    });
    return { id: r._id };
  },
});
export const acceptQuote = mutation({
  args: {
    id: v.id('dlvQuoteRequests'),
    versionId: v.id('ordQuoteVersions'),
    guestCapability: v.optional(v.string()),
  },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      const r = await ctx.db.get(a.id);
      if (!r) throw new CommerceError('FORBIDDEN');
      await owns(ctx, r, a.guestCapability);
      const q = await ctx.db.get(a.versionId);
      if (
        !q ||
        q._id !== r.quoteVersionId ||
        q.projectId !== r.projectId ||
        q.expiresAt <= Date.now()
      )
        throw new CommerceError('QUOTE_EXPIRED');
      if (r.status === 'accepted' && q.status === 'accepted') return { accepted: true };
      if (
        r.status !== 'sent' ||
        q.status !== 'sent' ||
        !q.checks.map ||
        !q.checks.margin ||
        !q.checks.policy
      )
        throw new CommerceError('INVALID_INPUT');
      const checks = await checkQuoteLines(
        ctx,
        q.lines,
        r.channel === 'retail' ? 'retail' : 'house'
      );
      if (!checks.map || !checks.margin || !checks.policy)
        throw new CommerceError('COST_REVIEW_REQUIRED', 'Quote must be reviewed again');
      await computeManualQuote(ctx, q);
      await ctx.db.patch(q._id, {
        status: 'accepted',
        acceptedAt: Date.now(),
        acceptedBy: r.userId ?? `guest:${r._id}`,
      });
      await ctx.db.patch(r._id, { status: 'accepted', updatedAt: Date.now() });
      await audit(ctx, {
        actor: r.userId ?? `guest:${r._id}`,
        action: 'delivery.quote.customer_accept',
        entityTable: 'ordQuoteVersions',
        entityId: q._id,
      });
      return { accepted: true };
    }),
});
/** Customer closes only an unaccepted request; an accepted/payment order needs staff review. */
export const closeRequest = mutation({
  args: {
    id: v.id('dlvQuoteRequests'),
    guestCapability: v.optional(v.string()),
    outcome: v.union(v.literal('declined'), v.literal('cancelled')),
    reason: v.string(),
  },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      const r = await ctx.db.get(a.id);
      if (!r) throw new CommerceError('FORBIDDEN');
      await owns(ctx, r, a.guestCapability);
      if (a.reason.length > 2000) throw new CommerceError('INVALID_INPUT');
      if (r.status === a.outcome) return { status: r.status };
      if (['accepted', ...closedRequestStates].includes(r.status))
        throw new CommerceError(
          'INVALID_INPUT',
          'Contact support about an accepted or closed request'
        );
      const q = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
      if (q?.status === 'accepted' || q?.checkoutIntentId)
        throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED');
      if (a.outcome === 'declined' && !q) throw new CommerceError('INVALID_INPUT');
      if (q && ['draft', 'sent'].includes(q.status))
        await ctx.db.patch(q._id, { status: 'superseded' });
      await ctx.db.patch(r._id, { status: a.outcome, updatedAt: Date.now() });
      await audit(ctx, {
        actor: r.userId ?? `guest:${r._id}`,
        action: `delivery.quote.customer_${a.outcome}`,
        entityTable: 'dlvQuoteRequests',
        entityId: r._id,
        reason: a.reason,
      });
      return { status: a.outcome };
    }),
});
export const prepareCheckout = mutation({
  args: { id: v.id('dlvQuoteRequests'), guestCapability: v.optional(v.string()) },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      const r = await ctx.db.get(a.id);
      if (!r) throw new CommerceError('FORBIDDEN');
      await owns(ctx, r, a.guestCapability);
      if (r.channel === 'trade' && !isVerified((await viewer(ctx))?.profile ?? null))
        throw new CommerceError('TRADE_APPROVAL_REQUIRED');
      const q = r.quoteVersionId ? await ctx.db.get(r.quoteVersionId) : null;
      if (r.status !== 'accepted' || q?.status !== 'accepted' || q.projectId !== r.projectId)
        throw new CommerceError('QUOTE_EXPIRED');
      const out = await computeManualQuote(ctx, q);
      const token = capability(),
        now = Date.now();
      const expiresAt = Math.min(q.expiresAt, now + 30 * 60000);
      const total = out.merchandiseMinor + q.deliveryMinor + q.taxMinor;
      const previous = await ctx.db
        .query('dlvEstimates')
        .withIndex('by_manual_quote', (q0) => q0.eq('manualQuoteVersionId', q._id))
        .order('desc')
        .first();
      if (
        previous &&
        previous.expiresAt > now &&
        previous.sourceVersionsHash === out.sourceVersionsHash
      ) {
        if (!r.userId)
          await ctx.db.patch(previous._id, { guestCapabilityHash: await digest(token) });
        return {
          estimateId: previous._id,
          ...(!r.userId ? { guestCapability: token } : {}),
          lines: q.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            packs: l.packs,
          })),
          address: q.address!,
          service: q.service,
          acceptTotalMinor: total,
          email: r.email,
          expiresAt: previous.expiresAt,
        };
      }
      const id = await ctx.db.insert('dlvEstimates', {
        serviceTerms: out.serviceTerms,
        manualQuoteVersionId: q._id,
        channel: r.channel,
        destination: {
          zip: q.address!.postalCode,
          precision: 'full',
          addressHash: await digest(addressKey(q.address!)),
          state: q.address!.state,
        },
        service: q.service,
        lines: out.lines.map((l) => ({ variantId: l.variant._id, packs: l.packs })),
        groups: out.groups,
        status: 'ok',
        deliveryChargeMinor: q.deliveryMinor,
        merchandiseMinor: out.merchandiseMinor,
        discountMinor: 0,
        creditMinor: 0,
        taxMinor: q.taxMinor,
        totalMinor: total,
        expiresAt,
        cartHash: cartHash(q.lines, r.channel),
        sourceVersionsHash: out.sourceVersionsHash,
        internal: { manualQuoteId: q._id, configVersions: out.configVersions },
        ...(r.userId ? { userId: r.userId } : { guestCapabilityHash: await digest(token) }),
        createdAt: now,
      });
      return {
        estimateId: id,
        ...(!r.userId ? { guestCapability: token } : {}),
        lines: q.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          packs: l.packs,
        })),
        address: q.address!,
        service: q.service,
        acceptTotalMinor: total,
        email: r.email,
        expiresAt,
      };
    }),
});
export const recordInvoice = mutation({
  args: {
    supplierOrderId: v.id('ordSupplierOrders'),
    shipmentId: v.optional(v.id('ordShipments')),
    reference: v.string(),
    carrier: v.string(),
    baseMinor: v.number(),
    fuelMinor: v.number(),
    accessorialMinor: v.number(),
    supplierFeeMinor: v.number(),
    creditMinor: v.number(),
    evidence: v.string(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const order = await ctx.db.get(a.supplierOrderId);
    if (!order) throw new CommerceError('INVALID_INPUT');
    if (a.shipmentId && (await ctx.db.get(a.shipmentId))?.supplierOrderId !== order._id)
      throw new CommerceError('INVALID_INPUT');
    for (const n of [
      a.baseMinor,
      a.fuelMinor,
      a.accessorialMinor,
      a.supplierFeeMinor,
      a.creditMinor,
    ])
      if (!Number.isSafeInteger(n) || n < 0) throw new CommerceError('INVALID_INPUT');
    if (
      !a.reference.trim() ||
      !a.carrier.trim() ||
      !a.evidence.trim() ||
      a.reference.length > 200 ||
      a.carrier.length > 200 ||
      a.evidence.length > 2000 ||
      a.note.length > 2000
    )
      throw new CommerceError('INVALID_INPUT');
    const totalMinor =
      a.baseMinor + a.fuelMinor + a.accessorialMinor + a.supplierFeeMinor - a.creditMinor;
    if (!Number.isSafeInteger(totalMinor)) throw new CommerceError('INVALID_INPUT');
    if (totalMinor < 0) {
      const priorInvoices = await ctx.db
        .query('dlvFreightInvoices')
        .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', a.supplierOrderId))
        .collect();
      const same = priorInvoices.find(
        (i) =>
          i.reference.trim().toLowerCase() === a.reference.trim().toLowerCase() &&
          i.carrier.trim().toLowerCase() === a.carrier.trim().toLowerCase()
      );
      if (
        !a.note.trim() ||
        priorInvoices.reduce((n, i) => n + i.totalMinor, 0) + (same ? 0 : totalMinor) < 0
      )
        throw new CommerceError(
          'INVALID_INPUT',
          'Credit needs an explanation and cannot exceed recorded supplier-order expense'
        );
    }
    const invoiceKey = await digest({
      supplierOrderId: a.supplierOrderId,
      carrier: a.carrier.trim().toLowerCase(),
      reference: a.reference.trim().toLowerCase(),
    });
    const old = await ctx.db
      .query('dlvFreightInvoices')
      .withIndex('by_invoice', (q) => q.eq('invoiceKey', invoiceKey))
      .unique();
    if (old) {
      for (const k of [
        'baseMinor',
        'fuelMinor',
        'accessorialMinor',
        'supplierFeeMinor',
        'creditMinor',
      ] as const)
        if (old[k] !== a[k])
          throw new CommerceError(
            'INVALID_INPUT',
            'Invoice already recorded with different amounts'
          );
      return old._id;
    }
    const id = await ctx.db.insert('dlvFreightInvoices', {
      ...a,
      invoiceKey,
      totalMinor,
      currency: 'USD',
      createdBy: actor.email,
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.invoice.record',
      entityTable: 'dlvFreightInvoices',
      entityId: id,
      reason: a.note,
    });
    return id;
  },
});
export const invoices = query({
  args: { supplierOrderId: v.id('ordSupplierOrders') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    return ctx.db
      .query('dlvFreightInvoices')
      .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', a.supplierOrderId))
      .collect();
  },
});
export const explain = query({
  args: { estimateId: v.id('dlvEstimates') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    const e = await ctx.db.get(a.estimateId);
    if (!e) return null;
    const { guestCapabilityHash: _secret, ...safe } = e;
    void _secret;
    return safe;
  },
});

export const quoteDetail = query({
  args: { id: v.id('dlvQuoteRequests') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    const r = await ctx.db.get(a.id);
    if (!r) return null;
    const project = await ctx.db.get(r.projectId);
    const versions = await ctx.db
      .query('ordQuoteVersions')
      .withIndex('by_project_version', (q) => q.eq('projectId', r.projectId))
      .order('desc')
      .take(50);
    const { guestCapabilityHash: _secret, ...request } = r;
    void _secret;
    const groups = new Map<string, { supplierCode: string; originZip: string }>();
    for (const l of r.lines) {
      const id = ctx.db.normalizeId('catVariants', l.variantId);
      const cv = id ? await ctx.db.get(id) : null;
      if (!cv) continue;
      const supplier = await ctx.db.get(cv.supplierId),
        warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
      const supplierCode = supplier?.code ?? 'unknown',
        originZip =
          warehouse?.active && warehouse.supplierId === cv.supplierId ? warehouse.originZip : '';
      groups.set(`${supplierCode}:${originZip}`, { supplierCode, originZip });
    }
    return { request, lines: project?.lines ?? [], versions, groups: [...groups.values()] };
  },
});

/** Comparison uses frozen customer delivery revenue; recording expenses never reprices an order. */
export const reconciliation = query({
  args: { supplierOrderId: v.id('ordSupplierOrders') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    const child = await ctx.db.get(a.supplierOrderId);
    if (!child) return null;
    const order = await ctx.db.get(child.orderId);
    const intent = order?.intentId ? await ctx.db.get(order.intentId) : null;
    const estimate = intent ? await ctx.db.get(intent.estimateId) : null;
    const invoices = await ctx.db
      .query('dlvFreightInvoices')
      .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', child._id))
      .collect();
    const groups =
      estimate?.groups.filter(
        (g) =>
          g.supplierCode === child.supplierCode &&
          (!child.warehouseCode ||
            g.groupKey === 'ashcroft' ||
            g.groupKey === `${child.supplierCode}:${child.warehouseCode}:${child.service}`)
      ) ?? [];
    const allocations = await ctx.db
      .query('ordAllocations')
      .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', child._id))
      .collect();
    const lines = await Promise.all(allocations.map((a) => ctx.db.get(a.orderLineId)));
    const customerDeliveryMinor = lines.reduce((n, l) => n + (l?.deliveryAllocMinor ?? 0), 0);
    const estimatedFreightMinor = groups.length
      ? groups.reduce((n, g) => n + g.freightMinor, 0)
      : null;
    const actualFreightMinor = invoices.length
      ? invoices.reduce(
          (n, i) => n + i.baseMinor + i.fuelMinor + i.accessorialMinor - i.creditMinor,
          0
        )
      : null;
    const actualSupplierFeeMinor = invoices.length
      ? invoices.reduce((n, i) => n + i.supplierFeeMinor, 0)
      : null;
    return {
      orderNumber: order?.number,
      supplierCode: child.supplierCode,
      invoices,
      customerDeliveryMinor,
      estimatedFreightMinor,
      estimatedSubsidyMinor: groups.reduce((n, g) => n + g.subsidyMinor, 0),
      actualFreightMinor,
      actualSupplierFeeMinor,
      freightVarianceMinor:
        actualFreightMinor !== null && estimatedFreightMinor !== null
          ? actualFreightMinor - estimatedFreightMinor
          : null,
      note: 'Freight variance only. Complete actual contribution also requires merchandise, payment expenses, refunds and commissions. No customer charge is changed.',
    };
  },
});

async function actualSources(ctx: QueryCtx | MutationCtx, orderId: Doc<'ordOrders'>['_id']) {
  const children = await ctx.db
    .query('ordSupplierOrders')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))
    .collect();
  const invoices = (
    await Promise.all(
      children.map((c) =>
        ctx.db
          .query('dlvFreightInvoices')
          .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', c._id))
          .collect()
      )
    )
  ).flat();
  const refunds = await ctx.db
    .query('dlvTaxRefundReviews')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))
    .unique();
  const sourceHash = await digest({
    children: children.map((c) => c._id),
    invoices: invoices.map((i) => i._id).sort(),
    refundMinor: refunds?.confirmedRefundMinor ?? 0,
  });
  return { children, invoices, sourceHash };
}
const expenseFields = [
  'wholesaleMinor',
  'dutiesMinor',
  'inboundMinor',
  'otherSupplierFeesMinor',
  'paymentMinor',
  'commissionMinor',
  'overheadMinor',
  'returnLossMinor',
  'advertisingMinor',
] as const;
export const recordActualCosts = mutation({
  args: {
    orderId: v.id('ordOrders'),
    wholesaleMinor: v.number(),
    dutiesMinor: v.number(),
    inboundMinor: v.number(),
    otherSupplierFeesMinor: v.number(),
    paymentMinor: v.number(),
    commissionMinor: v.number(),
    overheadMinor: v.number(),
    returnLossMinor: v.number(),
    advertisingMinor: v.number(),
    recoveriesMinor: v.number(),
    merchandiseRefundMinor: v.number(),
    deliveryRefundMinor: v.number(),
    freightFinal: v.boolean(),
    evidence: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance'),
      order = await ctx.db.get(a.orderId);
    if (
      !order ||
      !a.evidence.trim() ||
      a.evidence.length > 4000 ||
      [...expenseFields, 'recoveriesMinor', 'merchandiseRefundMinor', 'deliveryRefundMinor'].some(
        (k) => !Number.isSafeInteger(a[k as keyof typeof a]) || Number(a[k as keyof typeof a]) < 0
      )
    )
      throw new CommerceError('INVALID_INPUT');
    if (
      a.merchandiseRefundMinor >
        order.totals.merchandise - order.totals.discount - order.totals.credit ||
      a.deliveryRefundMinor > order.totals.delivery
    )
      throw new CommerceError('INVALID_INPUT', 'Refund allocations exceed paid revenue');
    const sources = await actualSources(ctx, a.orderId);
    if (
      a.freightFinal &&
      sources.children.some((c) => !sources.invoices.some((i) => i.supplierOrderId === c._id))
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Every supplier order needs an invoice or confirmed zero invoice'
      );
    const previous = await ctx.db
      .query('dlvActualCostStatements')
      .withIndex('by_order', (q) => q.eq('orderId', a.orderId))
      .order('desc')
      .first();
    if (
      previous &&
      previous.sourceHash === sources.sourceHash &&
      Object.entries(a).every(([k, v]) => previous[k as keyof typeof previous] === v)
    )
      return previous._id;
    const id = await ctx.db.insert('dlvActualCostStatements', {
      ...a,
      sourceHash: sources.sourceHash,
      createdBy: actor.email,
      createdAt: Date.now(),
    });
    const revenue =
      order.totals.merchandise -
      order.totals.discount -
      order.totals.credit +
      order.totals.delivery -
      a.merchandiseRefundMinor -
      a.deliveryRefundMinor;
    const contribution =
      revenue -
      expenseFields.reduce((n, k) => n + a[k], 0) -
      sources.invoices.reduce((n, i) => n + i.totalMinor, 0) +
      a.recoveriesMinor;
    if (a.freightFinal && contribution < 0)
      await openReview(
        ctx,
        'negative_actual_contribution',
        'ordOrders',
        order._id,
        'Final recorded actual costs exceed net merchandise and delivery revenue. Review pricing/rates; do not recharge the customer.'
      );
    const intent = order.intentId ? await ctx.db.get(order.intentId) : null;
    const frozen = intent?.lineSnapshot as
      | { unitPackMinor: number; packs: number; creditMinor: number; marginFloorBps?: number }[]
      | undefined;
    if (a.freightFinal && frozen?.length && frozen.every((l) => l.marginFloorBps != null)) {
      const originalNet = frozen.reduce((n, l) => n + l.unitPackMinor * l.packs - l.creditMinor, 0);
      const weightedFloor = frozen.reduce(
        (n, l) => n + (l.unitPackMinor * l.packs - l.creditMinor) * l.marginFloorBps!,
        0
      );
      const remainingNet = originalNet - a.merchandiseRefundMinor;
      if (originalNet > 0 && contribution * 10000 < (weightedFloor * remainingNet) / originalNet)
        await openReview(
          ctx,
          'actual_contribution_below_floor',
          'ordOrders',
          order._id,
          'Actual contribution is below the frozen merchandise-weighted floor (proportionately adjusted for refunds). Review line-level refunds and pricing internally; do not recharge the customer.'
        );
    }
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.actual_costs.record',
      entityTable: 'dlvActualCostStatements',
      entityId: id,
      reason: a.evidence,
    });
    return id;
  },
});
export const actualContribution = query({
  args: { orderId: v.id('ordOrders') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    const order = await ctx.db.get(a.orderId);
    if (!order) return null;
    const sources = await actualSources(ctx, a.orderId);
    const statement = await ctx.db
      .query('dlvActualCostStatements')
      .withIndex('by_order', (q) => q.eq('orderId', a.orderId))
      .order('desc')
      .first();
    const complete = !!statement?.freightFinal && statement.sourceHash === sources.sourceHash;
    if (!statement)
      return {
        orderNumber: order.number,
        complete: false,
        contributionMinor: null,
        note: 'Record every actual expense; unknown expenses are not zero.',
      };
    const merchandise =
      order.totals.merchandise -
      order.totals.discount -
      order.totals.credit -
      statement.merchandiseRefundMinor;
    const revenue = merchandise + order.totals.delivery - statement.deliveryRefundMinor;
    const freightAndSupplierFeesMinor = sources.invoices.reduce((n, i) => n + i.totalMinor, 0);
    const expenses =
      expenseFields.reduce((n, k) => n + statement[k], 0) +
      freightAndSupplierFeesMinor -
      statement.recoveriesMinor;
    return {
      orderNumber: order.number,
      complete,
      statement,
      freightAndSupplierFeesMinor,
      netRevenueMinor: revenue,
      expenseMinor: expenses,
      contributionMinor: complete ? revenue - expenses : null,
      contributionBps:
        complete && merchandise > 0
          ? Math.floor(((revenue - expenses) * 10000) / merchandise)
          : null,
      note: complete
        ? 'Actual recorded contribution includes allocated overhead and advertising. Delivery allowance is not deducted again.'
        : 'Provisional: freight is not final or new invoices/refunds require an updated statement.',
    };
  },
});

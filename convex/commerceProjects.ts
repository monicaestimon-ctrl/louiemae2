import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query, mutation, internalQuery, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { address, channel } from './commerceTables';
import { checkQuantity, totalLines, cents } from '../lib/commerce';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { listingReady } from './commerceReadiness';

const selection = v.object({
  productId: v.id('commerceProducts'),
  variantId: v.string(),
  quantity: v.number(),
  unitPrice: v.optional(v.number()),
});
async function resolveLines(
  ctx: MutationCtx,
  selections: {
    productId: Id<'commerceProducts'>;
    variantId: string;
    quantity: number;
    unitPrice?: number;
  }[],
  destination: 'retail' | 'house',
  admin: boolean
): Promise<Doc<'commerceProjects'>['lines']> {
  if (!selections.length || selections.length > 50) throw new Error('Select 1–50 items.');
  const seen = new Set<string>();
  return Promise.all(
    selections.map(async (s) => {
      const key = `${s.productId}:${s.variantId}`;
      if (seen.has(key)) throw new Error('Combine duplicate variants into one line.');
      seen.add(key);
      const product = await ctx.db.get(s.productId);
      const listing = await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) =>
          q.eq('productId', s.productId).eq('channel', destination)
        )
        .unique();
      const variant = listing?.snapshot.variants.find((v) => v.id === s.variantId);
      const route = listing?.fulfillment?.find((v) => v.id === s.variantId);
      if (!product || !listing?.published || !variant || !route)
        throw new Error('An item is unavailable. Refresh the selection.');
      if (!(await listingReady(ctx, product, listing)))
        throw new Error('An item requires supplier mapping or availability review.');
      checkQuantity(s.quantity, variant);
      return {
        productId: product._id,
        variantId: variant.id,
        name: listing.snapshot.name,
        variantName: variant.name,
        quantity: s.quantity,
        unitPrice: admin && s.unitPrice !== undefined ? cents(s.unitPrice) : variant.price,
        provider: product.provider,
        sku: route.sku,
        ...(product.cjProductId ? { cjProductId: product.cjProductId } : {}),
        ...(route.cjVariantId ? { cjVariantId: route.cjVariantId } : {}),
        ...(route.cjSku ? { cjSku: route.cjSku } : {}),
      };
    })
  );
}
export const submit = mutation({
  args: {
    token: v.string(),
    channel,
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    business: v.string(),
    address,
    notes: v.string(),
    website: v.string(),
    items: v.array(selection),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (
      args.website ||
      !/^[\w-]{20,80}$/.test(args.token) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !args.name.trim() ||
      args.name.length > 150 ||
      args.notes.length > 3000 ||
      args.phone.length > 60 ||
      args.business.length > 200 ||
      JSON.stringify(args.address).length > 2000
    )
      throw new Error('Please check your contact information.');
    const old = await ctx.db
      .query('commerceProjects')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (old) {
      if (old.email !== email) throw new Error('Refresh the form.');
      return old._id;
    }
    const recent = await ctx.db
      .query('commerceProjects')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .take(3);
    if (recent.length === 3 && recent[2].createdAt > Date.now() - 3600000)
      throw new Error('Please wait before submitting another request.');
    const lines = await resolveLines(ctx, args.items, args.channel, false);
    totalLines(lines, 0, 0);
    const id = await ctx.db.insert('commerceProjects', {
      token: args.token,
      channel: args.channel,
      name: args.name.trim(),
      email,
      phone: args.phone,
      business: args.business,
      address: args.address,
      notes: args.notes,
      requested: lines,
      lines,
      delivery: 0,
      tax: 0,
      revision: 1,
      status: 'requested',
      customerEmailStatus: 'queued',
      ownerEmailStatus: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const audience of ['owner', 'customer'] as const)
      await ctx.scheduler.runAfter(0, internal.commerceEmail.deliver, { id, audience, attempt: 0 });
    return id;
  },
});
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('commerceProjects').order('desc').paginate(args.paginationOpts);
  },
});
export const get = query({
  args: { id: v.id('commerceProjects') },
  handler: async (ctx, { id }) => {
    await requireCjAdminIdentity(ctx);
    const groups = await ctx.db
      .query('commerceFulfillments')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    return {
      project: await ctx.db.get(id),
      groups: await Promise.all(
        groups.map(async (g) => ({ ...g, order: g.orderId ? await ctx.db.get(g.orderId) : null }))
      ),
    };
  },
});
export const record = internalQuery({
  args: { id: v.id('commerceProjects') },
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const emailStatus = internalMutation({
  args: {
    id: v.id('commerceProjects'),
    audience: v.union(v.literal('owner'), v.literal('customer')),
    status: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.patch(
      a.id,
      a.audience === 'owner' ? { ownerEmailStatus: a.status } : { customerEmailStatus: a.status }
    );
  },
});
export const retryEmail = mutation({
  args: { id: v.id('commerceProjects') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const p = await ctx.db.get(a.id);
    if (!p) throw new Error('Request missing.');
    for (const audience of ['owner', 'customer'] as const)
      if ((audience === 'owner' ? p.ownerEmailStatus : p.customerEmailStatus) !== 'sent')
        await ctx.scheduler.runAfter(0, internal.commerceEmail.deliver, {
          ...a,
          audience,
          attempt: 0,
        });
  },
});
export const save = mutation({
  args: {
    id: v.id('commerceProjects'),
    revision: v.number(),
    items: v.array(selection),
    delivery: v.number(),
    tax: v.number(),
    address,
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    const p = await ctx.db.get(args.id);
    if (
      !p ||
      p.revision !== args.revision ||
      p.stripeInvoiceId ||
      !['requested', 'draft', 'accepted'].includes(p.status)
    )
      throw new Error(
        'Quote changed or has an invoice. Reload or void the unpaid invoice before editing.'
      );
    const lines = await resolveLines(ctx, args.items, p.channel, true);
    totalLines(lines, args.delivery, args.tax);
    if (args.notes.length > 3000 || JSON.stringify(args.address).length > 2000)
      throw new Error('Please shorten the project details.');
    await ctx.db.patch(p._id, {
      lines,
      delivery: args.delivery,
      tax: args.tax,
      address: args.address,
      notes: args.notes,
      revision: p.revision + 1,
      status: 'draft',
      acceptance: undefined,
      readiness: undefined,
      maxCjCost: undefined,
      cjLogistics: undefined,
      cjApprovedUntil: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: `quote_revision:${JSON.stringify(p.lines)}`,
      revision: p.revision,
      createdAt: Date.now(),
    });
  },
});
export const accept = mutation({
  args: {
    id: v.id('commerceProjects'),
    revision: v.number(),
    acceptance: v.string(),
    readiness: v.string(),
    maxCjCost: v.number(),
    cjLogistics: v.string(),
    cjApprovedUntil: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    const p = await ctx.db.get(args.id);
    if (
      !p ||
      p.revision !== args.revision ||
      p.stripeInvoiceId ||
      !['draft', 'requested'].includes(p.status)
    )
      throw new Error('Save the current quote before recording acceptance.');
    if (
      args.acceptance.trim().length < 8 ||
      args.readiness.trim().length < 8 ||
      args.acceptance.length > 2000 ||
      args.readiness.length > 3000
    )
      throw new Error('Record customer acceptance and supply/delivery/tax checks.');
    if (
      !p.address.line1.trim() ||
      !p.address.city.trim() ||
      !p.address.postalCode.trim() ||
      !/^[A-Z]{2}$/.test(p.address.country) ||
      !p.phone.trim()
    )
      throw new Error(
        'Complete delivery address, two-letter country code and customer phone before invoicing.'
      );
    const total = totalLines(p.lines, p.delivery, p.tax);
    if (total <= 0) throw new Error('Invoice total must be positive.');
    if (
      p.lines.some((l) => l.provider === 'cj') &&
      (args.maxCjCost <= 0 ||
        !args.cjLogistics.trim() ||
        args.cjApprovedUntil <= Date.now() ||
        args.cjApprovedUntil > Date.now() + 7 * 86400000)
    )
      throw new Error(
        'CJ requires a supplier-spend ceiling, confirmed logistics service and approval expiring within seven days.'
      );
    cents(args.maxCjCost);
    await ctx.db.patch(p._id, {
      status: 'accepted',
      acceptance: args.acceptance,
      readiness: args.readiness,
      maxCjCost: args.maxCjCost,
      cjLogistics: args.cjLogistics,
      cjApprovedUntil: args.cjApprovedUntil,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: 'customer_acceptance_and_supply_review',
      revision: p.revision,
      createdAt: Date.now(),
    });
  },
});
export const claimInvoice = internalMutation({
  args: { id: v.id('commerceProjects'), revision: v.number() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.id);
    if (
      !p ||
      p.revision !== args.revision ||
      !['accepted', 'invoicing', 'invoiced'].includes(p.status)
    )
      throw new Error('Record acceptance before invoicing.');
    await ctx.db.patch(p._id, {
      invoiceAttemptAt: p.invoiceAttemptAt || Date.now(),
      status: p.stripeInvoiceId ? p.status : 'invoicing',
      updatedAt: Date.now(),
    });
    return p;
  },
});
export const invoiceState = internalMutation({
  args: {
    id: v.id('commerceProjects'),
    revision: v.number(),
    invoiceId: v.string(),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    sent: v.boolean(),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p || p.revision !== a.revision || (p.stripeInvoiceId && p.stripeInvoiceId !== a.invoiceId))
      throw new Error('Invoice revision mismatch.');
    if (p.paidAt) return;
    await ctx.db.patch(p._id, {
      stripeInvoiceId: a.invoiceId,
      invoiceUrl: a.url,
      invoiceError: a.error,
      status: a.sent ? 'invoiced' : 'invoicing',
      updatedAt: Date.now(),
    });
  },
});
export const voided = internalMutation({
  args: { id: v.id('commerceProjects'), invoiceId: v.string(), actor: v.string() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p || p.stripeInvoiceId !== a.invoiceId || p.paidAt)
      throw new Error('Invoice state changed. Reconcile payment before editing.');
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: a.actor,
      action: JSON.stringify({
        event: 'invoice_voided',
        invoice: a.invoiceId,
        lines: p.lines,
        delivery: p.delivery,
        tax: p.tax,
      }),
      revision: p.revision,
      createdAt: Date.now(),
    });
    await ctx.db.patch(p._id, {
      status: 'draft',
      revision: p.revision + 1,
      stripeInvoiceId: undefined,
      invoiceAttemptAt: undefined,
      invoiceUrl: undefined,
      invoiceError: undefined,
      acceptance: undefined,
      readiness: undefined,
      maxCjCost: undefined,
      cjLogistics: undefined,
      cjApprovedUntil: undefined,
      updatedAt: Date.now(),
    });
  },
});
export const paid = internalMutation({
  args: {
    id: v.id('commerceProjects'),
    revision: v.number(),
    invoiceId: v.string(),
    amount: v.number(),
    currency: v.string(),
    paymentIntentIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.id);
    if (
      !p ||
      p.stripeInvoiceId !== args.invoiceId ||
      p.revision !== args.revision ||
      args.currency !== 'usd' ||
      args.amount !== totalLines(p.lines, p.delivery, p.tax) ||
      !args.paymentIntentIds.length
    )
      throw new Error('Payment does not match the active approved invoice.');
    if (p.paidAt) return;
    for (const paymentIntentId of args.paymentIntentIds)
      await ctx.db.insert('commercePaymentLinks', { paymentIntentId, projectId: p._id });
    await ctx.db.patch(p._id, {
      status: 'paid',
      paidAt: Date.now(),
      paymentIntentIds: args.paymentIntentIds,
      updatedAt: Date.now(),
    });
    for (const provider of [...new Set(p.lines.map((l) => l.provider))]) {
      const groupId = await ctx.db.insert('commerceFulfillments', {
        projectId: p._id,
        provider,
        status:
          provider === 'cj'
            ? 'queued'
            : provider === 'ashcroft'
              ? 'needs_dealer_order'
              : 'owner_managed',
        note: '',
        updatedAt: Date.now(),
      });
      if (provider === 'cj')
        await ctx.scheduler.runAfter(0, internal.commerceFulfillment.dispatch, { id: groupId });
    }
  },
});
export const paymentHold = internalMutation({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, a) => {
    const links = await ctx.db
      .query('commercePaymentLinks')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId))
      .collect();
    for (const link of links) {
      const p = await ctx.db.get(link.projectId);
      if (!p || p.status === 'payment_review') continue;
      const note =
        'A refund or dispute was verified. Supplier cancellation is not automatic. Reconcile the payment and contact any supplier with an existing order before further fulfillment.';
      await ctx.db.patch(p._id, {
        status: 'payment_review',
        invoiceError: note,
        updatedAt: Date.now(),
      });
      const groups = await ctx.db
        .query('commerceFulfillments')
        .withIndex('by_project', (q) => q.eq('projectId', p._id))
        .collect();
      for (const g of groups) {
        await ctx.db.patch(g._id, { status: 'needs_attention', note, updatedAt: Date.now() });
        if (g.orderId) await ctx.db.patch(g.orderId, { commercialHold: note });
      }
      await ctx.db.insert('commerceAudit', {
        entityId: p._id,
        actor: 'stripe',
        action: `payment_reversal:${a.paymentIntentId}`,
        revision: p.revision,
        createdAt: Date.now(),
      });
    }
  },
});
export const manualProgress = mutation({
  args: {
    id: v.id('commerceFulfillments'),
    status: v.union(
      v.literal('ordered'),
      v.literal('shipped'),
      v.literal('delivered'),
      v.literal('hold')
    ),
    reference: v.string(),
    tracking: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    const g = await ctx.db.get(args.id);
    if (!g || g.provider === 'cj') throw new Error('Use CJ exception handling for this group.');
    const project = await ctx.db.get(g.projectId);
    if (project?.status === 'payment_review' && args.status !== 'hold')
      throw new Error('Payment reversal requires reconciliation before further fulfillment.');
    if (args.status !== 'hold' && !args.reference.trim())
      throw new Error('Record the supplier/order reference.');
    if (args.status === 'shipped' && !args.tracking.trim())
      throw new Error('Record shipment details.');
    await ctx.db.patch(g._id, {
      status: args.status,
      supplierReference: args.reference,
      tracking: args.tracking,
      note: args.note.slice(0, 3000),
      updatedAt: Date.now(),
    });
    await ctx.db.insert('commerceAudit', {
      entityId: g._id,
      actor: actor.email,
      action: `manual:${args.status}`,
      revision: 1,
      createdAt: Date.now(),
    });
  },
});

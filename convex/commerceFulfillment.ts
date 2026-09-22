import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import {
  evaluateProductCjReadiness,
  evaluateCheckoutItemCjReadiness,
} from '../lib/cjFulfillmentReadiness';
import { totalLines } from '../lib/commerce';
export const prepare = internalMutation({
  args: { id: v.id('commerceFulfillments') },
  handler: async (ctx, { id }) => {
    const g = await ctx.db.get(id);
    if (!g || g.provider !== 'cj' || g.status !== 'queued') return null;
    const p = await ctx.db.get(g.projectId);
    if (!p?.paidAt || p.status !== 'paid')
      throw new Error('Customer payment not verified or is under review.');
    const hold = async (note: string) => {
      await ctx.db.patch(g._id, { status: 'needs_attention', note, updatedAt: Date.now() });
      return null;
    };
    if (new Set(p.lines.map((l) => l.provider)).size > 1 && !p.coordinatedRelease)
      return hold('Mixed-provider project requires coordinated release review.');
    const mixed = new Set(p.lines.map((l) => l.provider)).size > 1;
    if (mixed && p.cjShippingAllowance === undefined)
      return hold('Allocate the CJ share of the customer delivery charge before release.');
    const shipping = mixed ? p.cjShippingAllowance! : p.delivery;
    const tax = mixed ? 0 : p.tax;
    if (
      process.env.CJ_AUTO_FULFILLMENT_ENABLED !== 'true' ||
      process.env.CJ_AUTO_BALANCE_PAY_ENABLED !== 'true'
    )
      return hold('CJ fulfillment and supplier balance payment must both be enabled and funded.');
    if (!p.cjApprovedUntil || p.cjApprovedUntil < Date.now())
      return hold('Supplier availability/delivery approval expired. Reconfirm before release.');
    if (!p.maxCjCost || !p.cjLogistics)
      return hold('CJ supplier-spend ceiling and delivery service are required.');
    const lines = p.lines.filter((l) => l.provider === 'cj');
    const items = [];
    for (const l of lines) {
      const product = l.cjProductId ? await ctx.db.get(l.cjProductId) : null;
      if (
        !product ||
        !evaluateCheckoutItemCjReadiness(
          product,
          { variantId: l.variantId, quantity: l.quantity },
          { strictInventory: true }
        ).ready
      )
        return hold(`CJ product requires mapping/readiness review: ${l.name}.`);
      const v = product.variants?.length
        ? product.variants.find((v) => v.id === l.variantId)
        : product;
      if (!v || v.cjVariantId !== l.cjVariantId || v.cjSku !== l.cjSku)
        return hold(`The paid variant mapping changed: ${l.name} / ${l.variantName}.`);
      items.push({
        productId: product._id,
        variantId: l.variantId,
        variantName: l.variantName,
        name: l.name,
        price: l.unitPrice / 100,
        quantity: l.quantity,
        cjVariantId: l.cjVariantId,
        cjSku: l.cjSku,
      });
    }
    let orderId = g.orderId;
    if (!orderId) {
      orderId = await ctx.db.insert('orders', {
        stripeInvoiceId: p.stripeInvoiceId,
        commercialMaxSupplierCents: p.maxCjCost,
        commercialLogistics: p.cjLogistics,
        commercialApprovedUntil: p.cjApprovedUntil,
        customerEmail: p.email,
        customerName: p.name,
        customerPhone: p.phone,
        items,
        subtotal: totalLines(lines, 0, 0) / 100,
        shipping: shipping / 100,
        tax: tax / 100,
        total: totalLines(lines, shipping, tax) / 100,
        currency: 'usd',
        status: 'paid',
        shippingAddress: p.address,
        cjStatus: 'pending',
        cjFulfillmentStep: 'not_started',
        cjPaymentStatus: 'not_started',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    await ctx.db.patch(g._id, { status: 'dispatching', orderId, note: '', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(15 * 60000, internal.commerceFulfillment.expireDispatch, {
      id: g._id,
    });
    return { orderId, project: p, items, shipping };
  },
});
export const expireDispatch = internalMutation({
  args: { id: v.id('commerceFulfillments') },
  handler: async (ctx, { id }) => {
    const g = await ctx.db.get(id);
    if (g?.status === 'dispatching')
      await ctx.db.patch(id, {
        status: 'needs_attention',
        note: 'Supplier request timed out. Reconcile the saved order in CJ Control Room before retrying.',
        updatedAt: Date.now(),
      });
  },
});
export const outcome = internalMutation({
  args: { id: v.id('commerceFulfillments'), success: v.boolean(), note: v.string() },
  handler: async (ctx, a) => {
    const g = await ctx.db.get(a.id),
      p = g ? await ctx.db.get(g.projectId) : null;
    if (!g || p?.status !== 'paid' || g.status === 'submitted') return;
    await ctx.db.patch(a.id, {
      status: a.success ? 'submitted' : 'needs_attention',
      note: a.note,
      updatedAt: Date.now(),
    });
  },
});
export const dispatch = internalAction({
  args: { id: v.id('commerceFulfillments') },
  handler: async (ctx, { id }) => {
    const pending = await ctx.runQuery(internal.commerceFulfillment.pendingProject, { id });
    if (!pending) return;
    if (
      process.env.CJ_AUTO_FULFILLMENT_ENABLED === 'true' &&
      process.env.CJ_AUTO_BALANCE_PAY_ENABLED === 'true'
    ) {
      try {
        for (const productId of [
          ...new Set(
            pending.lines
              .filter((l) => l.provider === 'cj')
              .map((l) => l.cjProductId)
              .filter(Boolean)
          ),
        ]) {
          const refreshed = await ctx.runAction(internal.cjDropshipping.refreshProductInventory, {
            productId,
            source: 'checkout',
          });
          if (refreshed.errors || !refreshed.updated) throw new Error('Inventory not confirmed');
        }
      } catch {
        await ctx.runMutation(internal.commerceFulfillment.outcome, {
          id,
          success: false,
          note: 'Fresh CJ inventory could not be confirmed. Review quantity and stock, then retry.',
        });
        return;
      }
    }
    const ready = await ctx.runMutation(internal.commerceFulfillment.prepare, { id });
    if (!ready) return;
    try {
      const result = await ctx.runAction(internal.cjDropshipping.createCjOrder, {
        orderId: ready.orderId,
        orderNumber: ready.project.stripeInvoiceId!.slice(-12).toUpperCase(),
        customerName: ready.project.name,
        customerPhone: ready.project.phone,
        customerEmail: ready.project.email,
        shippingAddress: ready.project.address,
        products: ready.items.map((l) => ({
          vid: l.cjVariantId,
          sku: l.cjSku,
          quantity: l.quantity,
          retailPrice: l.price,
        })),
        customerShippingCollected: ready.shipping / 100,
        orderSubtotal:
          totalLines(
            ready.project.lines.filter((l) => l.provider === 'cj'),
            0,
            0
          ) / 100,
        commercialMaxSupplierCents: ready.project.maxCjCost,
        commercialLogistics: ready.project.cjLogistics,
      });
      await ctx.runMutation(internal.commerceFulfillment.outcome, {
        id,
        success: result.success,
        note: result.error || '',
      });
    } catch {
      await ctx.runMutation(internal.commerceFulfillment.outcome, {
        id,
        success: false,
        note: 'Supplier outcome needs reconciliation. Check the existing CJ order before retrying.',
      });
    }
  },
});
export const pendingProject = internalQuery({
  args: { id: v.id('commerceFulfillments') },
  handler: async (ctx, { id }) => {
    const g = await ctx.db.get(id);
    if (!g || g.provider !== 'cj' || g.status !== 'queued') return null;
    const p = await ctx.db.get(g.projectId);
    return p?.paidAt && p.status === 'paid' ? p : null;
  },
});
export const retry = mutation({
  args: { id: v.id('commerceFulfillments') },
  handler: async (ctx, { id }) => {
    await requireCjAdminIdentity(ctx);
    const g = await ctx.db.get(id);
    if (!g || g.provider !== 'cj' || g.status !== 'needs_attention')
      throw new Error('This group is not awaiting resolution.');
    const project = await ctx.db.get(g.projectId);
    if (project?.status !== 'paid')
      throw new Error('Resolve the payment review before any supplier release.');
    const o = g.orderId ? await ctx.db.get(g.orderId) : null;
    if (o && (o.cjOrderId || o.cjFulfillmentStep !== 'not_started'))
      throw new Error(
        'An existing supplier attempt must be reconciled in CJ Control Room before another dispatch.'
      );
    await ctx.db.patch(id, { status: 'queued', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.commerceFulfillment.dispatch, { id });
  },
});

export const review = mutation({
  args: {
    id: v.id('commerceFulfillments'),
    evidence: v.string(),
    maxCjCost: v.number(),
    logistics: v.string(),
    expires: v.number(),
    adoptVerifiedMappings: v.boolean(),
    coordinatedRelease: v.boolean(),
    cjShippingAllowance: v.number(),
  },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx);
    const g = await ctx.db.get(a.id);
    const p = g ? await ctx.db.get(g.projectId) : null;
    if (
      !g ||
      g.provider !== 'cj' ||
      !p?.paidAt ||
      g.status !== 'needs_attention' ||
      g.orderId ||
      p.status !== 'paid'
    )
      throw new Error(
        'An existing CJ attempt must be reconciled before changing its release instructions.'
      );
    if (
      a.evidence.trim().length < 12 ||
      a.evidence.length > 3000 ||
      !Number.isSafeInteger(a.maxCjCost) ||
      a.maxCjCost <= 0 ||
      a.maxCjCost > 100000000 ||
      !a.logistics.trim() ||
      a.expires <= Date.now() ||
      a.expires > Date.now() + 7 * 86400000
    )
      throw new Error(
        'Record same-item evidence, confirmed delivery service, spend ceiling and expiry within seven days.'
      );
    const lines = [];
    if (
      !Number.isSafeInteger(a.cjShippingAllowance) ||
      a.cjShippingAllowance < 0 ||
      a.cjShippingAllowance > p.delivery
    )
      throw new Error(
        'CJ delivery allocation must be between zero and the total customer delivery charge.'
      );
    for (const line of p.lines) {
      if (line.provider !== 'cj' || !a.adoptVerifiedMappings) {
        lines.push(line);
        continue;
      }
      const source = line.cjProductId ? await ctx.db.get(line.cjProductId) : null;
      const mapped = source?.variants?.length
        ? source.variants.find((v) => v.id === line.variantId && v.inStock)
        : source;
      if (
        !source ||
        !evaluateProductCjReadiness(source).ready ||
        !mapped?.cjVariantId ||
        !mapped.cjSku
      )
        throw new Error('Verify this exact variant in CJ Control Room first.');
      lines.push({ ...line, cjVariantId: mapped.cjVariantId, cjSku: mapped.cjSku });
    }
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: JSON.stringify({
        event: 'paid_same_item_release_review',
        evidence: a.evidence,
        previous: p.lines,
        next: lines,
        ceiling: a.maxCjCost,
        logistics: a.logistics,
        coordinated: a.coordinatedRelease,
        cjShippingAllowance: a.cjShippingAllowance,
      }),
      revision: p.revision,
      createdAt: Date.now(),
    });
    await ctx.db.patch(p._id, {
      lines,
      maxCjCost: a.maxCjCost,
      cjLogistics: a.logistics,
      cjApprovedUntil: a.expires,
      coordinatedRelease: a.coordinatedRelease,
      cjShippingAllowance: a.cjShippingAllowance,
      updatedAt: Date.now(),
    });
  },
});

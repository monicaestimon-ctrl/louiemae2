'use node';
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { totalLines } from '../lib/commerce';
function stripeClient(requireSending = false) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  if (requireSending && process.env.COMMERCE_INVOICES_ENABLED !== 'true')
    throw new Error('Sending new commercial invoices is not enabled in this deployment.');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
export const reconcileReversal = internalAction({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, a) => {
    const stripe = stripeClient();
    const intent = await stripe.paymentIntents.retrieve(a.paymentIntentId, {
      expand: ['latest_charge'],
    });
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (charge && (charge.disputed || charge.amount_refunded > 0))
      await ctx.runMutation(internal.commerceProjects.paymentHold, a);
  },
});
export const sendInvoice = action({
  args: { id: v.id('commerceProjects'), revision: v.number() },
  handler: async (ctx, args): Promise<string> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const stripe = stripeClient(true);
    const p = await ctx.runMutation(internal.commerceProjects.claimInvoice, args);
    if (p.status === 'invoiced' && p.invoiceUrl) return p.invoiceUrl;
    const key = `house:${p._id}:v${p.revision}`;
    let invoiceId = p.stripeInvoiceId;
    try {
      if (!invoiceId) {
        if (p.invoiceAttemptAt && p.invoiceAttemptAt < Date.now() - 20 * 3600000)
          throw new Error(
            'An older invoice creation attempt needs reconciliation in Stripe before retrying.'
          );
        const dueDays = Number(process.env.COMMERCE_INVOICE_DUE_DAYS);
        if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 30)
          throw new Error('Configure invoice due days (1–30) before sending.');
        const customer = await stripe.customers.create(
          {
            name: p.name,
            email: p.email,
            phone: p.phone,
            address: {
              line1: p.address.line1,
              city: p.address.city,
              state: p.address.state,
              postal_code: p.address.postalCode,
              country: p.address.country,
            },
          },
          { idempotencyKey: `${key}:customer` }
        );
        const invoice = await stripe.invoices.create(
          {
            customer: customer.id,
            collection_method: 'send_invoice',
            days_until_due: dueDays,
            auto_advance: false,
            pending_invoice_items_behavior: 'exclude',
            metadata: { commerceProjectId: p._id, quoteRevision: String(p.revision) },
            description: `${p.channel === 'house' ? 'House of Louie Mae' : 'Louie Mae'} — ${p.business || p.name}\n${p.notes}`,
            payment_settings: { payment_method_types: ['card'] },
          },
          { idempotencyKey: `${key}:invoice` }
        );
        invoiceId = invoice.id;
        await ctx.runMutation(internal.commerceProjects.invoiceState, {
          ...args,
          invoiceId,
          sent: false,
        });
      }
      let invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status === 'draft') {
        const charges = [
          ...p.lines.map((l) => ({
            description: `${l.name} — ${l.variantName}`,
            amount: l.unitPrice * l.quantity,
            quantity: l.quantity,
            unitAmount: l.unitPrice,
          })),
          ...(p.delivery > 0
            ? [
                {
                  description: 'Delivery — confirmed project charge',
                  amount: p.delivery,
                  quantity: 1,
                  unitAmount: p.delivery,
                },
              ]
            : []),
          ...(p.tax > 0
            ? [
                {
                  description: 'Tax — reviewed project amount',
                  amount: p.tax,
                  quantity: 1,
                  unitAmount: p.tax,
                },
              ]
            : []),
        ];
        const existingLines = await stripe.invoices.listLineItems(invoiceId, { limit: 100 });
        if (existingLines.has_more) throw new Error('Unexpected invoice lines require review.');
        for (let i = 0; i < charges.length; i++) {
          const matched = existingLines.data.filter(
            (l) => l.metadata.commerceLine === `${key}:${i}`
          );
          if (
            matched.length > 1 ||
            (matched[0] &&
              (matched[0].amount !== charges[i].amount ||
                matched[0].quantity !== charges[i].quantity ||
                matched[0].description !== charges[i].description))
          )
            throw new Error('Invoice line differs from the saved quote.');
          if (!matched.length)
            await stripe.invoiceItems.create(
              {
                customer:
                  typeof invoice.customer === 'string' ? invoice.customer : invoice.customer!.id,
                invoice: invoiceId,
                currency: 'usd',
                description: charges[i].description,
                quantity: charges[i].quantity,
                unit_amount_decimal: String(charges[i].unitAmount),
                metadata: { commerceLine: `${key}:${i}` },
              },
              { idempotencyKey: `${key}:line:${i}` }
            );
        }
        const checked = await stripe.invoices.retrieve(invoiceId);
        if (checked.total !== totalLines(p.lines, p.delivery, p.tax))
          throw new Error('Invoice total does not match the reviewed quote.');
        invoice = await stripe.invoices.finalizeInvoice(
          invoiceId,
          { auto_advance: false },
          { idempotencyKey: `${key}:finalize` }
        );
      }
      if (!['open', 'paid'].includes(invoice.status || ''))
        throw new Error('Invoice is not payable.');
      if (invoice.status === 'open')
        await stripe.invoices.sendInvoice(invoiceId, {}, { idempotencyKey: `${key}:send` });
      await ctx.runMutation(internal.commerceProjects.invoiceState, {
        ...args,
        invoiceId,
        url: invoice.hosted_invoice_url || undefined,
        sent: true,
      });
      return invoice.hosted_invoice_url || '';
    } catch {
      if (invoiceId)
        await ctx.runMutation(internal.commerceProjects.invoiceState, {
          ...args,
          invoiceId,
          sent: false,
          error:
            'Invoice operation needs reconciliation. Retry resumes this invoice; do not create a separate payment request.',
        });
      throw new Error('Invoice was not confirmed sent. Retry to reconcile the same invoice.');
    }
  },
});
export const reconcilePayment = internalAction({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    const stripe = stripeClient();
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const projectId = invoice.metadata?.commerceProjectId as Id<'commerceProjects'> | undefined;
    if (!projectId) return;
    const p = await ctx.runQuery(internal.commerceProjects.record, { id: projectId });
    if (
      !p ||
      p.stripeInvoiceId !== invoice.id ||
      invoice.status !== 'paid' ||
      invoice.amount_remaining !== 0 ||
      invoice.currency !== 'usd' ||
      invoice.amount_paid !== totalLines(p.lines, p.delivery, p.tax) ||
      invoice.total !== invoice.amount_paid
    )
      throw new Error('Invoice payment requires review.');
    const payments = await stripe.invoicePayments.list({
      invoice: invoice.id,
      status: 'paid',
      limit: 100,
    });
    if (payments.has_more) throw new Error('Payment allocations require manual reconciliation.');
    let verified = 0;
    const paymentIntentIds: string[] = [];
    for (const payment of payments.data) {
      const piId =
        typeof payment.payment.payment_intent === 'string'
          ? payment.payment.payment_intent
          : payment.payment.payment_intent?.id;
      if (!piId) continue;
      const intent = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      const invoiceCustomer =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      const intentCustomer =
        typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      if (
        intent.status !== 'succeeded' ||
        intent.currency !== 'usd' ||
        intentCustomer !== invoiceCustomer ||
        intent.amount_received < (payment.amount_paid || 0) ||
        paymentIntentIds.includes(piId) ||
        intent.livemode !== invoice.livemode ||
        !charge ||
        charge.disputed ||
        charge.amount_refunded > 0
      )
        continue;
      verified += payment.amount_paid || 0;
      paymentIntentIds.push(piId);
    }
    if (verified !== invoice.amount_paid || !paymentIntentIds.length)
      throw new Error('Full online payment has not been verified.');
    await ctx.runMutation(internal.commerceProjects.paid, {
      id: projectId,
      revision: Number(invoice.metadata?.quoteRevision),
      invoiceId: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      paymentIntentIds,
    });
  },
});
export const refreshPayment = action({
  args: { id: v.id('commerceProjects') },
  handler: async (ctx, { id }) => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const p = await ctx.runQuery(internal.commerceProjects.record, { id });
    if (!p?.stripeInvoiceId) throw new Error('No invoice yet.');
    await ctx.runAction(internal.commerceStripe.reconcilePayment, { invoiceId: p.stripeInvoiceId });
  },
});
export const voidInvoice = action({
  args: { id: v.id('commerceProjects') },
  handler: async (ctx, { id }) => {
    const actor = await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const p = await ctx.runQuery(internal.commerceProjects.record, { id });
    if (!p?.stripeInvoiceId || p.paidAt) throw new Error('Only an unpaid invoice may be voided.');
    const stripe = stripeClient(),
      invoice = await stripe.invoices.retrieve(p.stripeInvoiceId);
    if (
      invoice.amount_paid > 0 ||
      invoice.status === 'paid' ||
      invoice.metadata?.commerceProjectId !== p._id
    )
      throw new Error('Payment or identity requires reconciliation; invoice cannot be edited.');
    if (invoice.status === 'draft') await stripe.invoices.del(invoice.id);
    else if (invoice.status === 'open')
      await stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `void:${invoice.id}` });
    else if (invoice.status !== 'void')
      throw new Error('Invoice cannot be reopened automatically.');
    await ctx.runMutation(internal.commerceProjects.voided, {
      id,
      invoiceId: invoice.id,
      actor: actor.email,
    });
  },
});

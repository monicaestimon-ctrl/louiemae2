'use node';
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { api, internal } from './_generated/api';
import { addressArg, lineArg, type PublicDeliveryEstimate } from './dlvEstimates';
import { CommerceError } from '../lib/errors';

/** Iterates provider tax and the shared delivery engine. Never creates a payment or shipment. */
export const estimate = action({
  args: {
    lines: v.array(lineArg),
    channel: v.union(v.literal('retail'), v.literal('trade')),
    zip: v.string(),
    address: v.optional(addressArg),
    service: v.optional(v.string()),
    visitorKey: v.string(),
    useCredit: v.optional(v.boolean()),
    clientPrices: v.optional(v.any()),
  },
  handler: async (ctx, a): Promise<PublicDeliveryEstimate> => {
    let result = await ctx.runMutation(api.dlvEstimates.estimate, a);
    if (!a.address || result.status !== 'ok' || result.totalMinor !== null) return result;
    if (!process.env.STRIPE_SECRET_KEY) return result;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      timeout: 8000,
      maxNetworkRetries: 1,
    });
    // Each pass can move only to a higher delivery tier. Bound external work independently.
    for (let i = 0; i < 18; i++) {
      const work = await ctx.runQuery(internal.dlvTax.work, {
        estimateId: result.estimateId,
        ...(result.guestCapability ? { guestCapability: result.guestCapability } : {}),
        address: a.address,
      });
      if (!work) return result;
      try {
        const calculation = await stripe.tax.calculations.create(
          {
            currency: 'usd',
            expand: ['line_items'],
            customer_details: {
              address: {
                line1: a.address.line1,
                ...(a.address.line2 ? { line2: a.address.line2 } : {}),
                city: a.address.city,
                state: a.address.state,
                postal_code: a.address.postalCode,
                country: a.address.country,
              },
              address_source: 'shipping',
              ...(work.exempt ? { taxability_override: 'customer_exempt' as const } : {}),
            },
            line_items: work.lines.map((l) => ({
              reference: l.reference,
              amount: l.amount,
              tax_code: l.taxCode,
              tax_behavior: 'exclusive',
            })),
            shipping_cost: {
              amount: work.deliveryMinor,
              tax_code: work.policy.shippingTaxCode,
              tax_behavior: 'exclusive',
            },
          },
          {
            idempotencyKey: `delivery-tax:${work.baseKey}:${work.deliveryMinor}:${Math.floor(Date.now() / 300000)}`,
          }
        );
        if (
          !calculation.id ||
          calculation.expires_at === null ||
          calculation.currency !== 'usd' ||
          calculation.tax_amount_inclusive !== 0 ||
          calculation.amount_total !==
            work.merchandiseMinor + work.deliveryMinor + calculation.tax_amount_exclusive
        )
          throw new CommerceError('INVALID_INPUT', 'Tax response does not reconcile');
        const lineTaxes =
          calculation.line_items?.data.map((l) => ({ key: l.reference, taxMinor: l.amount_tax })) ??
          [];
        const deliveryTaxMinor = calculation.shipping_cost?.amount_tax ?? 0;
        if (
          lineTaxes.length !== work.lines.length ||
          work.lines.some((l) => !lineTaxes.some((t) => t.key === l.reference))
        )
          throw new CommerceError('INVALID_INPUT', 'Tax provider did not return every line');
        await ctx.runMutation(internal.dlvTax.record, {
          baseKey: work.baseKey,
          lineTaxes,
          deliveryTaxMinor,
          deliveryMinor: work.deliveryMinor,
          taxMinor: calculation.tax_amount_exclusive,
          reference: calculation.id,
          policyVersion: work.policyVersion,
          expiresAt: Math.min(
            calculation.expires_at * 1000,
            work.exemptionExpiresAt ?? Number.MAX_SAFE_INTEGER
          ),
        });
      } catch {
        return {
          ...result,
          totalMinor: null,
          taxMinor: null,
          reasons: ['We need to confirm tax and delivery before payment. Request a quote.'],
        };
      }
      result = await ctx.runMutation(api.dlvEstimates.estimate, a);
      if (result.status !== 'ok' || result.totalMinor !== null) return result;
    }
    return {
      ...result,
      totalMinor: null,
      taxMinor: null,
      reasons: ['Delivery and tax require a quote.'],
    };
  },
});

/** Records the completed sale for tax reporting only after a verified paid order exists. */
export const commit = internalAction({
  args: { id: v.id('dlvTaxTransactions') },
  handler: async (ctx, a): Promise<void> => {
    const job = await ctx.runMutation(internal.dlvTax.claimTransaction, a);
    if (!job) return;
    try {
      if (!process.env.STRIPE_SECRET_KEY) throw new Error('Tax provider configuration unavailable');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        timeout: 8000,
        maxNetworkRetries: 1,
      });
      const transaction = await stripe.tax.transactions.createFromCalculation(
        { calculation: job.calculationRef, reference: String(job.orderId) },
        { idempotencyKey: `delivery-tax-sale:${job.orderId}` }
      );
      await ctx.runMutation(internal.dlvTax.settleTransaction, {
        id: a.id,
        providerRef: transaction.id,
      });
    } catch {
      await ctx.runMutation(internal.dlvTax.settleTransaction, {
        id: a.id,
        error: 'Tax recording needs retry or provider reconciliation',
      });
    }
  },
});

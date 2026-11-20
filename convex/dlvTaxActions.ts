'use node';
import { proofArg } from './dlvPerimeter';
import { quoteRequestArgs } from './dlvOperations';
import type { Id } from './_generated/dataModel';
import { customerFacing, publicDeliveryError } from '../lib/delivery/publicErrors';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
import Stripe from 'stripe';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { addressArg, lineArg, type PublicDeliveryEstimate } from './dlvEstimates';
import { CommerceError } from '../lib/errors';
import type { Observation } from '../lib/delivery/monitoring';

/** Iterates provider tax and the shared delivery engine. Never creates a payment or shipment. */
export const estimate = action({
  args: {
    proof: v.optional(proofArg),
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
    const { proof, ...input } = a;
    // Reject unsigned/direct calls before any provider work or observation writes.
    const permit = await customerFacing(() =>
      ctx.runMutation(internal.dlvPerimeter.consume, {
        operation: 'estimate',
        input,
        ...(proof ? { proof } : {}),
      })
    );
    if (permit !== 'ok')
      throw new CommerceError(permit === 'limited' ? 'RATE_LIMITED' : 'FORBIDDEN');
    const started = Date.now();
    let path: Observation['path'] = 'matrix';
    let outcome: Observation['outcome'] | undefined;
    let code: string | undefined;
    let requestId: string | undefined;
    let finalResult: PublicDeliveryEstimate | undefined;
    try {
      assertDeliveryBounds(input);
      finalResult = await (async (): Promise<PublicDeliveryEstimate> => {
        let result = await ctx.runMutation(internal.dlvEstimates.compute, input);
        if (!a.address || result.status !== 'ok' || result.totalMinor !== null) return result;
        if (!process.env.STRIPE_SECRET_KEY) return result;
        path = 'matrix_tax';
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
          timeout: 3000,
          maxNetworkRetries: 0,
        });
        // Each pass can move only to a higher delivery tier. Bound external work independently.
        for (let i = 0; i < 3 && Date.now() - started < 8000; i++) {
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
                timeout: Math.max(1, Math.min(3000, 8000 - (Date.now() - started))),
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
              calculation.line_items?.data.map((l) => ({
                key: l.reference,
                taxMinor: l.amount_tax,
              })) ?? [];
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
          } catch (error) {
            // Invalid provider input needs review, not an outage alert. No provider payload is logged.
            const invalidInput = (error as { type?: string })?.type === 'StripeInvalidRequestError';
            outcome = invalidInput ? 'tax_unavailable' : 'tax_error';
            if (invalidInput) code = 'TAX_INPUT_REVIEW';
            return {
              ...result,
              totalMinor: null,
              taxMinor: null,
              reasons: ['We need to confirm tax and delivery before payment. Request a quote.'],
            };
          }
          result = await ctx.runMutation(internal.dlvEstimates.compute, input);
          if (result.status !== 'ok' || result.totalMinor !== null) return result;
        }
        outcome = 'tax_unavailable';
        return {
          ...result,
          totalMinor: null,
          taxMinor: null,
          reasons: ['Delivery and tax require a quote.'],
        };
      })();
      outcome ??=
        finalResult.status !== 'ok'
          ? 'quote'
          : a.address && finalResult.totalMinor === null
            ? 'tax_unavailable'
            : 'ok';
      return finalResult;
    } catch (error) {
      const safe = publicDeliveryError(error);
      code = safe.data.code;
      requestId = safe.data.requestId;
      outcome = code === 'TEMPORARILY_UNAVAILABLE' ? 'error' : 'blocked';
      throw safe;
    } finally {
      try {
        await ctx.runMutation(internal.dlvTelemetry.record, {
          durationMs: Date.now() - started,
          channel: a.channel,
          path,
          outcome: outcome ?? 'error',
          ...(code ? { code } : {}),
          ...(requestId ? { requestId } : {}),
          ...(finalResult ? { estimateId: finalResult.estimateId } : {}),
        });
      } catch {
        // Fixed text only: no input, provider error, address or capability in logs.
        console.warn('Delivery observation could not be persisted');
      }
    }
  },
});

/** Signed quote intake; creation remains atomic while abuse limits commit independently. */
export const requestQuote = action({
  args: { ...quoteRequestArgs, proof: v.optional(proofArg) },
  handler: async (ctx, a): Promise<{ id: Id<'dlvQuoteRequests'>; guestCapability?: string }> => {
    try {
      const { proof, ...input } = a;
      const permit = await ctx.runMutation(internal.dlvPerimeter.consume, {
        operation: 'quote',
        input,
        ...(proof ? { proof } : {}),
      });
      if (permit !== 'ok')
        throw new CommerceError(permit === 'limited' ? 'RATE_LIMITED' : 'FORBIDDEN');
      return await ctx.runMutation(internal.dlvOperations.createRequest, input);
    } catch (error) {
      throw publicDeliveryError(error);
    }
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

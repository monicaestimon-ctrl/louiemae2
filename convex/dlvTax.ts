import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { addressArg } from './dlvEstimates';
import { authorizeEstimate, digest } from './dlvSecurity';
import { addressKey } from '../lib/delivery/destination';
import { activeConfig, maybeConfig } from './sysConfig';
import type { CommissionCategory, TaxProviderPolicy } from '../lib/config';
import { CommerceError } from '../lib/errors';
import { internal } from './_generated/api';
import { audit, openReview } from './sysCore';
import { requireDeliveryRole } from './dlvAccess';
import { exemptionFor } from './dlvTaxExemptions';

export const work = internalQuery({
  args: {
    estimateId: v.id('dlvEstimates'),
    guestCapability: v.optional(v.string()),
    address: addressArg,
  },
  handler: async (ctx, a) => {
    const e = await ctx.db.get(a.estimateId);
    if (!e) throw new CommerceError('QUOTE_EXPIRED');
    await authorizeEstimate(ctx, e, a.guestCapability);
    if (
      e.expiresAt <= Date.now() ||
      e.destination.addressHash !== (await digest(addressKey(a.address)))
    )
      throw new CommerceError('QUOTE_EXPIRED');
    const policy = await maybeConfig<TaxProviderPolicy>(ctx, 'taxProviderPolicy', 'delivery-tax');
    if (
      !policy ||
      e.status !== 'ok' ||
      e.deliveryChargeMinor === undefined ||
      !e.internal.taxBaseKey
    )
      return null;
    const exemption = await exemptionFor(ctx, e.channel, a.address.state);
    return {
      exempt: !!exemption,
      exemptionExpiresAt: exemption?.validUntil ?? null,
      baseKey: e.internal.taxBaseKey as string,
      deliveryMinor: e.deliveryChargeMinor,
      merchandiseMinor: e.merchandiseMinor - e.creditMinor,
      policy: policy.value,
      policyVersion: policy.version,
      lines: (
        e.internal.lines as { key: string; netMinor: number; category: CommissionCategory }[]
      ).map((l) => ({
        reference: l.key,
        amount: l.netMinor,
        taxCode: policy.value.categoryCodes[l.category],
      })),
    };
  },
});

/** Only the server adapter can persist provider evidence. No browser-supplied tax amount is accepted. */
export const record = internalMutation({
  args: {
    baseKey: v.string(),
    lineTaxes: v.array(v.object({ key: v.string(), taxMinor: v.number() })),
    deliveryTaxMinor: v.number(),
    deliveryMinor: v.number(),
    taxMinor: v.number(),
    reference: v.string(),
    policyVersion: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, a) => {
    const policy = await activeConfig<TaxProviderPolicy>(ctx, 'taxProviderPolicy', 'delivery-tax');
    if (policy.version !== a.policyVersion || a.expiresAt <= Date.now())
      throw new CommerceError('QUOTE_EXPIRED');
    if (
      ![a.deliveryMinor, a.taxMinor, a.expiresAt].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !a.reference.startsWith('taxcalc_')
    )
      throw new CommerceError('INVALID_INPUT');
    if (
      !Number.isSafeInteger(a.deliveryTaxMinor) ||
      a.deliveryTaxMinor < 0 ||
      a.lineTaxes.some((l) => !Number.isSafeInteger(l.taxMinor) || l.taxMinor < 0) ||
      a.lineTaxes.reduce((n, l) => n + l.taxMinor, 0) + a.deliveryTaxMinor !== a.taxMinor ||
      new Set(a.lineTaxes.map((l) => l.key)).size !== a.lineTaxes.length
    )
      throw new CommerceError('INVALID_INPUT', 'Tax line breakdown does not reconcile');
    const old = await ctx.db
      .query('dlvTaxCalculations')
      .withIndex('by_base', (q) => q.eq('baseKey', a.baseKey))
      .order('desc')
      .take(100);
    const existing = old.find((r) => r.reference === a.reference);
    if (existing) return existing._id;
    return ctx.db.insert('dlvTaxCalculations', {
      ...a,
      expiresAt: Math.min(
        a.expiresAt,
        Date.now() + policy.value.validityMinutes * 60000,
        policy.effectiveTo ?? Number.MAX_SAFE_INTEGER
      ),
      provider: 'stripe',
      createdAt: Date.now(),
    });
  },
});

export const claimTransaction = internalMutation({
  args: { id: v.id('dlvTaxTransactions') },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || !['pending', 'processing'].includes(r.status) || r.nextAttemptAt > Date.now())
      return null;
    if (r.attempts >= 5) {
      await ctx.db.patch(r._id, { status: 'review_required' });
      await openReview(
        ctx,
        'tax_transaction_reconciliation',
        'dlvTaxTransactions',
        r._id,
        'Tax reporting needs provider reconciliation; never re-charge the customer'
      );
      return null;
    }
    await ctx.db.patch(r._id, {
      status: 'processing',
      attempts: r.attempts + 1,
      nextAttemptAt: Date.now() + 10 * 60000,
    });
    return r;
  },
});
export const settleTransaction = internalMutation({
  args: {
    id: v.id('dlvTaxTransactions'),
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.status === 'complete') return;
    if (a.providerRef) {
      await ctx.db.patch(r._id, {
        status: 'complete',
        providerRef: a.providerRef,
        lastError: undefined,
      });
      return;
    }
    await ctx.db.patch(r._id, {
      status: 'pending',
      lastError: (a.error ?? 'Provider result uncertain').slice(0, 300),
      nextAttemptAt: Date.now() + 60000 * 2 ** r.attempts,
    });
  },
});
export const recoverTransactions = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const status of ['pending', 'processing'] as const) {
      const rows = await ctx.db
        .query('dlvTaxTransactions')
        .withIndex('by_status_due', (q) => q.eq('status', status).lte('nextAttemptAt', Date.now()))
        .take(50);
      for (const r of rows)
        await ctx.scheduler.runAfter(0, internal.dlvTaxActions.commit, { id: r._id });
    }
  },
});

/** Called only from the signature-verified payment webhook. No tax is guessed from a cash refund. */
export const receiveRefund = internalMutation({
  args: {
    paymentIntentId: v.string(),
    eventId: v.string(),
    refundedMinor: v.number(),
    chargeMinor: v.number(),
  },
  handler: async (ctx, a) => {
    const order = await ctx.db
      .query('ordOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId))
      .unique();
    if (!order) return;
    if (
      ![a.refundedMinor, a.chargeMinor].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      a.refundedMinor > a.chargeMinor ||
      a.chargeMinor !== order.totals.total
    )
      throw new CommerceError('INVALID_INPUT', 'Refund does not reconcile to the paid order');
    const prior = await ctx.db
      .query('dlvTaxRefundReviews')
      .withIndex('by_order', (q) => q.eq('orderId', order._id))
      .unique();
    if (prior && prior.confirmedRefundMinor >= a.refundedMinor) return;
    const data = {
      confirmedRefundMinor: a.refundedMinor,
      chargeMinor: a.chargeMinor,
      latestEventId: a.eventId,
      updatedAt: Date.now(),
    };
    if (prior) await ctx.db.patch(prior._id, data);
    else
      await ctx.db.insert('dlvTaxRefundReviews', {
        orderId: order._id,
        reportedRefundMinor: 0,
        ...data,
      });
    await openReview(
      ctx,
      'tax_refund_reconciliation',
      'ordOrders',
      order._id,
      'Verified refund received. Reconcile original tax transaction and refunded merchandise/shipping lines before recording a tax reversal. Do not issue another payment refund.'
    );
  },
});
export const reportingQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    return {
      sales: await ctx.db
        .query('dlvTaxTransactions')
        .withIndex('by_status_due', (q) => q.eq('status', 'review_required'))
        .take(100),
      refunds: await ctx.db
        .query('dlvTaxRefundReviews')
        .filter((q) => q.gt(q.field('confirmedRefundMinor'), q.field('reportedRefundMinor')))
        .take(100),
    };
  },
});
/** Records an externally completed, reviewed tax transaction/reversal; never moves customer money. */
export const recordAdjustment = mutation({
  args: {
    orderId: v.id('ordOrders'),
    kind: v.union(v.literal('sale'), v.literal('refund')),
    providerRef: v.string(),
    cumulativeRefundMinor: v.number(),
    taxMinor: v.number(),
    evidence: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const order = await ctx.db.get(a.orderId);
    if (
      !order ||
      !/^tax_[A-Za-z0-9_]+$/.test(a.providerRef) ||
      !a.evidence.trim() ||
      a.evidence.length > 2000 ||
      ![a.cumulativeRefundMinor, a.taxMinor].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      a.taxMinor > order.totals.tax
    )
      throw new CommerceError('INVALID_INPUT');
    const old = await ctx.db
      .query('dlvTaxAdjustments')
      .withIndex('by_reference', (q) => q.eq('providerRef', a.providerRef))
      .unique();
    if (old) {
      if (
        old.orderId !== a.orderId ||
        old.kind !== a.kind ||
        old.cumulativeRefundMinor !== a.cumulativeRefundMinor ||
        old.taxMinor !== a.taxMinor
      )
        throw new CommerceError(
          'INVALID_INPUT',
          'Tax reference already belongs to a different adjustment'
        );
      return old._id;
    }
    const resolvedEntities: { table: string; id: string; kind: string }[] = [];
    if (a.kind === 'refund') {
      const review = await ctx.db
        .query('dlvTaxRefundReviews')
        .withIndex('by_order', (q) => q.eq('orderId', a.orderId))
        .unique();
      if (
        !review ||
        a.cumulativeRefundMinor <= review.reportedRefundMinor ||
        a.cumulativeRefundMinor > review.confirmedRefundMinor
      )
        throw new CommerceError(
          'INVALID_INPUT',
          'A verified refund must precede tax reversal reconciliation'
        );
      const previous = await ctx.db
        .query('dlvTaxAdjustments')
        .withIndex('by_order', (q) => q.eq('orderId', a.orderId))
        .filter((q) => q.eq(q.field('kind'), 'refund'))
        .order('desc')
        .first();
      if (previous && a.taxMinor < previous.taxMinor)
        throw new CommerceError('INVALID_INPUT', 'Cumulative tax reversal cannot decrease');
      await ctx.db.patch(review._id, {
        reportedRefundMinor: a.cumulativeRefundMinor,
        updatedAt: Date.now(),
      });
      if (a.cumulativeRefundMinor === review.confirmedRefundMinor)
        resolvedEntities.push({
          table: 'ordOrders',
          id: order._id,
          kind: 'tax_refund_reconciliation',
        });
    } else {
      if (a.cumulativeRefundMinor !== 0 || a.taxMinor !== order.totals.tax)
        throw new CommerceError('INVALID_INPUT');
      const priorSale = await ctx.db
        .query('dlvTaxAdjustments')
        .withIndex('by_order', (q) => q.eq('orderId', order._id))
        .filter((q) => q.eq(q.field('kind'), 'sale'))
        .first();
      if (priorSale)
        throw new CommerceError('INVALID_INPUT', 'Sale tax already reconciled for this order');
      const job = await ctx.db
        .query('dlvTaxTransactions')
        .withIndex('by_order', (q) => q.eq('orderId', order._id))
        .unique();
      if (job) {
        if (job.status !== 'review_required')
          throw new CommerceError(
            'INVALID_INPUT',
            'An active or completed tax job cannot be manually replaced'
          );
        await ctx.db.patch(job._id, {
          status: 'complete',
          providerRef: a.providerRef,
          lastError: undefined,
        });
        resolvedEntities.push({
          table: 'dlvTaxTransactions',
          id: job._id,
          kind: 'tax_transaction_reconciliation',
        });
      }
      resolvedEntities.push({
        table: 'ordOrders',
        id: order._id,
        kind: 'manual_sale_tax_reporting',
      });
    }
    const id = await ctx.db.insert('dlvTaxAdjustments', {
      ...a,
      createdBy: actor.email,
      createdAt: Date.now(),
    });
    for (const entity of resolvedEntities) {
      const reviews = await ctx.db
        .query('sysReviewItems')
        .withIndex('by_entity', (q) => q.eq('entityTable', entity.table).eq('entityId', entity.id))
        .filter((q) => q.and(q.eq(q.field('kind'), entity.kind), q.eq(q.field('status'), 'open')))
        .collect();
      for (const review of reviews)
        await ctx.db.patch(review._id, {
          status: 'resolved',
          resolvedBy: actor.email,
          resolvedAt: Date.now(),
          resolution: `Recorded reviewed tax evidence ${id}: ${a.providerRef}`,
        });
    }
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.tax_reconciled',
      entityTable: 'dlvTaxAdjustments',
      entityId: id,
      reason: a.evidence,
    });
    return id;
  },
});

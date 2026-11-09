import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';
import { acceptsPlatformPayment } from '../lib/paymentMode';
import { supplierAvailable } from '../lib/retailLaunch';
import { digest } from './dlvSecurity';
import { audit } from './sysCore';
import { currentInventory, availableAfterCommitments } from './ordInventory';
import { finishVerifiedOrder } from './ordPayments';
import { reserve as reserveCredit } from './ldgCredits';
import { activeConfig } from './sysConfig';
import type { FreshnessPolicy } from '../lib/config';

async function snapshot(ctx: QueryCtx | MutationCtx, id: Id<'ordPaidExceptions'>) {
  const exception = await ctx.db.get(id);
  const intent = exception?.intentId ? await ctx.db.get(exception.intentId) : null;
  if (!exception || !intent)
    throw new CommerceError('INVALID_INPUT', 'This exception needs finance investigation');
  const lines = await Promise.all(
    intent.lineSnapshot.map(async (line) => {
      const variant = await ctx.db.get(line.variantId);
      const supplier = variant ? await ctx.db.get(variant.supplierId) : null;
      const warehouse = variant?.warehouseId ? await ctx.db.get(variant.warehouseId) : null;
      const product = await ctx.db.get(line.productId);
      const listing = await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) =>
          q
            .eq('productId', line.productId)
            .eq('channel', intent.channel === 'trade' ? 'house' : 'retail')
        )
        .first();
      return { line, variant, supplier, warehouse, product, listing };
    })
  );
  return { exception, intent, lines, fingerprint: await digest({ intent, lines }) };
}

export const detail = query({
  args: { id: v.id('ordPaidExceptions') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const s = await snapshot(ctx, a.id);
    return {
      fingerprint: s.fingerprint,
      canApprove: actor.approver,
      status: s.exception.status,
      totalMinor: s.intent.totalMinor,
      creditMinor: s.intent.creditMinor,
      shippingAddress: s.intent.shippingAddress ?? null,
      serviceTerms: s.intent.serviceTerms ?? null,
      lines: s.lines.map(({ line, variant }) => ({
        lineKey: line.lineKey,
        name: line.name,
        sku: line.supplierSku ?? variant?.supplierSku ?? null,
        supplierCode: line.supplierCode,
        packs: line.packs,
        pieces: line.pieces,
        originZip: line.originZip ?? '',
        service: line.service ?? '',
      })),
    };
  },
});

export const resumeOriginal = mutation({
  args: {
    id: v.id('ordPaidExceptions'),
    verificationId: v.id('ordPaymentVerifications'),
    expectedFingerprint: v.string(),
    requestKey: v.string(),
    customerAgreement: v.string(),
    acceptedCostRisk: v.boolean(),
    noPriorSupplierHandoff: v.boolean(),
    confirmations: v.array(
      v.object({
        lineKey: v.string(),
        source: v.string(),
        observedAt: v.number(),
        availablePacks: v.number(),
      })
    ),
  },
  handler: async (ctx, a): Promise<Id<'ordOrders'>> => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (
      !a.acceptedCostRisk ||
      !a.noPriorSupplierHandoff ||
      !/^[\w-]{16,80}$/.test(a.requestKey) ||
      a.customerAgreement.trim().length < 5 ||
      a.customerAgreement.length > 1000 ||
      !a.confirmations.length ||
      a.confirmations.length > 100
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Confirm the original agreement, cost responsibility and absence of a prior supplier handoff'
      );
    const key = `exception-fulfill:${await digest(actor.email)}:${a.requestKey}`,
      hash = await digest(a);
    const prior = await ctx.db
      .query('sysIdempotencyKeys')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first();
    if (prior) {
      if (prior.scope !== hash || !prior.resultRef)
        throw new CommerceError('INVALID_INPUT', 'Changed recovery retry');
      return prior.resultRef as Id<'ordOrders'>;
    }
    const s = await snapshot(ctx, a.id),
      { exception: ex, intent } = s;
    const proof = await ctx.db.get(a.verificationId);
    const latest = await ctx.db
      .query('ordPaymentVerifications')
      .withIndex('by_exception', (q) => q.eq('exceptionId', a.id))
      .order('desc')
      .first();
    if (
      ex.status !== 'open' ||
      intent.status !== 'exception' ||
      s.fingerprint !== a.expectedFingerprint ||
      !proof ||
      latest?._id !== proof._id ||
      proof.exceptionId !== ex._id ||
      proof.intentId !== intent._id ||
      proof.sessionId !== ex.stripeSessionId ||
      proof.sessionId !== intent.stripeSessionId ||
      proof.paymentIntentId !== ex.paymentIntentId ||
      (proof.paymentStateVersion ?? 0) !== (ex.paymentStateVersion ?? 0) ||
      proof.validUntil <= Date.now() ||
      proof.verifiedAt > Date.now()
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Payment, inventory or original order changed; review and verify again'
      );
    if (
      !acceptsPlatformPayment(proof.livemode) ||
      !proof.captured ||
      proof.disputed ||
      proof.currency !== 'usd' ||
      proof.amountMinor !== intent.totalMinor ||
      proof.succeededRefundMinor !== 0 ||
      proof.pendingRefundMinor !== 0 ||
      !intent.shippingAddress ||
      !intent.buyer.email ||
      !intent.serviceTerms
    )
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'Only the exact unrefunded original payment and complete delivery details can resume'
      );
    const existing = await ctx.db
      .query('ordOrders')
      .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
      .first();
    const paymentOrder = await ctx.db
      .query('ordOrders')
      .withIndex('by_payment', (q) => q.eq('paymentIntentId', proof.paymentIntentId))
      .first();
    if (existing || paymentOrder)
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'This payment already has an order'
      );
    if (
      a.confirmations.length !== s.lines.length ||
      new Set(a.confirmations.map((c) => c.lineKey)).size !== s.lines.length
    )
      throw new CommerceError('INVALID_INPUT', 'Confirm every original line exactly once');
    const now = Date.now();
    for (const { line, variant, warehouse, supplier, product, listing } of s.lines) {
      const confirmation = a.confirmations.find((c) => c.lineKey === line.lineKey);
      if (
        !confirmation ||
        confirmation.source.trim().length < 5 ||
        confirmation.source.length > 1000 ||
        !Number.isSafeInteger(confirmation.observedAt) ||
        confirmation.observedAt <= 0 ||
        confirmation.observedAt > now ||
        !Number.isSafeInteger(confirmation.availablePacks) ||
        confirmation.availablePacks < line.packs ||
        confirmation.availablePacks > 1000000 ||
        !variant ||
        (line.supplierSku && line.supplierSku !== variant.supplierSku) ||
        (line.warehouseId && line.warehouseId !== variant.warehouseId) ||
        variant.productId !== line.productId ||
        variant.piecesPerPack * line.packs !== line.pieces ||
        variant.availability !== 'in_stock' ||
        supplier?.code !== line.supplierCode ||
        product?.provider !== line.supplierCode
      )
        throw new CommerceError(
          'STOCK_UNAVAILABLE',
          'Confirm the exact original SKU, selling pack and supplier availability'
        );
      const freshness = await activeConfig<FreshnessPolicy>(
        ctx,
        'freshnessPolicy',
        supplier.freshnessKey ?? 'freshness-default'
      );
      if (
        now - confirmation.observedAt >
        Math.min(freshness.value.stockSyncMaxHours, freshness.value.checkoutSourceMaxHours) *
          3600000
      )
        throw new CommerceError('STOCK_UNAVAILABLE', 'Supplier confirmation is stale');
      if (line.supplierCode === 'zuo') {
        if (!warehouse || warehouse.originZip !== line.originZip)
          throw new CommerceError('STOCK_UNAVAILABLE', 'Original fulfillment origin changed');
        const inventory = await currentInventory(ctx, variant, now);
        if (
          !inventory.view.automatic ||
          inventory.view.availablePacks === null ||
          line.packs >
            (await availableAfterCommitments(
              ctx,
              variant,
              inventory.view.availablePacks,
              now,
              intent._id
            ))
        )
          throw new CommerceError(
            'STOCK_UNAVAILABLE',
            'Verified warehouse capacity cannot cover this original order'
          );
      } else if (line.supplierCode === 'ashcroft') {
        const supplierLine = listing?.fulfillment?.find((x) => x.id === variant.legacyVariantId);
        if (
          !listing?.published ||
          supplierLine?.sku !== variant.supplierSku ||
          !supplierAvailable(supplierLine.sku, listing.snapshot.description)
        )
          throw new CommerceError(
            'STOCK_UNAVAILABLE',
            'Ashcroft listing is unavailable; do not substitute'
          );
      } else throw new CommerceError('STOCK_UNAVAILABLE', 'Unsupported supplier recovery');
    }
    // Expired checkouts may have released credit. Re-reserve it explicitly or fail without changing the accepted total.
    let creditRef = intent.creditReservationRef;
    if (intent.creditMinor > 0) {
      if (!intent.buyer.userId || !creditRef)
        throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Credit ownership needs review');
      const events = await ctx.db
        .query('ldgCreditEvents')
        .withIndex('by_ref', (q) => q.eq('ref', creditRef!))
        .collect();
      if (events.some((e) => e.type === 'redeemed'))
        throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Credit was already redeemed');
      if (
        !events.some((e) => e.type === 'reserved' && e.amountMinor >= intent.creditMinor) ||
        events.some((e) => e.type === 'reservation_released')
      ) {
        creditRef = `intent:${intent._id}:recovery:${ex._id}`;
        if (
          (await reserveCredit(ctx, intent.buyer.userId, intent.creditMinor, creditRef)) !==
          intent.creditMinor
        )
          throw new CommerceError(
            'PAYMENT_RECONCILIATION_REQUIRED',
            'Available credit no longer covers the accepted credit amount'
          );
        await ctx.db.patch(intent._id, { creditReservationRef: creditRef });
      }
    }
    // Rebuild only missing internal obligations; no supplier handoff is sent here.
    const holds = await ctx.db
      .query('ordInventoryReservations')
      .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
      .collect();
    if (
      holds.some(
        (h) => h.status === 'reconciled' || !s.lines.some((x) => x.line.variantId === h.variantId)
      )
    )
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'An existing inventory allocation needs investigation'
      );
    for (const { line, variant } of s.lines) {
      const matching = holds.filter((h) => h.variantId === line.variantId);
      if (matching.some((h) => h.warehouseId && h.warehouseId !== variant!.warehouseId))
        throw new CommerceError(
          'STOCK_UNAVAILABLE',
          'The original inventory commitment uses a different warehouse'
        );
      if (matching.reduce((n, h) => n + h.packs, 0) > line.packs)
        throw new CommerceError(
          'PAYMENT_RECONCILIATION_REQUIRED',
          'Inventory obligation quantity needs investigation'
        );
      for (const hold of matching)
        await ctx.db.patch(hold._id, {
          status: 'consumed',
          ...(variant!.warehouseId ? { warehouseId: variant!.warehouseId } : {}),
          ...(variant!.currentStockRevisionId
            ? { stockRevisionId: variant!.currentStockRevisionId }
            : {}),
          piecesPerPack: variant!.piecesPerPack,
        });
      const missing = line.packs - matching.reduce((n, h) => n + h.packs, 0);
      if (missing > 0)
        await ctx.db.insert('ordInventoryReservations', {
          variantId: line.variantId,
          intentId: intent._id,
          packs: missing,
          expiresAt: now,
          createdAt: now,
          status: 'consumed',
          ...(variant!.warehouseId ? { warehouseId: variant!.warehouseId } : {}),
          ...(variant!.currentStockRevisionId
            ? { stockRevisionId: variant!.currentStockRevisionId }
            : {}),
          piecesPerPack: variant!.piecesPerPack,
        });
    }
    const orderId = await finishVerifiedOrder(
      ctx,
      { ...intent, ...(creditRef ? { creditReservationRef: creditRef } : {}) },
      {
        paymentIntentId: proof.paymentIntentId,
        email: intent.buyer.email,
        shippingAddress: intent.shippingAddress,
        paidAt: ex.createdAt,
      },
      true
    );
    await ctx.db.patch(ex._id, {
      status: 'resolved',
      resolutionKind: 'fulfilled_original',
      resolution: a.customerAgreement.trim(),
      paymentVerificationId: proof._id,
      resolvedAt: now,
      resolvedBy: actor.email,
      resolutionOrderId: orderId,
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'paid_exception.original_order_recovered',
      entityTable: 'ordPaidExceptions',
      entityId: ex._id,
      before: {
        exception: ex,
        reservations: holds,
        creditRef: intent.creditReservationRef ?? null,
      },
      after: {
        orderId,
        verificationId: proof._id,
        fingerprint: s.fingerprint,
        confirmations: a.confirmations,
        acceptedCostRisk: true,
        noPriorSupplierHandoff: true,
        creditRef: creditRef ?? null,
      },
      reason: a.customerAgreement.trim(),
      requestId: key,
    });
    await ctx.db.insert('sysIdempotencyKeys', {
      key,
      scope: hash,
      resultRef: orderId,
      createdAt: now,
    });
    return orderId;
  },
});

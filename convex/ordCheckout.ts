import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
// Checkout service (spec S19, v2 §12, §13). Creates an idempotent checkout intent from a valid
// full-address estimate, reserves inventory, freezes the accepted line and delivery snapshot,
// and creates a payment session for exactly that total. Only a verified payment event marks an
// order paid (see ordPayments); a browser redirect never does.
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { claimKey, setKeyResult, bumpMetric } from './sysCore';
import { computeEstimate, cartHash, type LineInput } from './dlvEngine';
import { viewer, isVerified } from './holmAccess';
import { requireFlag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { addressKey } from '../lib/delivery/destination';
import { addressArg, lineArg } from './dlvEstimates';
import { snapshotForIntent } from './prgAttribution';
import {
  available as creditAvailable,
  reserve as reserveCreditV2,
  settle as settleCredit,
} from './ldgCredits';
import { flag } from '../lib/flags';
import { authorizeEstimate, digest } from './dlvSecurity';
import { allocate } from '../lib/money';
import { computeManualQuote } from './dlvManual';

// Frozen once per intent; five minutes of setup headroom above Stripe's session minimum.
const INTENT_MS = 35 * 60_000;

export type IntentResult =
  | {
      status: 'created' | 'existing';
      intentId: Id<'ordCheckoutIntents'>;
      expiresAt: number;
      service: string;
      serviceLabel: string;
      totalMinor: number;
      creditMinor: number;
      lines: { name: string; unitMinor: number; packs: number }[];
      deliveryMinor: number;
      taxMinor: number;
      email?: string;
    }
  | {
      status: 'price_changed';
      totalMinor: number;
      deliveryMinor: number;
      taxMinor: number;
      merchandiseMinor: number;
    };

/**
 * Creates (or returns) a checkout intent. The client must resend the exact cart, address and
 * service of a full-address estimate; the server recomputes everything and, if the total
 * changed, returns PRICE_CHANGED until the client accepts the new total explicitly.
 */
export const createIntent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    estimateId: v.id('dlvEstimates'),
    lines: v.array(lineArg),
    address: addressArg,
    service: v.string(),
    acceptTotalMinor: v.number(),
    email: v.optional(v.string()),
    visitorKey: v.optional(v.string()),
    useCredit: v.optional(v.boolean()),
    guestCapability: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<IntentResult> => {
    assertDeliveryBounds(a, 100);
    if (!/^[\w-]{16,80}$/.test(a.idempotencyKey))
      throw new CommerceError('INVALID_INPUT', 'Bad idempotency key');
    const est = await ctx.db.get(a.estimateId);
    if (!est) throw new CommerceError('QUOTE_EXPIRED');
    await authorizeEstimate(ctx, est, a.guestCapability);
    requireFlag(
      est.channel === 'retail' ? 'RETAIL_ZUO_CHECKOUT_ENABLED' : 'TRADE_CHECKOUT_V2_ENABLED'
    );
    if (est.channel === 'trade' && !isVerified((await viewer(ctx))?.profile ?? null))
      throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    const requestHash = await digest({
      estimateId: a.estimateId,
      lines: a.lines,
      address: a.address,
      service: a.service,
      acceptTotalMinor: a.acceptTotalMinor,
      email: a.email ?? '',
      useCredit: a.useCredit ?? false,
    });
    const existing = await ctx.db
      .query('ordCheckoutIntents')
      .withIndex('by_key', (q) => q.eq('idempotencyKey', a.idempotencyKey))
      .first();
    if (existing) {
      if (existing.estimateId !== est._id || existing.requestHash !== requestHash)
        throw new CommerceError('FORBIDDEN', 'Idempotency key belongs to a different request');
      if (existing.expiresAt <= Date.now()) throw new CommerceError('QUOTE_EXPIRED');
      if (existing.status !== 'created' && existing.status !== 'session_open')
        throw new CommerceError('QUOTE_EXPIRED', `Intent ${existing.status}`);
      return {
        status: 'existing',
        intentId: existing._id,
        expiresAt: existing.expiresAt,
        service: est.service,
        serviceLabel: existing.serviceTerms?.label ?? 'Confirmed delivery',
        totalMinor: existing.totalMinor,
        creditMinor: existing.creditMinor,
        deliveryMinor: existing.deliveryMinor,
        taxMinor: existing.taxMinor,
        lines: existing.lineSnapshot.map((l) => ({
          name: l.name,
          unitMinor: l.unitPackMinor,
          packs: l.packs,
        })),
        ...(existing.buyer.email ? { email: existing.buyer.email } : {}),
      };
    }
    const priorIntents = await ctx.db
      .query('ordCheckoutIntents')
      .withIndex('by_estimate', (q) => q.eq('estimateId', est._id))
      .take(100);
    if (
      priorIntents.length === 100 ||
      priorIntents.some((i) => !['failed', 'expired'].includes(i.status))
    )
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'This estimate already has a payment checkout. Resume the original checkout.'
      );
    const now = Date.now();
    if (est.expiresAt <= now) throw new CommerceError('QUOTE_EXPIRED', 'Estimate expired');
    if (
      est.destination.precision !== 'full' ||
      est.destination.addressHash !== (await digest(addressKey(a.address)))
    )
      throw new CommerceError('QUOTE_EXPIRED', 'Address changed since the estimate');
    if (est.cartHash !== cartHash(a.lines as LineInput[], est.channel) || est.service !== a.service)
      throw new CommerceError('QUOTE_EXPIRED', 'Cart or service changed since the estimate');
    if (est.status !== 'ok') throw new CommerceError('DELIVERY_QUOTE_REQUIRED');
    // Recompute against current prices, stock, sources and config; never charge a stale total.
    const me0 = await viewer(ctx);
    const creditWanted =
      a.useCredit && me0 && flag('CREDIT_V2_ENABLED') ? await creditAvailable(ctx, me0.userId) : 0;
    if (creditWanted !== est.creditMinor)
      throw new CommerceError('QUOTE_EXPIRED', 'Store credit changed since the estimate');
    const manual = est.manualQuoteVersionId ? await ctx.db.get(est.manualQuoteVersionId) : null;
    if (est.manualQuoteVersionId && (!manual || manual.status !== 'accepted'))
      throw new CommerceError('QUOTE_EXPIRED');
    if (manual?.checkoutIntentId) {
      const previous = await ctx.db.get(manual.checkoutIntentId);
      if (previous && !['failed', 'expired'].includes(previous.status))
        throw new CommerceError(
          'PAYMENT_RECONCILIATION_REQUIRED',
          'This quote already has a payment checkout'
        );
    }
    const fresh = manual
      ? await computeManualQuote(ctx, manual)
      : await computeEstimate(
          ctx,
          {
            lines: a.lines as LineInput[],
            channel: est.channel,
            destination: { zip: a.address.postalCode.slice(0, 5), address: a.address },
            service: a.service,
            creditMinor: creditWanted,
          },
          now
        );
    if (fresh.status !== 'ok' || fresh.deliveryMinor === undefined)
      throw new CommerceError('DELIVERY_QUOTE_REQUIRED');
    if (fresh.taxMinor === undefined)
      throw new CommerceError(
        'QUOTE_EXPIRED',
        'Tax evidence changed or expired; review a new full-address estimate'
      );
    const totalMinor =
      fresh.merchandiseMinor - fresh.creditMinor + fresh.deliveryMinor + fresh.taxMinor;
    if (
      totalMinor !== a.acceptTotalMinor ||
      fresh.deliveryMinor !== est.deliveryChargeMinor ||
      fresh.taxMinor !== est.taxMinor ||
      fresh.merchandiseMinor !== est.merchandiseMinor ||
      fresh.creditMinor !== est.creditMinor
    ) {
      await bumpMetric(ctx, 'checkout.price_changed');
      return {
        status: 'price_changed',
        totalMinor,
        deliveryMinor: fresh.deliveryMinor,
        taxMinor: fresh.taxMinor,
        merchandiseMinor: fresh.merchandiseMinor,
      };
    }
    if (fresh.sourceVersionsHash !== est.sourceVersionsHash)
      throw new CommerceError('QUOTE_EXPIRED', 'Source or policy changed; review a new estimate');
    const claim = await claimKey(ctx, `checkout:${a.idempotencyKey}`, 'checkout');
    if (claim.duplicate)
      throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Duplicate checkout key');
    const me = await viewer(ctx);
    const deliveryByLine = new Map<string, number>();
    for (const group of fresh.groups) {
      const groupLines = fresh.lines.filter((l) =>
        group.groupKey === 'ashcroft'
          ? l.provider === 'ashcroft'
          : group.groupKey === `${l.supplierCode}:${l.originZip}:${est.service}`
      );
      if (group.chargeMinor === undefined || !groupLines.length)
        throw new CommerceError('DELIVERY_QUOTE_REQUIRED', 'Delivery allocation requires review');
      const shares = allocate(
        group.chargeMinor,
        groupLines.map((l) => l.unitPackMinor * l.packs - (l.creditMinor ?? 0))
      );
      groupLines.forEach((l, i) => deliveryByLine.set(l.lineKey, shares[i]));
    }
    if (
      fresh.lines.some((l) => !deliveryByLine.has(l.lineKey)) ||
      [...deliveryByLine.values()].reduce((n, x) => n + x, 0) !== fresh.deliveryMinor
    )
      throw new CommerceError('DELIVERY_QUOTE_REQUIRED', 'Shipment charges do not reconcile');
    const intentId = await ctx.db.insert('ordCheckoutIntents', {
      ...(!me && est.guestCapabilityHash ? { guestCapabilityHash: est.guestCapabilityHash } : {}),
      serviceTerms: fresh.serviceTerms,
      idempotencyKey: a.idempotencyKey,
      requestHash,
      shippingAddress: a.address,
      ...(fresh.taxCalculationRef ? { taxCalculationRef: fresh.taxCalculationRef } : {}),
      estimateId: est._id,
      cartHash: est.cartHash,
      channel: est.channel,
      buyer: {
        ...(me ? { userId: me.userId } : {}),
        ...(a.email || me?.email ? { email: (a.email || me!.email).trim().toLowerCase() } : {}),
      },
      lineSnapshot: fresh.lines.map((l) => ({
        lineKey: l.lineKey,
        deliveryAllocMinor: deliveryByLine.get(l.lineKey)!,
        ...(fresh.lineTaxes
          ? { taxMinor: fresh.lineTaxes.find((t) => t.key === l.lineKey)!.taxMinor }
          : {}),
        variantId: l.variant._id,
        productId: l.productId,
        name: l.name,
        packs: l.packs,
        pieces: l.pieces,
        unitPackMinor: l.unitPackMinor,
        discountMinor: 0,
        creditMinor: l.creditMinor ?? 0,
        ...(l.engine?.marginBps != null ? { marginFloorBps: l.engine.marginBps } : {}),
        commissionCategory: l.category,
        supplierCode: l.supplierCode,
        originZip: l.originZip,
        service: est.service,
        ...(l.costRevisionId ? { costRevisionId: l.costRevisionId } : {}),
        ...(l.priceRevisionId ? { priceRevisionId: l.priceRevisionId } : {}),
      })),
      merchandiseMinor: fresh.merchandiseMinor,
      deliveryMinor: fresh.deliveryMinor,
      taxMinor: fresh.taxMinor,
      ...(fresh.deliveryTaxMinor !== undefined ? { deliveryTaxMinor: fresh.deliveryTaxMinor } : {}),
      creditMinor: fresh.creditMinor,
      totalMinor,
      status: 'created',
      expiresAt: now + INTENT_MS,
      createdAt: now,
    });
    if (manual) await ctx.db.patch(manual._id, { checkoutIntentId: intentId });
    // The fresh calculation read all competing commitments in this same serializable mutation.
    // These are internal capacity holds, not proof of a supplier-side reservation.
    for (const l of fresh.lines)
      await ctx.db.insert('ordInventoryReservations', {
        variantId: l.variant._id,
        ...(l.variant.warehouseId ? { warehouseId: l.variant.warehouseId } : {}),
        ...(l.variant.currentStockRevisionId ? { stockRevisionId: l.variant.currentStockRevisionId } : {}),
        piecesPerPack: l.variant.piecesPerPack,
        createdAt: now,
        packs: l.packs,
        intentId,
        expiresAt: now + INTENT_MS,
        status: 'held',
      });
    if (fresh.creditMinor > 0 && me) {
      const held = await reserveCreditV2(ctx, me.userId, fresh.creditMinor, `intent:${intentId}`);
      if (held !== fresh.creditMinor)
        throw new CommerceError('QUOTE_EXPIRED', 'Store credit changed');
      await ctx.db.patch(intentId, { creditReservationRef: `intent:${intentId}` });
    }
    // Freeze attribution and rate protection with the accepted lines (S27).
    const snapshotId = await snapshotForIntent(ctx, {
      intentId,
      visitorKey: a.visitorKey,
      buyer: {
        ...(me ? { userId: me.userId } : {}),
        ...(a.email ? { email: a.email.trim().toLowerCase() } : {}),
      },
      channel: est.channel,
      lines: fresh.lines.map((l) => ({
        lineKey: l.lineKey,
        productId: l.productId,
        variantId: l.variant._id,
        category: l.category,
      })),
    });
    if (snapshotId) await ctx.db.patch(intentId, { attributionSnapshotId: snapshotId });
    await setKeyResult(ctx, `checkout:${a.idempotencyKey}`, intentId);
    return {
      status: 'created',
      intentId,
      expiresAt: now + INTENT_MS,
      service: est.service,
      serviceLabel: fresh.serviceTerms.label,
      ...(a.email || me?.email ? { email: (a.email || me!.email).trim().toLowerCase() } : {}),
      totalMinor,
      creditMinor: fresh.creditMinor,
      deliveryMinor: fresh.deliveryMinor,
      taxMinor: fresh.taxMinor,
      lines: fresh.lines.map((l) => ({ name: l.name, unitMinor: l.unitPackMinor, packs: l.packs })),
    };
  },
});

export const attachSession = internalMutation({
  args: { intentId: v.id('ordCheckoutIntents'), sessionId: v.string() },
  handler: async (ctx, a) => {
    const i = await ctx.db.get(a.intentId);
    if (!i || (i.status !== 'created' && i.status !== 'session_open'))
      throw new CommerceError('QUOTE_EXPIRED');
    if (i.stripeSessionId && i.stripeSessionId !== a.sessionId)
      throw new CommerceError(
        'PAYMENT_RECONCILIATION_REQUIRED',
        'Intent already has a different session'
      );
    await ctx.db.patch(i._id, { stripeSessionId: a.sessionId, status: 'session_open' });
  },
});

/** Ends an intent without payment and releases its reservations (session expired or creation failed). */
export async function releaseIntent(
  ctx: MutationCtx,
  intent: Doc<'ordCheckoutIntents'>,
  status: 'expired' | 'failed'
) {
  if (intent.status === 'paid' || intent.status === 'exception' || intent.status === 'refunded') return;
  await ctx.db.patch(intent._id, { status });
  if (intent.creditReservationRef) await settleCredit(ctx, intent.creditReservationRef, 'released');
  for (const r of await ctx.db
    .query('ordInventoryReservations')
    .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
    .collect())
    if (r.status === 'held') await ctx.db.patch(r._id, { status: 'released' });
}

export const fail = internalMutation({
  args: { intentId: v.id('ordCheckoutIntents') },
  handler: async (ctx, a) => {
    const i = await ctx.db.get(a.intentId);
    if (i) await releaseIntent(ctx, i, 'failed');
  },
});

/** Hourly safety net: intents past their expiry release their holds. */
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const status of ['created', 'session_open'] as const) {
      const rows = await ctx.db
        .query('ordCheckoutIntents')
        .withIndex('by_status_expires', (q) => q.eq('status', status).lte('expiresAt', now))
        .take(100);
      for (const i of rows) await releaseIntent(ctx, i, 'expired');
    }
  },
});

export const intent = internalQuery({
  args: { intentId: v.id('ordCheckoutIntents') },
  handler: (ctx, a) => ctx.db.get(a.intentId),
});

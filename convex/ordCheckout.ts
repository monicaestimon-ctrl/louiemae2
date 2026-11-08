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
import { viewer } from './holmAccess';
import { requireFlag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { addressKey } from '../lib/delivery/destination';
import { addressArg, lineArg } from './dlvEstimates';
import { snapshotForIntent } from './prgAttribution';

const INTENT_MS = 30 * 60_000;

export type IntentResult =
  | { status: 'created' | 'existing'; intentId: Id<'ordCheckoutIntents'>; totalMinor: number; lines: { name: string; unitMinor: number; packs: number }[]; deliveryMinor: number; taxMinor: number; email?: string }
  | { status: 'price_changed'; totalMinor: number; deliveryMinor: number; taxMinor: number; merchandiseMinor: number };

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
  },
  handler: async (ctx, a): Promise<IntentResult> => {
    requireFlag('RETAIL_ZUO_CHECKOUT_ENABLED');
    if (!/^[\w-]{16,80}$/.test(a.idempotencyKey)) throw new CommerceError('INVALID_INPUT', 'Bad idempotency key');
    const existing = await ctx.db.query('ordCheckoutIntents').withIndex('by_key', (q) => q.eq('idempotencyKey', a.idempotencyKey)).first();
    if (existing) {
      if (existing.status !== 'created' && existing.status !== 'session_open') throw new CommerceError('QUOTE_EXPIRED', `Intent ${existing.status}`);
      return { status: 'existing', intentId: existing._id, totalMinor: existing.totalMinor, deliveryMinor: existing.deliveryMinor, taxMinor: existing.taxMinor, lines: existing.lineSnapshot.map((l) => ({ name: l.name, unitMinor: l.unitPackMinor, packs: l.packs })), ...(existing.buyer.email ? { email: existing.buyer.email } : {}) };
    }
    const now = Date.now();
    const est = await ctx.db.get(a.estimateId);
    if (!est || est.channel !== 'retail') throw new CommerceError('QUOTE_EXPIRED', 'Estimate not found');
    if (est.expiresAt <= now) throw new CommerceError('QUOTE_EXPIRED', 'Estimate expired');
    if (est.destination.precision !== 'full' || est.destination.addressHash !== addressKey(a.address)) throw new CommerceError('QUOTE_EXPIRED', 'Address changed since the estimate');
    if (est.cartHash !== cartHash(a.lines as LineInput[], 'retail') || est.service !== a.service) throw new CommerceError('QUOTE_EXPIRED', 'Cart or service changed since the estimate');
    if (est.status !== 'ok') throw new CommerceError('DELIVERY_QUOTE_REQUIRED');
    // Recompute against current prices, stock, sources and config; never charge a stale total.
    const fresh = await computeEstimate(ctx, { lines: a.lines as LineInput[], channel: 'retail', destination: { zip: a.address.postalCode.slice(0, 5), address: a.address }, service: a.service }, now);
    if (fresh.status !== 'ok' || fresh.deliveryMinor === undefined) throw new CommerceError('DELIVERY_QUOTE_REQUIRED');
    if (fresh.taxMinor === undefined) throw new CommerceError('POLICY_NOT_APPROVED', 'No approved tax estimate for this state');
    const totalMinor = fresh.merchandiseMinor + fresh.deliveryMinor + fresh.taxMinor;
    if (totalMinor !== a.acceptTotalMinor) {
      await bumpMetric(ctx, 'checkout.price_changed');
      return { status: 'price_changed', totalMinor, deliveryMinor: fresh.deliveryMinor, taxMinor: fresh.taxMinor, merchandiseMinor: fresh.merchandiseMinor };
    }
    const claim = await claimKey(ctx, `checkout:${a.idempotencyKey}`, 'checkout');
    if (claim.duplicate) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Duplicate checkout key');
    const me = await viewer(ctx);
    const intentId = await ctx.db.insert('ordCheckoutIntents', {
      idempotencyKey: a.idempotencyKey,
      estimateId: est._id,
      cartHash: est.cartHash,
      channel: 'retail',
      buyer: { ...(me ? { userId: me.userId } : {}), ...(a.email || me?.email ? { email: (a.email || me!.email).trim().toLowerCase() } : {}) },
      lineSnapshot: fresh.lines.map((l) => ({
        lineKey: l.lineKey,
        variantId: l.variant._id,
        productId: l.productId,
        name: l.name,
        packs: l.packs,
        pieces: l.pieces,
        unitPackMinor: l.unitPackMinor,
        discountMinor: 0,
        creditMinor: 0,
        commissionCategory: l.category,
        supplierCode: l.supplierCode,
        ...(l.costRevisionId ? { costRevisionId: l.costRevisionId } : {}),
        ...(l.priceRevisionId ? { priceRevisionId: l.priceRevisionId } : {}),
      })),
      merchandiseMinor: fresh.merchandiseMinor,
      deliveryMinor: fresh.deliveryMinor,
      taxMinor: fresh.taxMinor,
      creditMinor: 0,
      totalMinor,
      status: 'created',
      expiresAt: now + INTENT_MS,
      createdAt: now,
    });
    // Zuo has no live stock count: the reservation records the packs held for this intent, and
    // operations confirms supplier availability before ordering (paid-order exceptions otherwise).
    for (const l of fresh.lines) await ctx.db.insert('ordInventoryReservations', { variantId: l.variant._id, packs: l.packs, intentId, expiresAt: now + INTENT_MS, status: 'held' });
    // Freeze attribution and rate protection with the accepted lines (S27).
    const snapshotId = await snapshotForIntent(ctx, { intentId, visitorKey: a.visitorKey, buyer: { ...(me ? { userId: me.userId } : {}), ...(a.email ? { email: a.email.trim().toLowerCase() } : {}) }, channel: 'retail', lines: fresh.lines.map((l) => ({ lineKey: l.lineKey, productId: l.productId, variantId: l.variant._id, category: l.category })) });
    if (snapshotId) await ctx.db.patch(intentId, { attributionSnapshotId: snapshotId });
    await setKeyResult(ctx, `checkout:${a.idempotencyKey}`, intentId);
    return { status: 'created', intentId, totalMinor, deliveryMinor: fresh.deliveryMinor, taxMinor: fresh.taxMinor, lines: fresh.lines.map((l) => ({ name: l.name, unitMinor: l.unitPackMinor, packs: l.packs })) };
  },
});

export const attachSession = internalMutation({
  args: { intentId: v.id('ordCheckoutIntents'), sessionId: v.string() },
  handler: async (ctx, a) => {
    const i = await ctx.db.get(a.intentId);
    if (!i || (i.status !== 'created' && i.status !== 'session_open')) throw new CommerceError('QUOTE_EXPIRED');
    if (i.stripeSessionId && i.stripeSessionId !== a.sessionId) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Intent already has a different session');
    await ctx.db.patch(i._id, { stripeSessionId: a.sessionId, status: 'session_open' });
  },
});

/** Ends an intent without payment and releases its reservations (session expired or creation failed). */
export async function releaseIntent(ctx: MutationCtx, intent: Doc<'ordCheckoutIntents'>, status: 'expired' | 'failed') {
  if (intent.status === 'paid' || intent.status === 'exception') return;
  await ctx.db.patch(intent._id, { status });
  for (const r of await ctx.db.query('ordInventoryReservations').withIndex('by_intent', (q) => q.eq('intentId', intent._id)).collect()) if (r.status === 'held') await ctx.db.patch(r._id, { status: 'released' });
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
      const rows = await ctx.db.query('ordCheckoutIntents').withIndex('by_status_expires', (q) => q.eq('status', status).lte('expiresAt', now)).take(100);
      for (const i of rows) await releaseIntent(ctx, i, 'expired');
    }
  },
});

export const intent = internalQuery({ args: { intentId: v.id('ordCheckoutIntents') }, handler: (ctx, a) => ctx.db.get(a.intentId) });

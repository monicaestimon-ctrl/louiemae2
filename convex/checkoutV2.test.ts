// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { submitWith, type Transport } from './ediZuo';
import { refundSplit } from './ordReturns';
import { isCommerceError } from '../lib/errors';
import { SPLIT_MAY, SPLIT_WILL, splitDisclosure } from '../lib/customerCopy';
import { quoteOnlyReasons, zipRegion } from '../lib/delivery/destination';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
const NOW = Date.now();
const ADDRESS = { line1: '1 Main St', city: 'Stockton', state: 'CA', postalCode: '95206', country: 'US' };

beforeEach(() => {
  process.env.CJ_ADMIN_EMAILS = ADMIN;
  process.env.DELIVERY_AUTOMATION_ENABLED = 'true';
  process.env.RETAIL_ZUO_CHECKOUT_ENABLED = 'true';
});
afterEach(() => {
  for (const k of ['CJ_ADMIN_EMAILS', 'DELIVERY_AUTOMATION_ENABLED', 'RETAIL_ZUO_CHECKOUT_ENABLED', 'EDI_ZUO_ENABLED']) delete process.env[k];
});

const FREIGHT = {
  rule: { carrier: 'test', service: 'ground', effectiveFrom: 0, dimDivisorMm3PerG: 5_021, ground: { maxLongestMm: 2_743, maxLengthPlusGirthMm: 4_191, maxWeightG: 68_039 }, ltl: { maxLongestMm: 3_658, maxWeightG: 907_185, maxCartons: 20 } },
  originZip: '95206',
  zip3Zones: { '952': 'Z1', '850': 'Z2', '100': 'Z3' },
  groundPerKgMinorByZone: { Z1: 150, Z2: 250, Z3: 400 },
  groundMinimumMinor: 2_500,
  ltlPerKgMinorByZone: { Z1: 300, Z2: 400, Z3: 600 },
  ltlMinimumMinor: 31_500,
  residentialMinor: 5_000,
  liftgateMinor: 5_000,
  uncertaintyBps: 1_000,
  taxBpsByState: { CA: 825 },
};

async function setup(opts: { approveMixed?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${userId}|s`, email: ADMIN });
  await t.mutation(internal.sysConfig.seed, {});
  await admin.mutation(api.sysConfig.propose, { kind: 'carrierRule', key: 'zuo-freight', value: FREIGHT, note: 'test carrier', decision: 'D-03' });
  const { records } = await admin.query(api.sysConfig.list, { status: 'proposed' });
  const keys = ['freshness-default', 'delivery-ladder', 'zuo-95206-curbside', 'estimate-policy', ...(opts.approveMixed ? ['mixed-zuo-ashcroft'] : [])];
  for (const r of records.filter((x) => keys.includes(x.key) || (x.key === 'zuo-freight' && x.createdBy === ADMIN))) await admin.mutation(api.sysConfig.approve, { id: r._id });
  // A published, gate-passing Zuo product (built directly; the publication path is tested in catalogV2.test.ts).
  const ids = await t.run(async (ctx) => {
    const supplierId = await ctx.db.insert('catSuppliers', { code: 'zuo', name: 'Zuo', publicAttributionAllowed: false, fulfillmentRoute: 'manual_dealer_zuo', freshnessKey: 'freshness-default', createdAt: 1 });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: 'zuo:111182', draft: { name: 'Mara dining chair', description: 'Oak', category: 'Dining chair', images: [], referenceImages: [], sourceUrl: '', supplierName: 'Zuo', supplierContact: '', facts: '', packaging: '', currency: 'USD', usdRate: 1, variants: [], conflicts: [], factsApproved: true, imagesApproved: true, referencePermission: true }, revision: 1, updatedAt: 1 });
    await ctx.db.insert('catProductMeta', { productId, supplierId, commissionCategory: 'furniture', navCategory: 'Dining chair', louieMaeName: 'Mara dining chair', slug: 'mara', slugHistory: [], supplierName: 'Zuo chair', holds: [], stage: 'published', createdAt: 1, updatedAt: 1 });
    const variantId = await ctx.db.insert('catVariants', { productId, supplierId, supplierSku: '111182', packId: '1', optionKey: 'oak', supplierVariantName: 'Oak', louieMaeVariantName: 'Oak', sizeClass: 'MEDIUM', piecesPerPack: 2, orderMinimumPacks: 1, orderIncrementPacks: 1, availability: 'in_stock', fulfillmentRoute: 'manual_dealer_zuo', marginPolicyKey: 'zuo-approved-5', holds: [], referralEligible: true, createdAt: 1, updatedAt: 1 });
    const obs = await ctx.db.insert('catSourceObservations', { supplierId, variantId, field: 'stock', extractedValue: 'in_stock', observedAt: NOW - 3_600_000, contentHash: 's1', verifier: 't', confidence: 'confirmed', createdAt: 1 });
    void obs;
    const costId = await ctx.db.insert('catCostRevisions', { variantId, wholesaleMinor: 11_500, currency: 'USD', dutiesMinor: null, dutiesConfirmedZero: true, inboundFreightMinor: null, inboundConfirmedZero: true, supplierFeesMinor: null, feesConfirmedZero: true, mapMinor: null, mapUnitBasis: 'pack', mapSource: 'none', mapApplicability: 'not_applicable', costSource: 't', verifiedAt: NOW - 3_600_000, observationIds: [], createdAt: 1, createdBy: 't', effectiveFrom: 0, source: 't' });
    await ctx.db.insert('catCartons', { variantId, index: 0, cartonsPerPack: 1, lengthMm: 610, widthMm: 508, heightMm: 914, grossWeightG: 13_608, supplierMethod: 'ground', createdAt: 1 });
    const priceId = await ctx.db.insert('catPriceRevisions', { variantId, channel: 'retail', packPriceMinor: 45_806, piecePriceMinorInfo: 22_903, marginPolicyKey: 'zuo-approved-5', marginPolicyVersion: 1, roundingPolicyVersion: 1, status: 'approved', origin: 'import_approved', createdAt: 1, createdBy: 't', effectiveFrom: 0, source: 't' });
    await ctx.db.patch(variantId, { currentCostRevisionId: costId, retailPriceRevisionId: priceId });
    await ctx.db.insert('commerceListings', { productId, channel: 'retail', published: true, revision: 1, updatedAt: 1, snapshot: { name: 'Mara dining chair', description: 'Oak', category: 'Dining chair', images: [], facts: '', variants: [{ id: variantId, name: 'Oak', minimum: 1, increment: 1, price: 45_806 }] } });
    // An Ashcroft product on its existing launch rules.
    const ashId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:bench', draft: { name: 'Beckett bench', description: '', category: 'bench', images: [], referenceImages: [], sourceUrl: '', supplierName: '', supplierContact: '', facts: '', packaging: '', currency: 'USD', usdRate: 1, variants: [], conflicts: [], factsApproved: true, imagesApproved: true, referencePermission: true }, revision: 1, updatedAt: 1 });
    await ctx.db.insert('commerceListings', { productId: ashId, channel: 'retail', published: true, revision: 1, updatedAt: 1, snapshot: { name: 'Beckett bench', description: '', category: 'bench', images: [], facts: '', variants: [{ id: 'b1', name: 'Default Title', minimum: 1, increment: 1, price: 60_000 }] }, fulfillment: [{ id: 'b1', name: 'Default Title', sku: 'BEN123', cost: 300, minimum: 1, increment: 1, retail: 60_000, commercial: 0 }] });
    return { productId, variantId, ashId };
  });
  return { t, admin, ...ids };
}

async function processEvents(t: ReturnType<typeof convexTest>) {
  const pending = await t.run((ctx) => ctx.db.query('sysPaymentEvents').collect());
  for (const ev of pending) if (ev.status === 'received') await t.mutation(internal.ordPayments.process, { id: ev._id });
}

const zuoLine = (s: { productId: Id<'commerceProducts'>; variantId: Id<'catVariants'> }, packs = 1) => ({ productId: s.productId, variantId: s.variantId, packs });

async function paidOrder(s: Awaited<ReturnType<typeof setup>>, lines: { productId: string; variantId: string; packs: number }[], eventId = 'evt_1') {
  const est = await s.t.mutation(api.dlvEstimates.estimate, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'visitor-1234567890' });
  expect(est.status).toBe('ok');
  const intent = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor!, email: 'buyer@x.com' });
  if (intent.status === 'price_changed') throw new Error('unexpected price change');
  await s.t.mutation(internal.ordCheckout.attachSession, { intentId: intent.intentId, sessionId: 'cs_1' });
  const payload = { id: 'cs_1', intentId: intent.intentId, payment_status: 'paid', amount_total: intent.totalMinor, currency: 'usd', payment_intent: 'pi_1', email: 'buyer@x.com', shipping: ADDRESS };
  await s.t.mutation(internal.ordPayments.receive, { eventId, type: 'checkout.session.completed', livemode: false, payloadHash: 'h', payload });
  await processEvents(s.t);
  return { est, intent, payload };
}

describe('delivery estimates (S17, S18)', () => {
  it('estimates a Zuo item, keeps ZIP estimates non-binding and shows tax only with a full address', async () => {
    const s = await setup();
    const zip = await s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'visitor-1234567890' });
    expect(zip.status).toBe('ok');
    expect(zip.deliveryChargeMinor).toBe(4_999);
    expect(zip.taxMinor).toBeNull();
    expect(zip.note).toMatch(/Estimate/);
    const full = await s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'visitor-1234567890' });
    expect(full.taxMinor).toBe(Math.ceil(((45_806 + 4_999) * 825) / 10_000));
    expect(full.totalMinor).toBe(45_806 + 4_999 + full.taxMinor!);
  });

  it('routes Alaska, Hawaii, PO boxes and unzoned ZIPs to a quote (DEL03)', async () => {
    const s = await setup();
    for (const zip of ['99501', '96813', '10001x']) {
      const r = await s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip, visitorKey: 'visitor-1234567890' }).catch((e) => ({ status: 'error', e }));
      expect(r.status === 'quote_required' || r.status === 'error').toBe(true);
    }
    const unzoned = await s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip: '60601', visitorKey: 'visitor-1234567890' });
    expect(unzoned.status).toBe('quote_required');
    expect(unzoned.reasons).toEqual(['Request a delivery quote']);
    expect(quoteOnlyReasons('95206', { ...ADDRESS, line1: 'PO Box 12' })).toContain('PO boxes need a delivery quote');
    expect(zipRegion('00901')).toBe('PR');
  });

  it('is off unless the flag is on, refuses proposed policies, and ignores client prices (SEC01)', async () => {
    const s = await setup();
    const r = await s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'visitor-1234567890', clientPrices: { [s.variantId]: 1 } });
    expect(r.merchandiseMinor).toBe(45_806);
    const metric = await s.t.run((ctx) => ctx.db.query('sysMetrics').collect());
    expect(metric.some((m) => m.name === 'security.client_price_ignored')).toBe(true);
    delete process.env.DELIVERY_AUTOMATION_ENABLED;
    await expect(s.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'v' })).rejects.toSatisfy((e) => isCommerceError(e, 'FEATURE_DISABLED'));
  });

  it('needs the mixed-cart decision (D-12) before combining Zuo and Ashcroft, then sums groups once', async () => {
    const s = await setup();
    const mixed = [zuoLine(s), { productId: s.ashId, variantId: 'b1', packs: 1 }];
    await expect(s.t.mutation(api.dlvEstimates.estimate, { lines: mixed, channel: 'retail', zip: '95206', visitorKey: 'visitor-1234567890' })).rejects.toSatisfy((e) => isCommerceError(e, 'POLICY_NOT_APPROVED'));
    const s2 = await setup({ approveMixed: true });
    const r = await s2.t.mutation(api.dlvEstimates.estimate, { lines: [zuoLine(s2), { productId: s2.ashId, variantId: 'b1', packs: 1 }], channel: 'retail', zip: '95206', visitorKey: 'visitor-1234567890' });
    expect(r.status).toBe('ok');
    expect(r.deliveryChargeMinor).toBe(4_999 + 2_900); // Zuo ladder + Ashcroft per-item bench fee
    expect(r.splitKnown).toBe(true);
  });
});

describe('checkout and verified payment (S19, DEL04, FUL01)', () => {
  it('creates one order and one child per supplier from a verified event, exactly once', async () => {
    const s = await setup({ approveMixed: true });
    const lines = [zuoLine(s, 2), { productId: s.ashId, variantId: 'b1', packs: 1 }];
    const { intent, payload } = await paidOrder(s, lines);
    // duplicate delivery of the same and of a new event id for the same session
    await s.t.mutation(internal.ordPayments.receive, { eventId: 'evt_1', type: 'checkout.session.completed', livemode: false, payloadHash: 'h', payload });
    await s.t.mutation(internal.ordPayments.receive, { eventId: 'evt_2', type: 'checkout.session.completed', livemode: false, payloadHash: 'h', payload });
    await processEvents(s.t);
    const orders = await s.t.run((ctx) => ctx.db.query('ordOrders').collect());
    expect(orders).toHaveLength(1);
    expect(orders[0].totals.total).toBe(intent.totalMinor);
    const children = await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect());
    expect(children.map((c) => c.route).sort()).toEqual(['manual_dealer_ashcroft', 'manual_dealer_zuo']);
    const allocs = await s.t.run((ctx) => ctx.db.query('ordAllocations').collect());
    expect(allocs.reduce((t, a) => t + a.pieces, 0)).toBe(4 + 1); // 2 pairs + 1 bench, each allocated once
    const lineRows = await s.t.run((ctx) => ctx.db.query('ordOrderLines').collect());
    expect(lineRows.reduce((t, l) => t + l.taxMinor, 0)).toBe(orders[0].totals.tax);
    expect(lineRows.reduce((t, l) => t + l.deliveryAllocMinor, 0)).toBe(orders[0].totals.delivery);
    const email = await s.t.run((ctx) => ctx.db.query('sysNotifications').first());
    expect(email!.text).toContain(SPLIT_WILL);
  });

  it('requires reconfirmation when anything changes, and refuses stale estimates', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await s.t.mutation(api.dlvEstimates.estimate, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'visitor-1234567890' });
    await expect(s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines: [zuoLine(s, 2)], address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! })).rejects.toSatisfy((e) => isCommerceError(e, 'QUOTE_EXPIRED'));
    await expect(s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: { ...ADDRESS, line1: '2 Main St' }, service: 'curbside', acceptTotalMinor: est.totalMinor! })).rejects.toSatisfy((e) => isCommerceError(e, 'QUOTE_EXPIRED'));
    // A price change after the estimate: the server returns the new total instead of charging it.
    await s.t.run(async (ctx) => {
      const p = (await ctx.db.query('catPriceRevisions').first())!;
      await ctx.db.patch(p._id, { packPriceMinor: 47_000 });
      const l = (await ctx.db.query('commerceListings').filter((q) => q.eq(q.field('productId'), s.productId)).first())!;
      await ctx.db.patch(l._id, { snapshot: { ...l.snapshot, variants: l.snapshot.variants.map((x) => ({ ...x, price: 47_000 })) } });
    });
    const r = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! });
    expect(r.status).toBe('price_changed');
    const ok = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: r.totalMinor });
    expect(ok.status).toBe('created');
    const again = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: r.totalMinor });
    expect(again.status).toBe('existing');
  });

  it('sends a payment after expiry or with a mismatched total to the paid-order exception queue', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await s.t.mutation(api.dlvEstimates.estimate, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'visitor-1234567890' });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! });
    if (intent.status === 'price_changed') throw new Error();
    await s.t.mutation(internal.ordCheckout.attachSession, { intentId: intent.intentId, sessionId: 'cs_1' });
    await s.t.mutation(internal.ordPayments.receive, { eventId: 'e1', type: 'checkout.session.completed', livemode: false, payloadHash: 'h', payload: { id: 'cs_1', intentId: intent.intentId, payment_status: 'paid', amount_total: intent.totalMinor - 1, currency: 'usd', payment_intent: 'pi_9', email: 'b@x.com' } });
    await processEvents(s.t);
    expect(await s.t.run((ctx) => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    const ex = await s.t.run((ctx) => ctx.db.query('ordPaidExceptions').collect());
    expect(ex[0]).toMatchObject({ reason: 'total_mismatch', status: 'open', paymentIntentId: 'pi_9' });
  });

  it('releases reservations when the session expires', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await s.t.mutation(api.dlvEstimates.estimate, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'visitor-1234567890' });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'key-abcdefghijklmnop', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! });
    if (intent.status === 'price_changed') throw new Error();
    await s.t.mutation(internal.ordPayments.receive, { eventId: 'e-exp', type: 'checkout.session.expired', livemode: false, payloadHash: 'h', payload: { id: 'cs_1', intentId: intent.intentId, payment_status: 'unpaid', amount_total: null, currency: 'usd', payment_intent: null, email: '' } });
    await processEvents(s.t);
    const res = await s.t.run((ctx) => ctx.db.query('ordInventoryReservations').collect());
    expect(res.every((r) => r.status === 'released')).toBe(true);
  });
});

describe('fulfillment (S21, FUL04, FUL05, DEL05)', () => {
  it('ships partially, keeps the other supplier intact on cancel, and never marks the whole order delivered early', async () => {
    const s = await setup({ approveMixed: true });
    await paidOrder(s, [zuoLine(s, 2), { productId: s.ashId, variantId: 'b1', packs: 1 }]);
    const zuoQueue = await s.admin.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' });
    const ashQueue = await s.admin.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_ashcroft' });
    expect(zuoQueue).toHaveLength(1);
    expect(zuoQueue[0].items[0]).toMatchObject({ supplierSku: '111182', packs: 2, pieces: 4 });
    await s.admin.mutation(api.ordFulfillment.markSubmitted, { supplierOrderId: zuoQueue[0]._id, supplierPo: 'PO-1', acceptedCostMinor: 47_380 });
    // Partial shipment of 2 of 4 pieces
    const shipId = await s.admin.mutation(api.ordFulfillment.recordShipment, { supplierOrderId: zuoQueue[0]._id, items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 2 }], trackingUrl: 'https://track.example/1' });
    let order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('paid'); // nothing fully shipped yet
    await expect(s.admin.mutation(api.ordFulfillment.recordShipment, { supplierOrderId: zuoQueue[0]._id, items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 3 }] })).rejects.toThrow(/More pieces/);
    await s.admin.mutation(api.ordFulfillment.recordShipment, { supplierOrderId: zuoQueue[0]._id, items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 2 }] });
    order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_shipped');
    await s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: shipId });
    order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_shipped'); // first shipment only covers half the pair set
    // Ashcroft rejects: only its allocation changes
    await s.admin.mutation(api.ordFulfillment.cancelAllocations, { supplierOrderId: ashQueue[0]._id, allocationIds: [ashQueue[0].items[0].allocationId], reason: 'Dealer rejected' });
    const children = await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect());
    expect(children.find((c) => c.supplierCode === 'zuo')!.status).toBe('shipped');
    expect(children.find((c) => c.supplierCode === 'ashcroft')!.status).toBe('cancelled');
    const notes = await s.t.run((ctx) => ctx.db.query('sysNotifications').collect());
    expect(notes.find((n) => n.template === 'shipment')!.text).toMatch(/Still to ship/);
    const status = await s.t.query(api.ordFulfillment.orderStatus, { number: order.number, email: 'buyer@x.com' });
    expect(status!.disclosure).toBe(SPLIT_WILL);
    expect(JSON.stringify(status)).not.toMatch(/zuo|ashcroft|111182/i); // no supplier names or SKUs
    // Freight invoice above the estimate: internal variance only
    const v = await s.admin.mutation(api.ordFulfillment.recordFreightActual, { supplierOrderId: zuoQueue[0]._id, estimatedMinor: 4_000, actualMinor: 6_000, invoiceRef: 'INV-1' });
    expect(v).toEqual({ varianceMinor: 2_000, customerCharged: 0 });
  });
});

describe('EDI adapter (S23, FUL02, FUL03)', () => {
  it('sends only the Zuo child, once, and blocks resubmission while uncertain', async () => {
    const s = await setup({ approveMixed: true });
    await paidOrder(s, [zuoLine(s, 1), { productId: s.ashId, variantId: 'b1', packs: 1 }]);
    const child = (await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect())).find((c) => c.supplierCode === 'zuo')!;
    const ash = (await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect())).find((c) => c.supplierCode === 'ashcroft')!;
    const sent: unknown[] = [];
    const uncertain: Transport = { send: async (p) => (sent.push(p), { outcome: 'uncertain' }) };
    await expect(s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).rejects.toSatisfy((e) => isCommerceError(e, 'FEATURE_DISABLED'));
    process.env.EDI_ZUO_ENABLED = 'true';
    await expect(s.t.run((ctx) => submitWith(ctx, ash._id, uncertain, 't'))).rejects.toSatisfy((e) => isCommerceError(e, 'FORBIDDEN'));
    expect(await s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).toBe('uncertain');
    expect(JSON.stringify(sent[0])).toContain('111182');
    expect(JSON.stringify(sent[0])).not.toContain('BEN123');
    await expect(s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).rejects.toSatisfy((e) => isCommerceError(e, 'PAYMENT_RECONCILIATION_REQUIRED'));
    await expect(s.admin.mutation(api.ordFulfillment.markSubmitted, { supplierOrderId: child._id, supplierPo: 'X', acceptedCostMinor: 1 })).rejects.toThrow();
    await s.admin.mutation(api.ediZuo.reconcileUncertain, { supplierOrderId: child._id, supplierReceived: true, note: 'Zuo confirmed by phone' });
    const after = (await s.t.run((ctx) => ctx.db.get(child._id)))!;
    expect(after).toMatchObject({ status: 'submitted' });
    expect(sent).toHaveLength(1);
  });
});

describe('returns and quotes (S20, S22)', () => {
  it('splits refunds into merchandise, tax, delivery, credit and cash', () => {
    const line = { pieces: 4, unitPackMinor: 45_806, packs: 2, discountMinor: 0, creditMinor: 10_000, taxMinor: 8_000, deliveryAllocMinor: 4_000, refundedMinor: 0 };
    const r = refundSplit(line, 2, { windowDays: 30, restockingBps: 1_000, refundOriginalDelivery: false, customerPaysReturnFreight: true, damageClaimDays: 3, requiresAuthorization: true }, false);
    expect(r).toEqual({ merchandise: 41_226, tax: 4_000, delivery: 0, creditRestored: 5_000, cash: 41_226 - 5_000 + 4_000, restocking: 4_580 });
    const goodwill = refundSplit(line, 2, { windowDays: 30, restockingBps: 1_000, refundOriginalDelivery: false, customerPaysReturnFreight: true, damageClaimDays: 3, requiresAuthorization: true }, true);
    expect(goodwill.restocking).toBe(0);
    expect(goodwill.delivery).toBe(2_000);
  });

  it('needs an approved return policy before a return can be recorded', async () => {
    const s = await setup();
    await paidOrder(s, [zuoLine(s)]);
    const line = (await s.t.run((ctx) => ctx.db.query('ordOrderLines').first()))!;
    await expect(s.admin.mutation(api.ordReturns.request, { orderLineId: line._id, pieces: 1, reason: 'Changed mind', goodwill: false })).rejects.toSatisfy((e) => isCommerceError(e, 'POLICY_NOT_APPROVED'));
  });

  it('versions quotes, refuses below-minimum trade prices and freezes accepted versions', async () => {
    const s = await setup();
    const projectId = await s.t.run((ctx) => ctx.db.insert('commerceProjects', { token: 't', channel: 'house', name: 'n', email: 'e@x.com', phone: '', business: '', address: { line1: '', city: '', state: '', postalCode: '', country: 'US' }, notes: '', requested: [], lines: [], delivery: 0, tax: 0, revision: 1, status: 'new', createdAt: 1, updatedAt: 1 }));
    const low = await s.admin.mutation(api.ordQuotes.saveVersion, { projectId, lines: [{ productId: s.productId, variantId: s.variantId, packs: 1, unitPackMinor: 30_000, discountMinor: 0 }], service: 'curbside', deliveryMinor: 0, taxMinor: 0, validDays: 7, terms: 'Net' });
    expect(low.checks.margin).toBe(false);
    await expect(s.admin.mutation(api.ordQuotes.markSent, { versionId: low.id })).rejects.toThrow();
    const ok = await s.admin.mutation(api.ordQuotes.saveVersion, { projectId, lines: [{ productId: s.productId, variantId: s.variantId, packs: 1, unitPackMinor: 45_806, discountMinor: 0 }], service: 'curbside', deliveryMinor: 4_999, taxMinor: 0, validDays: 7, terms: 'Net' });
    expect(ok.checks).toMatchObject({ map: true, margin: true, policy: true });
    await s.admin.mutation(api.ordQuotes.markSent, { versionId: ok.id });
    await s.admin.mutation(api.ordQuotes.accept, { versionId: ok.id, acceptedBy: 'Client by email' });
    const v2 = await s.admin.mutation(api.ordQuotes.saveVersion, { projectId, lines: [{ productId: s.productId, variantId: s.variantId, packs: 2, unitPackMinor: 45_806, discountMinor: 0 }], service: 'curbside', deliveryMinor: 4_999, taxMinor: 0, validDays: 7, terms: 'Net' });
    const versions = await s.admin.query(api.ordQuotes.versions, { projectId });
    expect(versions.map((x) => [x.version, x.status])).toEqual([[3, 'draft'], [2, 'accepted'], [1, 'superseded']]);
    void v2;
  });
});

describe('customer copy (FUL05)', () => {
  it('uses the exact disclosure strings', () => {
    expect(splitDisclosure(false)).toBe(SPLIT_MAY);
    expect(splitDisclosure(true)).toBe(SPLIT_WILL);
    expect(SPLIT_MAY).toContain('will not add delivery charges beyond the amount confirmed at checkout');
  });
});

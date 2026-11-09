// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvexForDataModel } from 'convex-test';
import { signRequest } from '../lib/delivery/requestProof';
import { randomBytes } from 'node:crypto';
import type { FunctionArgs } from 'convex/server';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { DataModel, Id } from './_generated/dataModel';
import { buildPayload, submitWith, type Transport } from './ediZuo';
import { refundSplit } from './ordReturns';
import { isCommerceError, commerceErrorData } from '../lib/errors';
import { SPLIT_MAY, SPLIT_WILL, splitDisclosure } from '../lib/customerCopy';
import { quoteOnlyReasons, zipRegion, STANDARD_ACCESS } from '../lib/delivery/destination';
import { exemptionFor } from './dlvTaxExemptions';
import { groupFreight, resolveLines, type FreightConfig, type ResolvedLine } from './dlvEngine';
import { digest } from './dlvSecurity';
import { availableAfterCommitments } from './ordInventory';
import { applyCreditEvent } from './ldgCore';
import { reserve as reserveCredit, settle as settleCredit } from './ldgCredits';

const PERIMETER_SECRET = '1'.repeat(64);
async function estimateViaGateway(
  t: TestConvexForDataModel<DataModel>,
  input: Omit<FunctionArgs<typeof api.dlvTaxActions.estimate>, 'proof'>
) {
  process.env.DELIVERY_REQUEST_SECRET = PERIMETER_SECRET;
  const proof = await signRequest(PERIMETER_SECRET, 'estimate', input, {
    issuedAt: Date.now(),
    nonce: randomBytes(24).toString('hex'),
    rateKey: '2'.repeat(64),
  });
  return t.action(api.dlvTaxActions.estimate, { ...input, proof });
}
async function quoteViaGateway(
  t: TestConvexForDataModel<DataModel>,
  input: Omit<FunctionArgs<typeof api.dlvTaxActions.requestQuote>, 'proof'>
) {
  process.env.DELIVERY_REQUEST_SECRET = PERIMETER_SECRET;
  const proof = await signRequest(PERIMETER_SECRET, 'quote', input, {
    issuedAt: Date.now(),
    nonce: randomBytes(24).toString('hex'),
    rateKey: '2'.repeat(64),
  });
  return t.action(api.dlvTaxActions.requestQuote, { ...input, proof });
}
afterEach(() => {
  delete process.env.DELIVERY_REQUEST_SECRET;
});

const taxFixture = vi.hoisted(() => ({ fail: false }));
const paymentReadFixture = vi.hoisted(() => ({ session: vi.fn(), refunds: vi.fn() }));
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { retrieve: paymentReadFixture.session } };
    refunds = { list: paymentReadFixture.refunds };
    tax = {
      calculations: {
        create: async (a: any) => {
          if (taxFixture.fail) throw new Error('Fixture provider failure');
          const amount =
            a.line_items.reduce((n: number, l: any) => n + l.amount, 0) + a.shipping_cost.amount;
          const tax = Math.ceil((amount * 825) / 10000);
          return {
            id: `taxcalc_fixture_${amount}`,
            currency: 'usd',
            tax_amount_inclusive: 0,
            tax_amount_exclusive: tax,
            amount_total: amount + tax,
            line_items: {
              data: a.line_items.map((l: any, i: number) => ({
                reference: l.reference,
                amount_tax: i === 0 ? tax : 0,
              })),
            },
            shipping_cost: { amount_tax: 0 },
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          };
        },
      },
    };
  },
}));

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
const NOW = Date.now();
const ADDRESS = {
  recipientName: 'Fixture customer',
  access: STANDARD_ACCESS,
  phone: '+12095550100',
  line1: '1 Main St',
  city: 'Stockton',
  state: 'CA',
  postalCode: '95206',
  country: 'US',
};

beforeEach(() => {
  taxFixture.fail = false;
  paymentReadFixture.session.mockReset(); paymentReadFixture.refunds.mockReset();
  // Scheduled work (payment processing, email delivery) runs only when a test drives it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  process.env.CJ_ADMIN_EMAILS = ADMIN;
  process.env.DELIVERY_AUTOMATION_ENABLED = 'true';
  process.env.RETAIL_ZUO_CHECKOUT_ENABLED = 'true';
  process.env.TRADE_CALCULATOR_V2_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_only';
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of [
    'TRADE_CALCULATOR_V2_ENABLED',
    'STRIPE_SECRET_KEY',
    'TRADE_CHECKOUT_V2_ENABLED',
    'CJ_ADMIN_EMAILS',
    'DELIVERY_ADMIN_ROLES',
    'DELIVERY_AUTOMATION_ENABLED',
    'RETAIL_ZUO_CHECKOUT_ENABLED',
    'EDI_ZUO_ENABLED',
    'CREDIT_V2_ENABLED',
  ])
    delete process.env[k];
});

const FREIGHT = {
  fixedPaymentMinor: 0,
  evidenceRef: 'synthetic carrier matrix',
  verifiedAt: 0,
  validUntil: NOW + 86400000,
  pallet: {
    lengthMm: 1200,
    widthMm: 1200,
    maxHeightMm: 2000,
    maxGrossWeightG: 1000000,
    tareWeightG: 20000,
    maxPallets: 10,
    freightClass: 'fixture-class',
    packing: 'one_carton_per_pallet',
  },
  rule: {
    carrier: 'test',
    service: 'ground',
    effectiveFrom: 0,
    dimDivisorMm3PerG: 5_021,
    ground: { maxLongestMm: 2_743, maxLengthPlusGirthMm: 4_191, maxWeightG: 68_039 },
    ltl: { maxLongestMm: 3_658, maxWeightG: 907_185, maxCartons: 20 },
  },
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
  const service = await admin.mutation(api.sysConfig.propose, {
    kind: 'serviceLevel',
    key: 'delivery-curbside',
    value: {
      code: 'curbside',
      modes: {
        ground: {
          label: 'Parcel delivery',
          details: ['Standard parcel placement.'],
          evidenceRef: 'fixture',
        },
        ltl: {
          label: 'Curbside freight',
          details: ['No inside delivery or assembly.'],
          evidenceRef: 'fixture',
        },
        per_item: {
          label: 'Supplier standard delivery',
          details: ['Fixture supplier service.'],
          evidenceRef: 'fixture',
        },
      },
    },
    note: 'Synthetic test service terms',
  });
  await admin.mutation(api.sysConfig.approve, { id: service });
  const taxPolicy = await admin.mutation(api.sysConfig.propose, {
    kind: 'taxProviderPolicy',
    key: 'delivery-tax',
    value: {
      provider: 'stripe',
      validityMinutes: 15,
      categoryCodes: {
        furniture: 'txcd_99999999',
        decor: 'txcd_99999999',
        clothing: 'txcd_99999999',
      },
      shippingTaxCode: 'txcd_92010001',
    },
    note: 'Synthetic fixture tax provider',
  });
  await admin.mutation(api.sysConfig.approve, { id: taxPolicy });
  const control = await admin.mutation(api.sysConfig.propose, {
    kind: 'deliveryControls',
    key: 'delivery-controls',
    value: {
      automaticEnabled: true,
      suppliers: ['zuo'],
      origins: ['95206'],
      services: ['curbside'],
      zip3Allowlist: ['952', '850', '100'],
      blockedZip5: [],
    },
    note: 'Synthetic test lane coverage',
  });
  await admin.mutation(api.sysConfig.approve, { id: control });
  await admin.mutation(api.sysConfig.propose, {
    kind: 'carrierRule',
    key: 'zuo-freight',
    value: FREIGHT,
    note: 'test carrier',
    decision: 'D-03',
  });
  const { records } = await admin.query(api.sysConfig.list, { status: 'proposed' });
  const keys = [
    'freshness-default',
    'delivery-ladder',
    'zuo-95206-curbside',
    'estimate-policy',
    ...(opts.approveMixed ? ['mixed-zuo-ashcroft'] : []),
  ];
  for (const r of records.filter(
    (x) => keys.includes(x.key) || (x.key === 'zuo-freight' && x.createdBy === ADMIN)
  ))
    await admin.mutation(api.sysConfig.approve, { id: r._id });
  // A published, gate-passing Zuo product (built directly; the publication path is tested in catalogV2.test.ts).
  const ids = await t.run(async (ctx) => {
    const supplierId = await ctx.db.insert('catSuppliers', {
      code: 'zuo',
      name: 'Zuo',
      publicAttributionAllowed: false,
      fulfillmentRoute: 'manual_dealer_zuo',
      freshnessKey: 'freshness-default',
      createdAt: 1,
    });
    const productId = await ctx.db.insert('commerceProducts', {
      provider: 'zuo',
      sourceKey: 'zuo:111182',
      draft: {
        name: 'Mara dining chair',
        description: 'Oak',
        category: 'Dining chair',
        images: [],
        referenceImages: [],
        sourceUrl: '',
        supplierName: 'Zuo',
        supplierContact: '',
        facts: '',
        packaging: '',
        currency: 'USD',
        usdRate: 1,
        variants: [],
        conflicts: [],
        factsApproved: true,
        imagesApproved: true,
        referencePermission: true,
      },
      revision: 1,
      updatedAt: 1,
    });
    await ctx.db.insert('catProductMeta', {
      productId,
      supplierId,
      commissionCategory: 'furniture',
      navCategory: 'Dining chair',
      louieMaeName: 'Mara dining chair',
      slug: 'mara',
      slugHistory: [],
      supplierName: 'Zuo chair',
      holds: [],
      stage: 'published',
      createdAt: 1,
      updatedAt: 1,
    });
    const warehouseId = await ctx.db.insert('catWarehouses', {
      supplierId,
      code: 'stockton',
      evidenceRef: 'Fixture warehouse evidence', verifiedAt: NOW - 3600000, validUntil: NOW + 86400000,
      timezone: 'America/Los_Angeles', cutoffLocal: '14:00', services: ['ground', 'ltl'],
      originZip: '95206',
      state: 'CA',
      active: true,
    });
    const variantId = await ctx.db.insert('catVariants', {
      productId,
      warehouseId,
      supplierId,
      supplierSku: '111182',
      packId: '1',
      optionKey: 'oak',
      supplierVariantName: 'Oak',
      louieMaeVariantName: 'Oak',
      sizeClass: 'MEDIUM',
      piecesPerPack: 2,
      orderMinimumPacks: 1,
      orderIncrementPacks: 1,
      availability: 'in_stock',
      fulfillmentRoute: 'manual_dealer_zuo',
      marginPolicyKey: 'zuo-approved-5',
      holds: [],
      referralEligible: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const obs = await ctx.db.insert('catSourceObservations', {
      supplierId,
      variantId,
      field: 'stock',
      extractedValue: 'in_stock',
      observedAt: NOW - 3_600_000,
      contentHash: 's1',
      verifier: 't',
      confidence: 'confirmed',
      createdAt: 1,
    });
    void obs;
    const stockRevisionId = await ctx.db.insert('catStockRevisions', { variantId, warehouseId, warehouseFingerprint: await digest(await ctx.db.get(warehouseId)), quantity: '1000', unitBasis: 'pack', kind: 'available_to_sell', availability: 'in_stock', confirmed: true, piecesPerPack: 2, source: 'Fixture available-to-sell feed', note: 'Fixture', observedAt: NOW - 3600000, createdAt: 1, createdBy: 'fixture' });
    await ctx.db.patch(variantId, { currentStockRevisionId: stockRevisionId });
    const costId = await ctx.db.insert('catCostRevisions', {
      variantId,
      wholesaleMinor: 11_500,
      currency: 'USD',
      dutiesMinor: null,
      dutiesConfirmedZero: true,
      inboundFreightMinor: null,
      inboundConfirmedZero: true,
      supplierFeesMinor: null,
      feesConfirmedZero: true,
      mapMinor: null,
      mapUnitBasis: 'pack',
      mapSource: 'none',
      mapApplicability: 'not_applicable',
      costSource: 't',
      verifiedAt: NOW - 3_600_000,
      observationIds: [],
      createdAt: 1,
      createdBy: 't',
      effectiveFrom: 0,
      source: 't',
    });
    await ctx.db.insert('catCartons', {
      variantId,
      index: 0,
      cartonsPerPack: 1,
      lengthMm: 610,
      widthMm: 508,
      heightMm: 914,
      grossWeightG: 13_608,
      supplierMethod: 'ground',
      createdAt: 1,
    });
    const priceId = await ctx.db.insert('catPriceRevisions', {
      variantId,
      channel: 'retail',
      packPriceMinor: 45_806,
      piecePriceMinorInfo: 22_903,
      marginPolicyKey: 'zuo-approved-5',
      marginPolicyVersion: 1,
      roundingPolicyVersion: 1,
      status: 'approved',
      origin: 'import_approved',
      createdAt: 1,
      createdBy: 't',
      effectiveFrom: 0,
      source: 't',
    });
    await ctx.db.patch(variantId, {
      currentCostRevisionId: costId,
      retailPriceRevisionId: priceId,
    });
    await ctx.db.insert('commerceListings', {
      productId,
      channel: 'retail',
      published: true,
      revision: 1,
      updatedAt: 1,
      snapshot: {
        name: 'Mara dining chair',
        description: 'Oak',
        category: 'Dining chair',
        images: [],
        facts: '',
        variants: [{ id: variantId, name: 'Oak', minimum: 1, increment: 1, price: 45_806 }],
      },
    });
    // An Ashcroft product on its existing launch rules.
    const ashId = await ctx.db.insert('commerceProducts', {
      provider: 'ashcroft',
      sourceKey: 'ashcroft:bench',
      draft: {
        name: 'Beckett bench',
        description: '',
        category: 'bench',
        images: [],
        referenceImages: [],
        sourceUrl: '',
        supplierName: '',
        supplierContact: '',
        facts: '',
        packaging: '',
        currency: 'USD',
        usdRate: 1,
        variants: [],
        conflicts: [],
        factsApproved: true,
        imagesApproved: true,
        referencePermission: true,
      },
      revision: 1,
      updatedAt: 1,
    });
    await ctx.db.insert('commerceListings', {
      productId: ashId,
      channel: 'retail',
      published: true,
      revision: 1,
      updatedAt: 1,
      snapshot: {
        name: 'Beckett bench',
        description: '',
        category: 'bench',
        images: [],
        facts: '',
        variants: [{ id: 'b1', name: 'Default Title', minimum: 1, increment: 1, price: 60_000 }],
      },
      fulfillment: [
        {
          id: 'b1',
          name: 'Default Title',
          sku: 'BEN123',
          cost: 300,
          minimum: 1,
          increment: 1,
          retail: 60_000,
          commercial: 0,
        },
      ],
    });
    return { productId, variantId, ashId };
  });
  return { t, admin, ...ids };
}

async function processEvents(t: ReturnType<typeof convexTest>) {
  const pending = await t.run((ctx) => ctx.db.query('sysPaymentEvents').collect());
  for (const ev of pending)
    if (ev.status === 'received') await t.mutation(internal.ordPayments.process, { id: ev._id });
}

const zuoLine = (
  s: { productId: Id<'commerceProducts'>; variantId: Id<'catVariants'> },
  packs = 1
) => ({ productId: s.productId, variantId: s.variantId, packs });

async function paidOrder(
  s: Awaited<ReturnType<typeof setup>>,
  lines: { productId: string; variantId: string; packs: number }[],
  eventId = 'evt_1'
) {
  const est = await estimateViaGateway(s.t, {
    lines,
    channel: 'retail',
    zip: '95206',
    address: ADDRESS,
    visitorKey: 'visitor-1234567890',
  });
  expect(est.status).toBe('ok');
  const intent = await s.t.mutation(internal.ordCheckout.createIntent, {
    idempotencyKey: 'key-abcdefghijklmnop',
    estimateId: est.estimateId,
    guestCapability: est.guestCapability,
    lines,
    address: ADDRESS,
    service: 'curbside',
    acceptTotalMinor: est.totalMinor!,
    email: 'buyer@x.com',
  });
  if (intent.status === 'price_changed') throw new Error('unexpected price change');
  await s.t.mutation(internal.ordCheckout.attachSession, {
    intentId: intent.intentId,
    sessionId: 'cs_1',
  });
  const payload = {
    id: 'cs_1',
    intentId: intent.intentId,
    payment_status: 'paid',
    amount_total: intent.totalMinor,
    currency: 'usd',
    payment_intent: 'pi_1',
    email: 'buyer@x.com',
    shipping: ADDRESS,
  };
  await s.t.mutation(internal.ordPayments.receive, {
    eventId,
    type: 'checkout.session.completed',
    livemode: false,
    payloadHash: 'h',
    payload,
  });
  await processEvents(s.t);
  return { est, intent, payload };
}

describe('delivery estimates (S17, S18)', () => {
  it('limits demand to the warehouse count and requires confirmation for on-hand stock', async () => {
    const s = await setup();
    await s.t.run(async ctx => { const stock = (await ctx.db.query('catStockRevisions').first())!; await ctx.db.patch(stock._id, { validUntil: NOW + 15000 }); });
    expect((await s.t.run(ctx => resolveLines(ctx, [zuoLine(s)], 'retail', NOW)))[0].validUntil).toBe(NOW + 15000);
    await expect(s.t.run(ctx => resolveLines(ctx, [zuoLine(s, 1001)], 'retail', NOW))).rejects.toThrow(/warehouse quantity/);
    await s.t.run(async ctx => { const stock = (await ctx.db.query('catStockRevisions').first())!; await ctx.db.patch(stock._id, { kind: 'on_hand' }); });
    const response = await estimateViaGateway(s.t, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'stock-on-hand-fixture' });
    expect(response.status).toBe('quote_required');
    await s.t.run(async ctx => { const w = (await ctx.db.query('catWarehouses').first())!; await ctx.db.patch(w._id, { code: 'changed-origin' }); });
    await expect(s.t.run(ctx => resolveLines(ctx, [zuoLine(s)], 'retail', NOW))).rejects.toThrow(/availability unknown/);
  });
  it('routes expired warehouse evidence and unsupported dispatch modes to quotes', async () => {
    const s = await setup();
    await s.t.run(async ctx => { const w = (await ctx.db.query('catWarehouses').first())!; await ctx.db.patch(w._id, { validUntil: NOW - 1 }); const stock = (await ctx.db.query('catStockRevisions').first())!; await ctx.db.patch(stock._id, { warehouseFingerprint: await digest(await ctx.db.get(w._id)) }); });
    const expired = await estimateViaGateway(s.t, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'warehouse-fixture-1' });
    expect(expired.status).toBe('quote_required');
    await s.t.run(async ctx => { const w = (await ctx.db.query('catWarehouses').first())!; await ctx.db.patch(w._id, { validUntil: NOW + 86400000, services: ['ltl'] }); const stock = (await ctx.db.query('catStockRevisions').first())!; await ctx.db.patch(stock._id, { warehouseFingerprint: await digest(await ctx.db.get(w._id)) }); });
    const unsupported = await estimateViaGateway(s.t, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'warehouse-fixture-2' });
    expect(unsupported.status).toBe('quote_required');
  });
  it('does not extend an estimate lifetime with unverified or future inventory observations', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const old = (await ctx.db.query('catSourceObservations').first())!;
      await ctx.db.patch(old._id, { observedAt: NOW - 86400000 + 30000 });
      const revision = (await ctx.db.query('catStockRevisions').first())!;
      await ctx.db.patch(revision._id, { observedAt: NOW - 86400000 + 30000 });
      const { _id, _creationTime, ...data } = old;
      void _id; void _creationTime;
      await ctx.db.insert('catSourceObservations', { ...data, observedAt: NOW, confidence: 'unverified', contentHash: 'unverified-test' });
      await ctx.db.insert('catSourceObservations', { ...data, observedAt: NOW + 86400000, contentHash: 'future-test' });
    });
    const lines = await s.t.run(ctx => resolveLines(ctx, [zuoLine(s)], 'retail', NOW));
    expect(lines[0].validUntil).toBe(NOW + 30000);
  });
  it('estimates a Zuo item, keeps ZIP estimates non-binding and shows tax only with a full address', async () => {
    const s = await setup();
    const zip = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      visitorKey: 'visitor-1234567890',
    });
    expect(zip.status).toBe('ok');
    expect(zip.serviceName).toBe('Parcel delivery');
    expect(zip.serviceDetails).toEqual(['Standard parcel placement.']);
    expect(zip.deliveryChargeMinor).toBe(4_999);
    expect(zip.taxMinor).toBeNull();
    expect(zip.note).toMatch(/Estimate/);
    const full = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'visitor-1234567890',
    });
    expect(full.taxMinor).toBe(Math.ceil(((45_806 + 4_999) * 825) / 10_000));
    expect(full.totalMinor).toBe(45_806 + 4_999 + full.taxMinor!);
    const observations = await s.t.run((ctx) => ctx.db.query('dlvObservations').collect());
    expect(observations).toHaveLength(2); // Internal tax iterations are not extra requests.
    expect(observations[1].path).toBe('matrix_tax');
    expect(observations[1].scopes[0]).toMatchObject({
      supplier: 'zuo',
      origin: '95206',
      zone: 'Z1',
      mode: 'ground',
    });
    expect(JSON.stringify(observations)).not.toContain(ADDRESS.line1);
    expect(JSON.stringify(observations)).not.toContain(ADDRESS.recipientName);
  });

  it('persists failures outside the failed estimate transaction and identifies tax-provider failures', async () => {
    const s = await setup();
    const args = {
      lines: [zuoLine(s)],
      channel: 'retail' as const,
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'telemetry-fixture-123',
    };
    await expect(estimateViaGateway(s.t, { ...args, channel: 'trade' })).rejects.toThrow();
    let rows = await s.t.run((ctx) => ctx.db.query('dlvObservations').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('blocked');
    taxFixture.fail = true;
    const quote = await estimateViaGateway(s.t, args);
    expect(quote.totalMinor).toBeNull();
    rows = await s.t.run((ctx) => ctx.db.query('dlvObservations').collect());
    expect(rows).toHaveLength(2);
    expect(rows[1].outcome).toBe('tax_error');
    expect(rows[1].path).toBe('matrix_tax');
  });

  it('binds access requirements and service terms, and routes special access to a quote', async () => {
    const s = await setup();
    const base = {
      lines: [zuoLine(s)],
      channel: 'retail' as const,
      zip: '95206',
      visitorKey: 'access-fixture-12345',
    };
    const regular = await estimateViaGateway(s.t, { ...base, address: ADDRESS });
    const commercial = await estimateViaGateway(s.t, {
      ...base,
      address: {
        ...ADDRESS,
        access: { ...STANDARD_ACCESS, destinationType: 'commercial', loadingDock: true },
      },
    });
    expect(commercial.deliveryChargeMinor).toBe(regular.deliveryChargeMinor);
    for (const access of [
      { ...STANDARD_ACCESS, stairs: true },
      { ...STANDARD_ACCESS, limitedAccess: true },
      { ...STANDARD_ACCESS, requestedService: 'inside' as const },
    ]) {
      const result = await estimateViaGateway(s.t, {
        ...base,
        address: { ...ADDRESS, access },
      });
      expect(result.status).toBe('quote_required');
      expect(result.totalMinor).toBeNull();
    }
    const stored = await s.t.run((ctx) => ctx.db.get(regular.estimateId));
    expect(stored?.serviceTerms?.label).toBe('Parcel delivery');
    const rows = await s.admin.query(api.sysConfig.list, { status: 'approved' });
    const policy = rows.records.find((r) => r.key === 'delivery-curbside')!;
    await s.t.run((ctx) => ctx.db.patch(policy._id, { status: 'retired' }));
    const unapproved = await estimateViaGateway(s.t, { ...base, address: ADDRESS });
    expect(unapproved.status).toBe('quote_required');
  });

  it('routes Alaska, Hawaii, PO boxes and unzoned ZIPs to a quote (DEL03)', async () => {
    const s = await setup();
    for (const zip of ['99501', '96813', '10001x']) {
      const r = await estimateViaGateway(s.t, {
        lines: [zuoLine(s)],
        channel: 'retail',
        zip,
        visitorKey: 'visitor-1234567890',
      }).catch((e) => ({ status: 'error', e }));
      expect(r.status === 'quote_required' || r.status === 'error').toBe(true);
    }
    const unzoned = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '60601',
      visitorKey: 'visitor-1234567890',
    });
    expect(unzoned.status).toBe('quote_required');
    expect(unzoned.reasons).toEqual(['Request a delivery quote']);
    expect(quoteOnlyReasons('95206', { ...ADDRESS, line1: 'PO Box 12' })).toContain(
      'PO boxes need a delivery quote'
    );
    expect(zipRegion('00901')).toBe('PR');
  });

  it('is off unless the flag is on, refuses proposed policies, and ignores client prices (SEC01)', async () => {
    const s = await setup();
    const r = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      visitorKey: 'visitor-1234567890',
      clientPrices: { [s.variantId]: 1 },
    });
    expect(r.merchandiseMinor).toBe(45_806);
    const metric = await s.t.run((ctx) => ctx.db.query('sysMetrics').collect());
    expect(metric.some((m) => m.name === 'security.client_price_ignored')).toBe(true);
    delete process.env.DELIVERY_AUTOMATION_ENABLED;
    await expect(
      estimateViaGateway(s.t, {
        lines: [zuoLine(s)],
        channel: 'retail',
        zip: '95206',
        visitorKey: 'v',
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'FEATURE_DISABLED'));
  });

  it('needs the mixed-cart decision (D-12) before combining Zuo and Ashcroft, then sums groups once', async () => {
    const s = await setup();
    const mixed = [zuoLine(s), { productId: s.ashId, variantId: 'b1', packs: 1 }];
    await expect(
      estimateViaGateway(s.t, {
        lines: mixed,
        channel: 'retail',
        zip: '95206',
        visitorKey: 'visitor-1234567890',
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'POLICY_NOT_APPROVED'));
    const s2 = await setup({ approveMixed: true });
    const r = await estimateViaGateway(s2.t, {
      lines: [zuoLine(s2), { productId: s2.ashId, variantId: 'b1', packs: 1 }],
      channel: 'retail',
      zip: '95206',
      visitorKey: 'visitor-1234567890',
    });
    expect(r.status).toBe('ok');
    expect(r.deliveryChargeMinor).toBe(4_999 + 2_900); // Zuo ladder + Ashcroft per-item bench fee
    expect(r.splitKnown).toBe(true);
  });
});

describe('checkout and verified payment (S19, DEL04, FUL01)', () => {
  it('recovers the original mixed order once without repricing and re-reserves released credit atomically', async () => {
    const s = await setup({ approveMixed: true });
    process.env.CREDIT_V2_ENABLED = 'true';
    const user = await s.t.run(async ctx => {
      const id = await ctx.db.insert('users', { email: 'recovery-buyer@example.com' });
      const variant = (await ctx.db.get(s.variantId))!;
      await ctx.db.insert('catSupplierPolicies', { supplierId: variant.supplierId, kind: 'store_credit',
        summary: 'Synthetic credit permission for recovery test only', evidenceRefs: ['fixture'], scope: { all: true },
        status: 'documented', createdAt: Date.now(), createdBy: 'fixture', effectiveFrom: 0, source: 'fixture' });
      await applyCreditEvent(ctx, { eventKey: 'recovery-credit-opening', userId: id, type: 'opening_balance', amountMinor: 1000, actor: 'fixture' });
      return id;
    });
    const buyer = s.t.withIdentity({ subject: `${user}|s`, email: 'recovery-buyer@example.com' });
    const lines = [zuoLine(s), { productId: s.ashId, variantId: 'b1', packs: 1 }];
    const est = await estimateViaGateway(buyer, { lines, channel: 'retail', zip: '95206', address: ADDRESS, useCredit: true, visitorKey: 'recovery-original-fixture' });
    const intent = await buyer.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'recovery-original-fixture-key', estimateId: est.estimateId, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor!, useCredit: true });
    if (intent.status === 'price_changed') throw new Error('Unexpected price change');
    const original = (await s.t.run(ctx => ctx.db.get(intent.intentId)))!;
    expect(original.creditMinor).toBe(1000);
    expect(original.lineSnapshot.find(l => l.supplierCode === 'zuo')).toMatchObject({ supplierSku: '111182' });
    await s.t.mutation(internal.ordCheckout.attachSession, { intentId: intent.intentId, sessionId: 'cs_recovery' });
    await s.t.mutation(internal.ordCheckout.fail, { intentId: intent.intentId });
    await s.t.mutation(internal.ordPayments.receive, { eventId: 'evt_recovery', type: 'checkout.session.completed', livemode: false, payloadHash: 'fixture', payload: { id: 'cs_recovery', intentId: intent.intentId, payment_status: 'paid', amount_total: intent.totalMinor, currency: 'usd', payment_intent: 'pi_recovery', email: 'recovery-buyer@example.com' } });
    await processEvents(s.t);
    const exception = (await s.t.run(ctx => ctx.db.query('ordPaidExceptions').first()))!;
    const verificationId = await s.admin.mutation(internal.ordExceptionRefunds.record, { id: exception._id, intentId: intent.intentId, sessionId: 'cs_recovery', paymentIntentId: 'pi_recovery', chargeId: 'ch_recovery', amountMinor: intent.totalMinor, currency: 'usd', livemode: false, captured: true, disputed: false, succeededRefundMinor: 0, pendingRefundMinor: 0, refundIds: [] });
    const detail = await s.admin.query(api.ordExceptionFulfillment.detail, { id: exception._id });
    const args = { id: exception._id, verificationId, expectedFingerprint: detail.fingerprint, requestKey: 'resume-original-fixture-key', customerAgreement: 'Customer agreed to original paid order and delivery service', acceptedCostRisk: true, noPriorSupplierHandoff: true,
      confirmations: detail.lines.map(line => ({ lineKey: line.lineKey, source: 'Verified supplier stock and original service fixture', observedAt: Date.now(), availablePacks: line.packs })) };
    await expect(s.t.mutation(api.ordExceptionFulfillment.resumeOriginal, args)).rejects.toThrow();
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, expectedFingerprint: 'stale' })).rejects.toThrow(/changed/);
    await s.t.run(ctx => ctx.db.patch(s.variantId, { supplierSku: 'changed-sku' }));
    const changedIdentity = await s.admin.query(api.ordExceptionFulfillment.detail, { id: exception._id });
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, expectedFingerprint: changedIdentity.fingerprint })).rejects.toThrow(/exact original SKU/);
    await s.t.run(ctx => ctx.db.patch(s.variantId, { supplierSku: '111182' }));
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, confirmations: args.confirmations.slice(0, 1) })).rejects.toThrow(/every original line/);
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, noPriorSupplierHandoff: false })).rejects.toThrow(/absence/);
    await expect(s.t.query(api.ordExceptionFulfillment.detail, { id: exception._id })).rejects.toThrow();
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, confirmations: args.confirmations.map(c => ({ ...c, observedAt: Date.now() + 10000 })) })).rejects.toThrow(/exact original SKU/);
    await s.t.run(ctx => ctx.db.patch(verificationId, { succeededRefundMinor: 1 }));
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, args)).rejects.toThrow(/unrefunded original/);
    await s.t.run(async ctx => {
      await ctx.db.patch(verificationId, { succeededRefundMinor: 0 });
      const stock = (await ctx.db.query('catStockRevisions').first())!;
      await ctx.db.patch(stock._id, { quantity: '0' });
    });
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, args)).rejects.toThrow(/warehouse capacity/);
    await s.t.run(async ctx => { const stock = (await ctx.db.query('catStockRevisions').first())!; await ctx.db.patch(stock._id, { quantity: '1000' }); });
    await s.t.run(ctx => reserveCredit(ctx, user, 1000, 'other-checkout-fixture'));
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, args)).rejects.toThrow(/Available credit/);
    expect(await s.t.run(ctx => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    await s.t.run(ctx => settleCredit(ctx, 'other-checkout-fixture', 'released'));
    const orderId = await s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, args);
    expect(await s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, args)).toBe(orderId);
    await expect(s.admin.mutation(api.ordExceptionFulfillment.resumeOriginal, { ...args, customerAgreement: 'Changed recovery notes' })).rejects.toThrow(/Changed recovery retry/);
    const order = (await s.t.run(ctx => ctx.db.get(orderId)))!;
    expect(order.totals.total).toBe(original.totalMinor); expect(order.totals.credit).toBe(original.creditMinor);
    expect(order.shippingAddress).toEqual(original.shippingAddress); expect(order.serviceTerms).toEqual(original.serviceTerms);
    expect(order.paidAt).toBe(exception.createdAt);
    const children = await s.t.run(ctx => ctx.db.query('ordSupplierOrders').collect());
    expect(children).toHaveLength(2); expect(children.every(c => c.status === 'queued' && c.submission.mode === 'none')).toBe(true);
    const orderLines = await s.t.run(ctx => ctx.db.query('ordOrderLines').collect());
    expect(orderLines.map(l => l.unitPackMinor)).toEqual(original.lineSnapshot.map(l => l.unitPackMinor));
    expect((await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').first()))?.reservedMinor).toBe(0);
    const creditEvents = await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect());
    expect(creditEvents.filter(e => e.type === 'redeemed')).toHaveLength(1);
    expect((await s.t.run(ctx => ctx.db.get(exception._id)))?.resolutionOrderId).toBe(orderId);
    expect((await buyer.query(api.ordReceipts.receipt, { sessionId: 'cs_recovery' })).state).toBe('confirmed');
    expect(await s.t.run(ctx => ctx.db.query('dlvTaxTransactions').collect())).toHaveLength(1);
    expect(await s.t.run(ctx => ctx.db.query('sysNotifications').collect())).toHaveLength(1);
  });
  it('rejects wrong-mode and connected-account payment events before storing platform work', async () => {
    const s = await setup();
    const event = { eventId: 'evt_wrong_mode', type: 'checkout.session.completed', livemode: true, payloadHash: 'fixture', payload: {} };
    expect(await s.t.mutation(internal.ordPayments.receive, event)).toBe(false);
    expect(await s.t.mutation(internal.ordPayments.receive, { ...event, livemode: false, account: 'acct_other' })).toBe(false);
    expect(await s.t.run(ctx => ctx.db.query('sysPaymentEvents').collect())).toHaveLength(0);
    const old = await s.t.run(ctx => ctx.db.insert('sysPaymentEvents', { ...event, provider: 'stripe', receivedAt: Date.now(), status: 'received', attempts: 0 }));
    await s.t.mutation(internal.ordPayments.process, { id: old });
    expect((await s.t.run(ctx => ctx.db.get(old)))?.status).toBe('ignored');
  });

  it('closes a verified full refund once, releases credit and stock, and returns truthful private receipt status', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await estimateViaGateway(s.t, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'refund-exception-fixture' });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'refund-exception-fixture-key', estimateId: est.estimateId, guestCapability: est.guestCapability, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! });
    if (intent.status === 'price_changed') throw new Error('Unexpected price change');
    await s.t.mutation(internal.ordCheckout.attachSession, { intentId: intent.intentId, sessionId: 'cs_refund_exception' });
    const ex = await s.t.run(async ctx => {
      await ctx.db.patch(intent.intentId, { status: 'exception' });
      const userId = await ctx.db.insert('users', { email: 'refund-credit-fixture@example.com' });
      await applyCreditEvent(ctx, { eventKey: 'refund-credit-opening', userId, type: 'opening_balance', amountMinor: 1000, actor: 'fixture' });
      await reserveCredit(ctx, userId, 1000, `intent:${intent.intentId}`);
      await ctx.db.patch(intent.intentId, { creditReservationRef: `intent:${intent.intentId}` });
      const hold = (await ctx.db.query('ordInventoryReservations').first())!;
      await ctx.db.patch(hold._id, { status: 'consumed' });
      return ctx.db.insert('ordPaidExceptions', { intentId: intent.intentId, paymentIntentId: 'pi_refund_exception', stripeSessionId: 'cs_refund_exception', reason: 'stock_failed', evidence: {}, status: 'open', createdAt: Date.now() });
    });
    const session = { id: 'cs_refund_exception', metadata: { intentId: intent.intentId }, livemode: false, payment_status: 'paid', amount_total: intent.totalMinor, currency: 'usd', payment_intent: {
      id: 'pi_refund_exception', livemode: false, status: 'succeeded', amount_received: intent.totalMinor, currency: 'usd', latest_charge: { id: 'ch_refund_exception', amount: intent.totalMinor, currency: 'usd', livemode: false, paid: true, captured: true, disputed: false }
    } };
    const refund = { id: 're_fixture', payment_intent: 'pi_refund_exception', charge: 'ch_refund_exception', currency: 'usd', amount: intent.totalMinor, status: 'pending' };
    paymentReadFixture.session.mockResolvedValue(session);
    paymentReadFixture.refunds.mockResolvedValue({ data: [refund], has_more: false });
    await expect(s.t.action(api.ordExceptionActions.verify, { id: ex })).rejects.toThrow();
    expect(paymentReadFixture.session).not.toHaveBeenCalled();
    await expect(s.admin.mutation(api.v2Admin.resolvePaidException, { id: ex, resolution: 'Customer says refund' })).rejects.toThrow(/note alone/);
    for (const invalid of [
      { ...session, livemode: true },
      { ...session, metadata: { intentId: 'another-checkout' } },
      { ...session, amount_total: session.amount_total + 1 },
    ]) {
      paymentReadFixture.session.mockResolvedValueOnce(invalid);
      await expect(s.admin.action(api.ordExceptionActions.verify, { id: ex })).rejects.toThrow(/verification is incomplete/);
    }
    paymentReadFixture.refunds.mockResolvedValueOnce({ data: [refund], has_more: true });
    await expect(s.admin.action(api.ordExceptionActions.verify, { id: ex })).rejects.toThrow(/verification is incomplete/);
    const pending = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    const args = { id: ex, verificationId: pending, customerAgreement: 'Customer approved cancellation by support case fixture', supplierCancellationEvidence: 'Confirmed no supplier order was submitted', noOutstandingFulfillment: true, requestKey: 'refund-close-fixture-key' };
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, args)).rejects.toThrow(/full successful refund/);
    paymentReadFixture.refunds.mockResolvedValue({ data: [{ ...refund, status: 'succeeded', amount: Math.floor(intent.totalMinor / 2) }], has_more: false });
    const partial = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...args, verificationId: partial })).rejects.toThrow(/full successful refund/);
    paymentReadFixture.refunds.mockResolvedValue({ data: [{ ...refund, status: 'succeeded' }], has_more: false });
    paymentReadFixture.session.mockResolvedValueOnce({ ...session, payment_intent: { ...session.payment_intent, latest_charge: { ...session.payment_intent.latest_charge, disputed: true } } });
    const disputed = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...args, verificationId: disputed })).rejects.toThrow(/full successful refund/);
    const succeeded = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, args)).rejects.toThrow(/Refresh payment/);
    vi.setSystemTime(Date.now() + 5 * 60000 + 1);
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...args, verificationId: succeeded })).rejects.toThrow(/Refresh payment/);
    const refreshed = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    const refundEvent = { eventId: 'evt_refund_updated', type: 'refund.updated', livemode: false, payloadHash: 'fixture', payload: { id: 're_fixture', paymentIntentId: 'pi_refund_exception', chargeId: 'ch_refund_exception', status: 'succeeded', created: Math.floor(Date.now() / 1000) } };
    await s.t.mutation(internal.ordPayments.receive, refundEvent);
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...args, verificationId: refreshed })).rejects.toThrow(/Refresh payment/);
    // An in-flight provider read cannot save a proof against a newer event version.
    const oldProof = (await s.t.run(ctx => ctx.db.get(refreshed)))!;
    await expect(s.admin.mutation(internal.ordExceptionRefunds.record, { id: ex, intentId: intent.intentId, sessionId: oldProof.sessionId, paymentIntentId: oldProof.paymentIntentId, chargeId: oldProof.chargeId, amountMinor: oldProof.amountMinor, currency: oldProof.currency, livemode: false, captured: true, disputed: false, succeededRefundMinor: oldProof.amountMinor, pendingRefundMinor: 0, refundIds: ['re_fixture'], expectedPaymentStateVersion: 0 })).rejects.toThrow(/changed during/);
    const currentProof = await s.admin.action(api.ordExceptionActions.verify, { id: ex });
    const update = { ...args, verificationId: currentProof };
    await expect(s.t.mutation(api.ordExceptionRefunds.closeRefunded, update)).rejects.toThrow();
    await s.admin.mutation(api.ordExceptionRefunds.closeRefunded, update);
    await s.admin.mutation(api.ordExceptionRefunds.closeRefunded, update);
    await expect(s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...update, customerAgreement: 'Changed retry notes' })).rejects.toThrow(/Changed reconciliation retry/);
    expect((await s.t.run(ctx => ctx.db.get(intent.intentId)))?.status).toBe('refunded');
    expect((await s.t.run(ctx => ctx.db.query('ordInventoryReservations').first()))?.status).toBe('released');
    const credits = (await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').first()))!;
    expect(credits.availableMinor).toBe(1000); expect(credits.reservedMinor).toBe(0);
    expect(await s.t.query(api.ordReceipts.receipt, { sessionId: 'cs_refund_exception', guestCapability: est.guestCapability })).toEqual({ state: 'refunded' });
    expect(await s.t.query(api.ordReceipts.receipt, { sessionId: 'cs_refund_exception' })).toEqual({ state: 'unavailable' });
    await s.t.mutation(internal.ordCheckout.fail, { intentId: intent.intentId });
    expect((await s.t.run(ctx => ctx.db.get(intent.intentId)))?.status).toBe('refunded');
    expect(await s.t.run(ctx => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('sysNotifications').collect())).toHaveLength(0);
    const failure = { ...refundEvent, eventId: 'evt_refund_failed', type: 'refund.failed', payload: { ...refundEvent.payload, status: 'failed' } };
    expect(await s.t.mutation(internal.ordPayments.receive, { ...failure, livemode: true })).toBe(false);
    expect(await s.t.mutation(internal.ordPayments.receive, { ...failure, account: 'acct_other' })).toBe(false);
    await s.t.mutation(internal.ordPayments.receive, { ...failure, eventId: 'evt_unrelated_failed_refund', payload: { ...failure.payload, id: 're_previously_failed' } });
    expect((await s.t.run(ctx => ctx.db.get(ex)))?.status).toBe('resolved');
    expect(await s.t.mutation(internal.ordPayments.receive, failure)).toBe(true);
    expect(await s.t.mutation(internal.ordPayments.receive, failure)).toBe(false);
    const reopened = (await s.t.run(ctx => ctx.db.get(ex)))!;
    expect(reopened).toMatchObject({ status: 'open', resolutionKind: 'verified_refund', paymentVerificationId: currentProof, refundFollowup: { refundId: 're_fixture', status: 'failed' } });
    expect(await s.t.query(api.ordReceipts.receipt, { sessionId: 'cs_refund_exception', guestCapability: est.guestCapability })).toEqual({ state: 'review_required' });
    expect((await s.t.run(ctx => ctx.db.query('ordInventoryReservations').first()))?.status).toBe('released');
    expect((await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').first()))?.availableMinor).toBe(1000);
    expect(await s.t.run(ctx => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    const replacementProof = await s.admin.mutation(internal.ordExceptionRefunds.record, { id: ex, intentId: intent.intentId, sessionId: oldProof.sessionId, paymentIntentId: oldProof.paymentIntentId, chargeId: oldProof.chargeId, amountMinor: oldProof.amountMinor, currency: 'usd', livemode: false, captured: true, disputed: false, succeededRefundMinor: oldProof.amountMinor, pendingRefundMinor: 0, refundIds: ['re_fixture', 're_replacement'], succeededRefundIds: ['re_replacement'], expectedPaymentStateVersion: reopened.paymentStateVersion });
    await s.admin.mutation(api.ordExceptionRefunds.closeRefunded, { ...args, verificationId: replacementProof, requestKey: 'refund-followup-close-key' });
    await s.t.mutation(internal.ordPayments.receive, { ...failure, eventId: 'evt_delayed_old_failure' });
    expect((await s.t.run(ctx => ctx.db.get(ex)))?.status).toBe('resolved');
  });
  it('atomically deducts other checkout holds, preserves retries, and frees expired unpaid capacity', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const stock = (await ctx.db.query('catStockRevisions').first())!;
      await ctx.db.patch(stock._id, { quantity: '1' });
    });
    const lines = [zuoLine(s)];
    const first = await estimateViaGateway(s.t, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'inventory-first-cart' });
    const second = await estimateViaGateway(s.t, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'inventory-second-cart' });
    expect(first.status).toBe('ok'); expect(second.status).toBe('ok');
    const args = { idempotencyKey: 'inventory-hold-first-key', estimateId: first.estimateId, guestCapability: first.guestCapability, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: first.totalMinor! };
    const held = await s.t.mutation(internal.ordCheckout.createIntent, args);
    expect(held.status).toBe('created');
    expect((await s.t.mutation(internal.ordCheckout.createIntent, args)).status).toBe('existing');
    await expect(s.t.mutation(internal.ordCheckout.createIntent, { ...args, idempotencyKey: 'inventory-hold-second-key', estimateId: second.estimateId, guestCapability: second.guestCapability, acceptTotalMinor: second.totalMinor! })).rejects.toThrow(/committed/);
    const rows = await s.t.run(ctx => ctx.db.query('ordInventoryReservations').collect());
    expect(rows).toHaveLength(1); expect(rows[0].stockRevisionId).toBeTruthy(); expect(rows[0].piecesPerPack).toBe(2);
    await s.t.run(ctx => ctx.db.patch(rows[0]._id, { expiresAt: Date.now() }));
    const cv = (await s.t.run(ctx => ctx.db.get(s.variantId)))!;
    expect(await s.t.run(ctx => availableAfterCommitments(ctx, cv, 1, Date.now()))).toBe(1);
  });

  it('retains paid demand across feed refreshes until an approver reconciles a newer supplier count', async () => {
    const s = await setup();
    const { intent } = await paidOrder(s, [zuoLine(s)]);
    const row = (await s.t.run(ctx => ctx.db.query('ordInventoryReservations').first()))!;
    expect(row.status).toBe('consumed');
    const cv = (await s.t.run(ctx => ctx.db.get(s.variantId)))!;
    expect(await s.t.run(ctx => availableAfterCommitments(ctx, cv, 1000, Date.now()))).toBe(999);
    const args = { reservationId: row._id, expectedRevisionId: cv.currentStockRevisionId!, evidence: 'Supplier PO allocation evidence', note: 'Supplier confirms this order is included in the new available-to-sell quantity', confirmed: true, requestKey: 'inventory-reconcile-fixture-key' };
    await expect(s.admin.mutation(api.ordInventory.reconcile, args)).rejects.toThrow(/newer/);
    const revision = await s.t.run(async ctx => {
      const old = (await ctx.db.get(cv.currentStockRevisionId!))!;
      const { _id: _oldId, _creationTime: _oldTime, ...source } = old;
      void _oldId; void _oldTime;
      const id = await ctx.db.insert('catStockRevisions', { ...source, observedAt: Date.now(), createdAt: Date.now(), quantity: '999', source: 'Updated supplier ATS' });
      await ctx.db.patch(cv._id, { currentStockRevisionId: id });
      return id;
    });
    const current = (await s.t.run(ctx => ctx.db.get(cv._id)))!;
    expect(await s.t.run(ctx => availableAfterCommitments(ctx, current, 999, Date.now()))).toBe(998);
    await expect(s.t.mutation(api.ordInventory.reconcile, { ...args, expectedRevisionId: revision })).rejects.toThrow();
    const update = { ...args, expectedRevisionId: revision };
    await expect(s.admin.mutation(api.ordInventory.reconcile, update)).rejects.toThrow(/handoff and acknowledgement/);
    const supplierOrder = (await s.t.run(ctx => ctx.db.query('ordSupplierOrders').first()))!;
    await s.admin.mutation(api.ordFulfillment.markSubmitted, { supplierOrderId: supplierOrder._id, supplierPo: 'FIXTURE-PO', acceptedCostMinor: 10000 });
    await s.admin.mutation(api.ordFulfillment.acknowledge, { supplierOrderId: supplierOrder._id, confirmation: 'FIXTURE supplier allocation confirmed' });
    await s.admin.mutation(api.ordInventory.reconcile, update);
    await s.admin.mutation(api.ordInventory.reconcile, update);
    await expect(s.admin.mutation(api.ordInventory.reconcile, { ...update, note: 'Changed retry' })).rejects.toThrow(/Retry/);
    expect(await s.t.run(ctx => availableAfterCommitments(ctx, current, 999, Date.now()))).toBe(999);
    expect((await s.t.run(ctx => ctx.db.get(row._id)))?.status).toBe('reconciled');
    expect((await s.t.run(ctx => ctx.db.get(intent.intentId)))?.status).toBe('paid');
    const audits = await s.t.run(ctx => ctx.db.query('sysAuditEvents').collect());
    expect(audits.filter(a => a.action === 'inventory.supplier_allocation_reconciled')).toHaveLength(1);
  });

  it.each(['changed_stock', 'missing_hold'])('keeps payment evidence and stock commitments for %s during checkout', async (failure) => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await estimateViaGateway(s.t, { lines, channel: 'retail', zip: '95206', address: ADDRESS, visitorKey: 'inventory-payment-stock-change' });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, { idempotencyKey: 'inventory-payment-fixture-key', estimateId: est.estimateId, guestCapability: est.guestCapability, lines, address: ADDRESS, service: 'curbside', acceptTotalMinor: est.totalMinor! });
    if (intent.status === 'price_changed') throw new Error('Unexpected fixture price change');
    await s.t.mutation(internal.ordCheckout.attachSession, { intentId: intent.intentId, sessionId: 'cs_stock_change' });
    await s.t.run(async ctx => {
      if (failure === 'missing_hold') {
        const hold = (await ctx.db.query('ordInventoryReservations').first())!;
        await ctx.db.delete(hold._id);
      } else {
        const stock = (await ctx.db.query('catStockRevisions').first())!;
        await ctx.db.patch(stock._id, { quantity: '0', availability: 'out_of_stock' });
      }
    });
    const event = { eventId: 'evt_stock_change', type: 'checkout.session.completed', livemode: false, payloadHash: 'fixture', payload: { id: 'cs_stock_change', intentId: intent.intentId, payment_status: 'paid', amount_total: intent.totalMinor, currency: 'usd', payment_intent: 'pi_stock_change', email: 'buyer@example.com' } };
    await s.t.mutation(internal.ordPayments.receive, event); await processEvents(s.t);
    await s.t.mutation(internal.ordPayments.receive, { ...event, eventId: 'evt_stock_change_again' }); await processEvents(s.t);
    const exceptions = await s.t.run(ctx => ctx.db.query('ordPaidExceptions').collect());
    expect(exceptions).toHaveLength(1); expect(exceptions[0].reason).toBe('stock_failed');
    expect(await s.t.run(ctx => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    expect((await s.t.run(ctx => ctx.db.query('ordInventoryReservations').first()))?.status).toBe('consumed');
    expect((await s.t.run(ctx => ctx.db.get(intent.intentId)))?.status).toBe('exception');
  });

  it('fails closed for unknown legacy commitments and excessive unreconciled backlog', async () => {
    const s = await setup();
    await paidOrder(s, [zuoLine(s)]);
    const cv = (await s.t.run(ctx => ctx.db.get(s.variantId)))!;
    const row = (await s.t.run(ctx => ctx.db.query('ordInventoryReservations').first()))!;
    await s.t.run(ctx => ctx.db.patch(row._id, { warehouseId: undefined }));
    await expect(s.t.run(ctx => availableAfterCommitments(ctx, cv, 1000, Date.now()))).rejects.toThrow(/warehouse and pack/);
    await s.t.run(async ctx => {
      await ctx.db.patch(row._id, { warehouseId: cv.warehouseId });
      const { _id: _rowId, _creationTime: _rowTime, ...fields } = row;
      void _rowId; void _rowTime;
      for (let i = 0; i < 500; i++) await ctx.db.insert('ordInventoryReservations', fields);
    });
    await expect(s.t.run(ctx => availableAfterCommitments(ctx, cv, 1000, Date.now()))).rejects.toThrow(/operational reconciliation/);
  });
  it('creates one order and one child per supplier from a verified event, exactly once', async () => {
    const s = await setup({ approveMixed: true });
    const lines = [zuoLine(s, 2), { productId: s.ashId, variantId: 'b1', packs: 1 }];
    const { intent, payload } = await paidOrder(s, lines);
    // duplicate delivery of the same and of a new event id for the same session
    await s.t.mutation(internal.ordPayments.receive, {
      eventId: 'evt_1',
      type: 'checkout.session.completed',
      livemode: false,
      payloadHash: 'h',
      payload,
    });
    await s.t.mutation(internal.ordPayments.receive, {
      eventId: 'evt_2',
      type: 'checkout.session.completed',
      livemode: false,
      payloadHash: 'h',
      payload,
    });
    await processEvents(s.t);
    const orders = await s.t.run((ctx) => ctx.db.query('ordOrders').collect());
    expect(orders).toHaveLength(1);
    expect(orders[0].totals.total).toBe(intent.totalMinor);
    expect(orders[0].shippingAddress).toEqual(ADDRESS);
    expect(orders[0].serviceTerms?.label).toContain('Parcel delivery');
    expect(intent.serviceLabel).toBe(orders[0].serviceTerms?.label);
    expect(orders[0].serviceTerms?.label).toContain('Supplier standard delivery');
    const children = await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect());
    expect(children.map((c) => c.route).sort()).toEqual([
      'manual_dealer_ashcroft',
      'manual_dealer_zuo',
    ]);
    const allocs = await s.t.run((ctx) => ctx.db.query('ordAllocations').collect());
    expect(allocs.reduce((t, a) => t + a.pieces, 0)).toBe(4 + 1); // 2 pairs + 1 bench, each allocated once
    const lineRows = await s.t.run((ctx) => ctx.db.query('ordOrderLines').collect());
    expect(lineRows.reduce((t, l) => t + l.taxMinor, 0)).toBe(orders[0].totals.tax);
    expect(lineRows.reduce((t, l) => t + l.deliveryAllocMinor, 0)).toBe(orders[0].totals.delivery);
    const email = await s.t.run((ctx) => ctx.db.query('sysNotifications').first());
    expect(email!.text).toContain(SPLIT_WILL);
    expect(email!.text).toContain(ADDRESS.recipientName);
    expect(email!.text).toContain('Standard parcel placement.');
  });

  it('requires reconfirmation when anything changes, and refuses stale estimates', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await estimateViaGateway(s.t, {
      lines,
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'visitor-1234567890',
    });
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, {
        idempotencyKey: 'key-abcdefghijklmnop',
        estimateId: est.estimateId,
        guestCapability: est.guestCapability,
        lines: [zuoLine(s, 2)],
        address: ADDRESS,
        service: 'curbside',
        acceptTotalMinor: est.totalMinor!,
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'QUOTE_EXPIRED'));
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, {
        idempotencyKey: 'key-abcdefghijklmnop',
        estimateId: est.estimateId,
        guestCapability: est.guestCapability,
        lines,
        address: { ...ADDRESS, line1: '2 Main St' },
        service: 'curbside',
        acceptTotalMinor: est.totalMinor!,
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'QUOTE_EXPIRED'));
    // A changed merchandise price invalidates address-bound tax and requires a fresh review.
    await s.t.run(async (ctx) => {
      const p = (await ctx.db.query('catPriceRevisions').first())!;
      await ctx.db.patch(p._id, { packPriceMinor: 47_000 });
      const l = (await ctx.db
        .query('commerceListings')
        .filter((q) => q.eq(q.field('productId'), s.productId))
        .first())!;
      await ctx.db.patch(l._id, {
        snapshot: {
          ...l.snapshot,
          variants: l.snapshot.variants.map((x) => ({ ...x, price: 47_000 })),
        },
      });
    });
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, {
        idempotencyKey: 'key-abcdefghijklmnop',
        estimateId: est.estimateId,
        guestCapability: est.guestCapability,
        lines,
        address: ADDRESS,
        service: 'curbside',
        acceptTotalMinor: est.totalMinor!,
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'QUOTE_EXPIRED'));
    const refreshed = await estimateViaGateway(s.t, {
      lines,
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'visitor-1234567890',
    });
    const ok = await s.t.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'key-abcdefghijklmnop',
      estimateId: refreshed.estimateId,
      guestCapability: refreshed.guestCapability,
      lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: refreshed.totalMinor!,
    });
    expect(ok.status).toBe('created');
    const again = await s.t.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'key-abcdefghijklmnop',
      estimateId: refreshed.estimateId,
      guestCapability: refreshed.guestCapability,
      lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: refreshed.totalMinor!,
    });
    expect(again.status).toBe('existing');
  });

  it('sends a payment after expiry or with a mismatched total to the paid-order exception queue', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await estimateViaGateway(s.t, {
      lines,
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'visitor-1234567890',
    });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'key-abcdefghijklmnop',
      estimateId: est.estimateId,
      guestCapability: est.guestCapability,
      lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: est.totalMinor!,
    });
    if (intent.status === 'price_changed') throw new Error();
    await s.t.mutation(internal.ordCheckout.attachSession, {
      intentId: intent.intentId,
      sessionId: 'cs_1',
    });
    await s.t.mutation(internal.ordPayments.receive, {
      eventId: 'e1',
      type: 'checkout.session.completed',
      livemode: false,
      payloadHash: 'h',
      payload: {
        id: 'cs_1',
        intentId: intent.intentId,
        payment_status: 'paid',
        amount_total: intent.totalMinor - 1,
        currency: 'usd',
        payment_intent: 'pi_9',
        email: 'b@x.com',
      },
    });
    await processEvents(s.t);
    expect(await s.t.run((ctx) => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    const ex = await s.t.run((ctx) => ctx.db.query('ordPaidExceptions').collect());
    expect(ex[0]).toMatchObject({
      reason: 'total_mismatch',
      status: 'open',
      paymentIntentId: 'pi_9',
    });
  });

  it('releases reservations when the session expires', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const est = await estimateViaGateway(s.t, {
      lines,
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'visitor-1234567890',
    });
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'key-abcdefghijklmnop',
      estimateId: est.estimateId,
      guestCapability: est.guestCapability,
      lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: est.totalMinor!,
    });
    if (intent.status === 'price_changed') throw new Error();
    await s.t.mutation(internal.ordPayments.receive, {
      eventId: 'e-exp',
      type: 'checkout.session.expired',
      livemode: false,
      payloadHash: 'h',
      payload: {
        id: 'cs_1',
        intentId: intent.intentId,
        payment_status: 'unpaid',
        amount_total: null,
        currency: 'usd',
        payment_intent: null,
        email: '',
      },
    });
    await processEvents(s.t);
    const res = await s.t.run((ctx) => ctx.db.query('ordInventoryReservations').collect());
    expect(res.every((r) => r.status === 'released')).toBe(true);
  });
});

describe('fulfillment (S21, FUL04, FUL05, DEL05)', () => {
  it('records exact shipment retries, protects partial cancellations and keeps incident evidence private', async () => {
    const s = await setup({ approveMixed: true });
    const { est } = await paidOrder(s, [zuoLine(s, 2), { productId: s.ashId, variantId: 'b1', packs: 1 }]);
    const zuo = (await s.admin.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' }))[0];
    const ash = (await s.admin.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_ashcroft' }))[0];
    await expect(s.t.query(api.ordFulfillment.shipmentDetail, { supplierOrderId: zuo._id })).rejects.toThrow();
    const shipment = { supplierOrderId: zuo._id, requestKey: 'shipment-retry-fixture', items: [{ allocationId: zuo.items[0].allocationId, pieces: 1 }], trackingNumber: 'TRACK-1' };
    await expect(s.admin.mutation(api.ordFulfillment.recordShipment, shipment)).rejects.toThrow(/handoff/);
    await expect(s.admin.mutation(api.ordFulfillment.markSubmitted, { supplierOrderId: zuo._id, supplierPo: 'PO-fixture', acceptedCostMinor: -1 })).rejects.toThrow();
    const submitted = { supplierOrderId: zuo._id, supplierPo: 'PO-fixture', acceptedCostMinor: 10000 };
    await s.admin.mutation(api.ordFulfillment.markSubmitted, submitted);
    await s.admin.mutation(api.ordFulfillment.markSubmitted, submitted);
    const ack = { supplierOrderId: zuo._id, confirmation: 'Confirmed fixture PO', invoicedCostMinor: 10100 };
    await s.admin.mutation(api.ordFulfillment.acknowledge, ack);
    await s.admin.mutation(api.ordFulfillment.acknowledge, ack);
    expect((await s.t.run(ctx => ctx.db.get(zuo._id)))?.exceptions).toHaveLength(1);
    await expect(s.admin.mutation(api.ordFulfillment.recordShipment, { ...shipment, items: [{ ...shipment.items[0], pieces: 0.5 }] })).rejects.toThrow(/whole physical/);
    await expect(s.admin.mutation(api.ordFulfillment.recordShipment, { ...shipment, items: [...shipment.items, ...shipment.items] })).rejects.toThrow(/distinct/);
    const first = await s.admin.mutation(api.ordFulfillment.recordShipment, shipment);
    expect(await s.admin.mutation(api.ordFulfillment.recordShipment, shipment)).toBe(first);
    await expect(s.admin.mutation(api.ordFulfillment.recordShipment, { ...shipment, trackingNumber: 'changed' })).rejects.toThrow(/Changed shipment retry/);
    expect(await s.t.run(ctx => ctx.db.query('ordShipments').collect())).toHaveLength(1);
    await expect(s.admin.mutation(api.ordFulfillment.cancelAllocations, { supplierOrderId: zuo._id, allocationIds: [zuo.items[0].allocationId], reason: 'Supplier partial cancellation', requestKey: 'partial-cancel-fixture' })).rejects.toThrow(/Partly shipped/);
    const detail = await s.admin.query(api.ordFulfillment.shipmentDetail, { supplierOrderId: zuo._id });
    expect(detail.items[0]).toMatchObject({ shippedPieces: 1, remainingPieces: 3 });
    const second = await s.admin.mutation(api.ordFulfillment.recordShipment, { ...shipment, requestKey: 'shipment-last-fixture', items: [{ ...shipment.items[0], pieces: 3 }] });
    await s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: first });
    const issue = { shipmentId: second, kind: 'lost' as const, message: 'The carrier is locating this shipment. Contact support for help.', evidence: 'Private carrier case fixture with supplier cost', notifyCustomer: true, requestKey: 'shipment-issue-fixture' };
    await expect(s.t.mutation(api.ordFulfillment.recordShipmentIssue, issue)).rejects.toThrow();
    await s.admin.mutation(api.ordFulfillment.recordShipmentIssue, issue);
    await s.admin.mutation(api.ordFulfillment.recordShipmentIssue, issue);
    await expect(s.admin.mutation(api.ordFulfillment.recordShipmentIssue, { ...issue, message: 'Changed retry message' })).rejects.toThrow(/Changed shipment issue retry/);
    await expect(s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: second })).rejects.toThrow(/Resolve/);
    const order = (await s.t.run(ctx => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_delivered');
    const customer = await s.t.query(api.ordFulfillment.orderStatus, { number: order.number, guestCapability: est.guestCapability });
    expect(JSON.stringify(customer)).toContain(issue.message);
    expect(JSON.stringify(customer)).not.toContain(issue.evidence);
    const notifications = await s.t.run(ctx => ctx.db.query('sysNotifications').collect());
    expect(notifications.filter(n => n.template === 'shipment_update')).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain(issue.evidence);
    await s.admin.mutation(api.ordFulfillment.recordShipmentIssue, { ...issue, kind: 'resolved', message: 'Carrier found the shipment and confirmed arrival.', notifyCustomer: false, requestKey: 'shipment-resolved-fixture' });
    await s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: second });
    await s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: second });
    const cancel = { supplierOrderId: ash._id, allocationIds: [ash.items[0].allocationId], reason: 'Supplier confirmed cancellation', requestKey: 'supplier-cancel-retry-fixture' };
    await s.admin.mutation(api.ordFulfillment.cancelAllocations, cancel);
    await s.admin.mutation(api.ordFulfillment.cancelAllocations, cancel);
    expect((await s.t.run(ctx => ctx.db.get(order._id)))?.status).toBe('delivered');
    expect((await s.t.run(ctx => ctx.db.query('sysNotifications').collect())).filter(n => n.template === 'line_cancelled')).toHaveLength(1);
  });
  it('keeps the accepted supplier SKU and pack basis after later catalog edits', async () => {
    const s = await setup();
    await paidOrder(s, [zuoLine(s, 2)]);
    const before = await s.t.run(async ctx => buildPayload(ctx, (await ctx.db.query('ordSupplierOrders').first())!));
    await s.t.run(ctx => ctx.db.patch(s.variantId, { supplierSku: 'replacement-sku', piecesPerPack: 8 }));
    const queue = await s.admin.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' });
    expect(queue[0].items[0]).toMatchObject({ supplierSku: '111182', packs: 2, pieces: 4 });
    const after = await s.t.run(async ctx => buildPayload(ctx, (await ctx.db.query('ordSupplierOrders').first())!));
    expect(after.lines).toEqual(before.lines);
    const line = (await s.t.run(ctx => ctx.db.query('ordOrderLines').first()))!;
    expect(line).toMatchObject({ supplierSku: '111182', supplierSkuSource: 'checkout_snapshot' });
  });
  it('ships partially, keeps the other supplier intact on cancel, and never marks the whole order delivered early', async () => {
    const s = await setup({ approveMixed: true });
    const { est } = await paidOrder(s, [
      zuoLine(s, 2),
      { productId: s.ashId, variantId: 'b1', packs: 1 },
    ]);
    const zuoQueue = await s.admin.query(api.ordFulfillment.dealerQueue, {
      route: 'manual_dealer_zuo',
    });
    const ashQueue = await s.admin.query(api.ordFulfillment.dealerQueue, {
      route: 'manual_dealer_ashcroft',
    });
    expect(zuoQueue).toHaveLength(1);
    expect(zuoQueue[0].items[0]).toMatchObject({ supplierSku: '111182', packs: 2, pieces: 4 });
    await s.admin.mutation(api.ordFulfillment.markSubmitted, {
      supplierOrderId: zuoQueue[0]._id,
      supplierPo: 'PO-1',
      acceptedCostMinor: 47_380,
    });
    // Partial shipment of 2 of 4 pieces
    const shipId = await s.admin.mutation(api.ordFulfillment.recordShipment, {
      requestKey: 'shipment-first-fixture',
      supplierOrderId: zuoQueue[0]._id,
      items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 2 }],
      trackingUrl: 'https://track.example/1',
    });
    let order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_shipped'); // physical pieces, not only completed selling packs
    await expect(
      s.admin.mutation(api.ordFulfillment.recordShipment, {
        requestKey: 'shipment-excess-fixture',
        supplierOrderId: zuoQueue[0]._id,
        items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 3 }],
      })
    ).rejects.toThrow(/More pieces/);
    await s.admin.mutation(api.ordFulfillment.recordShipment, {
      requestKey: 'shipment-second-fixture',
      supplierOrderId: zuoQueue[0]._id,
      items: [{ allocationId: zuoQueue[0].items[0].allocationId, pieces: 2 }],
    });
    order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_shipped');
    await s.admin.mutation(api.ordFulfillment.markDelivered, { shipmentId: shipId });
    order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(order.status).toBe('partially_delivered'); // first shipment covers half the pair set
    // Ashcroft rejects: only its allocation changes
    await s.admin.mutation(api.ordFulfillment.cancelAllocations, {
      requestKey: 'supplier-cancel-fixture',
      supplierOrderId: ashQueue[0]._id,
      allocationIds: [ashQueue[0].items[0].allocationId],
      reason: 'Dealer rejected',
    });
    const children = await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect());
    expect(children.find((c) => c.supplierCode === 'zuo')!.status).toBe('shipped');
    expect(children.find((c) => c.supplierCode === 'ashcroft')!.status).toBe('cancelled');
    const notes = await s.t.run((ctx) => ctx.db.query('sysNotifications').collect());
    expect(notes.find((n) => n.template === 'shipment')!.text).toMatch(/Still to ship/);
    const status = await s.t.query(api.ordFulfillment.orderStatus, {
      number: order.number,
      email: 'buyer@x.com',
      guestCapability: est.guestCapability,
    });
    expect(status!.disclosure).toBe(SPLIT_WILL);
    expect(JSON.stringify(status)).not.toMatch(/zuo|ashcroft|111182/i); // no supplier names or SKUs
    // Freight invoice above the estimate: internal variance only
    await expect(s.admin.mutation(api.ordFulfillment.recordFreightActual, {
      supplierOrderId: zuoQueue[0]._id,
      estimatedMinor: 4_000,
      actualMinor: 6_000,
      invoiceRef: 'INV-1',
    })).rejects.toThrow(/Legacy freight entry is retired/);
    expect(await s.t.run(ctx => ctx.db.query('ordFreightActuals').collect())).toHaveLength(0);
  });
});

describe('EDI adapter (S23, FUL02, FUL03)', () => {
  it('sends only the Zuo child, once, and blocks resubmission while uncertain', async () => {
    const s = await setup({ approveMixed: true });
    await paidOrder(s, [zuoLine(s, 1), { productId: s.ashId, variantId: 'b1', packs: 1 }]);
    const child = (await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect())).find(
      (c) => c.supplierCode === 'zuo'
    )!;
    const ash = (await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').collect())).find(
      (c) => c.supplierCode === 'ashcroft'
    )!;
    const sent: unknown[] = [];
    const uncertain: Transport = { send: async (p) => (sent.push(p), { outcome: 'uncertain' }) };
    await expect(s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).rejects.toSatisfy(
      (e) => isCommerceError(e, 'FEATURE_DISABLED')
    );
    process.env.EDI_ZUO_ENABLED = 'true';
    await expect(s.t.run((ctx) => submitWith(ctx, ash._id, uncertain, 't'))).rejects.toSatisfy(
      (e) => isCommerceError(e, 'FORBIDDEN')
    );
    expect(await s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).toBe('uncertain');
    expect(JSON.stringify(sent[0])).toContain('111182');
    expect(JSON.stringify(sent[0])).not.toContain('BEN123');
    await expect(s.t.run((ctx) => submitWith(ctx, child._id, uncertain, 't'))).rejects.toSatisfy(
      (e) => isCommerceError(e, 'PAYMENT_RECONCILIATION_REQUIRED')
    );
    await expect(
      s.admin.mutation(api.ordFulfillment.markSubmitted, {
        supplierOrderId: child._id,
        supplierPo: 'X',
        acceptedCostMinor: 1,
      })
    ).rejects.toThrow();
    await s.admin.mutation(api.ediZuo.reconcileUncertain, {
      supplierOrderId: child._id,
      supplierReceived: true,
      note: 'Zuo confirmed by phone',
    });
    const after = (await s.t.run((ctx) => ctx.db.get(child._id)))!;
    expect(after).toMatchObject({ status: 'submitted' });
    expect(sent).toHaveLength(1);
  });
});

describe('returns and quotes (S20, S22)', () => {
  it('splits refunds into merchandise, tax, delivery, credit and cash', () => {
    const line = {
      pieces: 4,
      unitPackMinor: 45_806,
      packs: 2,
      discountMinor: 0,
      creditMinor: 10_000,
      taxMinor: 8_000,
      deliveryAllocMinor: 4_000,
      refundedMinor: 0,
    };
    const r = refundSplit(
      line,
      2,
      {
        windowDays: 30,
        restockingBps: 1_000,
        refundOriginalDelivery: false,
        customerPaysReturnFreight: true,
        damageClaimDays: 3,
        requiresAuthorization: true,
      },
      false
    );
    expect(r).toEqual({
      merchandise: 41_226,
      tax: 4_000,
      delivery: 0,
      creditRestored: 5_000,
      cash: 41_226 - 5_000 + 4_000,
      restocking: 4_580,
    });
    const goodwill = refundSplit(
      line,
      2,
      {
        windowDays: 30,
        restockingBps: 1_000,
        refundOriginalDelivery: false,
        customerPaysReturnFreight: true,
        damageClaimDays: 3,
        requiresAuthorization: true,
      },
      true
    );
    expect(goodwill.restocking).toBe(0);
    expect(goodwill.delivery).toBe(2_000);
  });

  it('needs an approved return policy before a return can be recorded', async () => {
    const s = await setup();
    await paidOrder(s, [zuoLine(s)]);
    const line = (await s.t.run((ctx) => ctx.db.query('ordOrderLines').first()))!;
    await expect(
      s.admin.mutation(api.ordReturns.request, {
        orderLineId: line._id,
        pieces: 1,
        reason: 'Changed mind',
        goodwill: false,
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'POLICY_NOT_APPROVED'));
  });

  it('versions quotes, refuses below-minimum trade prices and freezes accepted versions', async () => {
    const s = await setup();
    const projectId = await s.t.run((ctx) =>
      ctx.db.insert('commerceProjects', {
        token: 't',
        channel: 'house',
        name: 'n',
        email: 'e@x.com',
        phone: '',
        business: '',
        address: { line1: '', city: '', state: '', postalCode: '', country: 'US' },
        notes: '',
        requested: [],
        lines: [],
        delivery: 0,
        tax: 0,
        revision: 1,
        status: 'new',
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const low = await s.admin.mutation(api.ordQuotes.saveVersion, {
      projectId,
      lines: [
        {
          productId: s.productId,
          variantId: s.variantId,
          packs: 1,
          unitPackMinor: 30_000,
          discountMinor: 0,
        },
      ],
      service: 'curbside',
      deliveryMinor: 0,
      taxMinor: 0,
      validDays: 7,
      terms: 'Net',
    });
    expect(low.checks.margin).toBe(false);
    await expect(s.admin.mutation(api.ordQuotes.markSent, { versionId: low.id })).rejects.toThrow();
    const ok = await s.admin.mutation(api.ordQuotes.saveVersion, {
      projectId,
      lines: [
        {
          productId: s.productId,
          variantId: s.variantId,
          packs: 1,
          unitPackMinor: 45_806,
          discountMinor: 0,
        },
      ],
      service: 'curbside',
      deliveryMinor: 4_999,
      taxMinor: 0,
      validDays: 7,
      terms: 'Net',
    });
    expect(ok.checks).toMatchObject({ map: true, margin: true, policy: true });
    await s.admin.mutation(api.ordQuotes.markSent, { versionId: ok.id });
    await s.admin.mutation(api.ordQuotes.accept, {
      versionId: ok.id,
      acceptedBy: 'Client by email',
      evidence: 'Fixture consent message matching this version',
    });
    const v2 = await s.admin.mutation(api.ordQuotes.saveVersion, {
      projectId,
      lines: [
        {
          productId: s.productId,
          variantId: s.variantId,
          packs: 2,
          unitPackMinor: 45_806,
          discountMinor: 0,
        },
      ],
      service: 'curbside',
      deliveryMinor: 4_999,
      taxMinor: 0,
      validDays: 7,
      terms: 'Net',
    });
    const versions = await s.admin.query(api.ordQuotes.versions, { projectId });
    expect(versions.map((x) => [x.version, x.status])).toEqual([
      [3, 'draft'],
      [2, 'accepted'],
      [1, 'superseded'],
    ]);
    void v2;
  });
});

describe('customer copy (FUL05)', () => {
  it('uses the exact disclosure strings', () => {
    expect(splitDisclosure(false)).toBe(SPLIT_MAY);
    expect(splitDisclosure(true)).toBe(SPLIT_WILL);
    expect(SPLIT_MAY).toContain(
      'will not add delivery charges beyond the amount confirmed at checkout'
    );
  });
});

describe('delivery tool security and operations regressions', () => {
  it('uses approved trade prices, excludes Zuo project stacking and creates no trade referral snapshot', async () => {
    const s = await setup();
    process.env.TRADE_CHECKOUT_V2_ENABLED = 'true';
    const userId = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'trade@example.com' });
      await ctx.db.insert('holmProfiles', {
        userId,
        displayName: 'Studio',
        tradeStatus: 'approved',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const cv = (await ctx.db.get(s.variantId))!;
      const retail = (await ctx.db.get(cv.retailPriceRevisionId!))!;
      const { _id, _creationTime, ...data } = retail;
      void _id;
      void _creationTime;
      const priceId = await ctx.db.insert('catPriceRevisions', {
        ...data,
        channel: 'trade',
        packPriceMinor: 42000,
        piecePriceMinorInfo: 21000,
      });
      await ctx.db.patch(cv._id, { tradePriceRevisionId: priceId });
      const listing = (await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) =>
          q.eq('productId', s.productId).eq('channel', 'retail')
        )
        .unique())!;
      await ctx.db.insert('commerceListings', {
        productId: s.productId,
        channel: 'house',
        published: true,
        revision: 1,
        updatedAt: 1,
        snapshot: {
          ...listing.snapshot,
          variants: listing.snapshot.variants.map((v) => ({ ...v, price: 42000 })),
        },
      });
      await ctx.db.insert('catSupplierPolicies', {
        supplierId: cv.supplierId,
        kind: 'trade',
        summary: 'Fixture approved private trade pricing',
        evidenceRefs: ['fixture'],
        scope: { all: true },
        status: 'documented',
        createdAt: 1,
        createdBy: 'fixture',
        effectiveFrom: 0,
        source: 'fixture',
      });
      return userId;
    });
    const trade = s.t.withIdentity({ subject: `${userId}|s`, email: 'trade@example.com' });
    await expect(
      s.t.query(api.dlvTradeCalculator.calculate, { lines: [zuoLine(s)] })
    ).rejects.toThrow();
    const r = await trade.query(api.dlvTradeCalculator.calculate, { lines: [zuoLine(s)] });
    expect(r.tradeSubtotalMinor).toBe(42000);
    expect(r.baseTradeSavingsMinor).toBe(3806);
    expect(r.projectSavingsMinor).toBe(0);
    expect(r.lines[0].eligibleProject).toBe(false);
    const e = await estimateViaGateway(trade, {
      lines: [zuoLine(s)],
      channel: 'trade',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'trade',
    });
    expect(e.status).toBe('ok');
    const intent = await trade.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'trade-fixture-12345678',
      estimateId: e.estimateId,
      lines: [zuoLine(s)],
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: e.totalMinor!,
    });
    expect(intent.status).toBe('created');
    expect(await s.t.run((ctx) => ctx.db.query('prgAttributionSnapshots').collect())).toHaveLength(
      0
    );
    delete process.env.TRADE_CHECKOUT_V2_ENABLED;
  });
  it('denies a guest estimate without its capability and denies an unrelated signed-in account', async () => {
    const s = await setup();
    const e = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'x',
    });
    await expect(s.t.query(api.dlvEstimates.get, { estimateId: e.estimateId })).rejects.toSatisfy(
      (x) => isCommerceError(x, 'FORBIDDEN')
    );
    expect(
      (
        await s.t.query(api.dlvEstimates.get, {
          estimateId: e.estimateId,
          guestCapability: e.guestCapability,
        })
      )?.totalMinor
    ).toBe(e.totalMinor);
    const owned = await estimateViaGateway(s.admin, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'x',
    });
    await expect(
      s.t.query(api.dlvEstimates.get, {
        estimateId: owned.estimateId,
        guestCapability: e.guestCapability,
      })
    ).rejects.toSatisfy((x) => isCommerceError(x, 'FORBIDDEN'));
  });
  it('binds an idempotency key to the exact request and refuses replay by another buyer', async () => {
    const s = await setup();
    const args = {
      lines: [zuoLine(s)],
      channel: 'retail' as const,
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'x',
    };
    const e = await estimateViaGateway(s.t, args);
    const request = {
      idempotencyKey: 'delivery-bound-key-1234',
      estimateId: e.estimateId,
      guestCapability: e.guestCapability,
      lines: args.lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: e.totalMinor!,
      email: 'a@example.com',
    };
    await s.t.mutation(internal.ordCheckout.createIntent, request);
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, {
        ...request,
        idempotencyKey: 'second-tab-key-12345678',
      })
    ).rejects.toSatisfy((x) => isCommerceError(x, 'PAYMENT_RECONCILIATION_REQUIRED'));
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, { ...request, email: 'b@example.com' })
    ).rejects.toSatisfy((x) => isCommerceError(x, 'FORBIDDEN'));
    await expect(
      s.t.mutation(internal.ordCheckout.createIntent, { ...request, guestCapability: undefined })
    ).rejects.toSatisfy((x) => isCommerceError(x, 'FORBIDDEN'));
  });
  it('requires renewed acceptance when the same total has a different tax/delivery breakdown', async () => {
    const s = await setup();
    const lines = [zuoLine(s)];
    const e = await estimateViaGateway(s.t, {
      lines,
      channel: 'retail',
      zip: '95206',
      address: ADDRESS,
      visitorKey: 'x',
    });
    await s.t.run((ctx) =>
      ctx.db.patch(e.estimateId, {
        deliveryChargeMinor: e.deliveryChargeMinor! + 100,
        taxMinor: e.taxMinor! - 100,
      })
    );
    const r = await s.t.mutation(internal.ordCheckout.createIntent, {
      idempotencyKey: 'breakdown-key-12345678',
      estimateId: e.estimateId,
      guestCapability: e.guestCapability,
      lines,
      address: ADDRESS,
      service: 'curbside',
      acceptTotalMinor: e.totalMinor!,
    });
    expect(r.status).toBe('price_changed');
  });
  it('keeps future configuration inactive until its effective time and rejects overlapping schedules', async () => {
    const s = await setup();
    const before = await s.t.query(internal.sysConfig.active, {
      kind: 'estimatePolicy',
      key: 'estimate-policy',
    });
    const starts = Date.now() + 60000;
    const id = await s.admin.mutation(api.sysConfig.propose, {
      kind: 'estimatePolicy',
      key: 'estimate-policy',
      value: { validityMinutes: 15, zipNonbinding: true },
      note: 'Future version',
      effectiveFrom: starts,
    });
    await s.admin.mutation(api.sysConfig.approve, { id });
    expect(
      (
        await s.t.query(internal.sysConfig.active, {
          kind: 'estimatePolicy',
          key: 'estimate-policy',
        })
      ).version
    ).toBe(before.version);
    expect(
      (
        await s.t.query(internal.sysConfig.active, {
          kind: 'estimatePolicy',
          key: 'estimate-policy',
          at: starts,
        })
      ).version
    ).toBe(before.version + 1);
    const next = await s.admin.mutation(api.sysConfig.propose, {
      kind: 'estimatePolicy',
      key: 'estimate-policy',
      value: { validityMinutes: 10, zipNonbinding: true },
      note: 'Overlapping',
      effectiveFrom: starts + 60000,
    });
    await expect(s.admin.mutation(api.sysConfig.approve, { id: next })).rejects.toThrow();
  });
  it('quotes disabled lanes and missing fixed expenses without a partial payable total', async () => {
    const s = await setup();
    const e = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '60601',
      visitorKey: 'x',
    });
    expect(e.status).toBe('quote_required');
    expect(e.totalMinor).toBeNull();
    const missing = { ...FREIGHT };
    delete (missing as Partial<typeof FREIGHT>).fixedPaymentMinor;
    const id = await s.admin.mutation(api.sysConfig.propose, {
      kind: 'carrierRule',
      key: 'zuo-freight',
      value: missing,
      note: 'Missing fixed fee fixture',
    });
    await s.admin.mutation(api.sysConfig.approve, { id });
    const result = await estimateViaGateway(s.t, {
      lines: [zuoLine(s)],
      channel: 'retail',
      zip: '95206',
      visitorKey: 'x',
    });
    expect(result.status).toBe('quote_required');
  });
  it('does not let rotating visitor IDs evade the same basket rate limit', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++)
      await estimateViaGateway(s.t, {
        lines: [zuoLine(s)],
        channel: 'retail',
        zip: '95206',
        visitorKey: `visitor-${i}`,
      });
    await expect(
      estimateViaGateway(s.t, {
        lines: [zuoLine(s)],
        channel: 'retail',
        zip: '95206',
        visitorKey: 'another',
      })
    ).rejects.toThrow();
  });
  it('creates a real guest quote request, protects its contents and shows the whole quote total', async () => {
    const s = await setup();
    const r = await quoteViaGateway(s.t, {
      requestKey: 'a'.repeat(64),
      lines: [zuoLine(s)],
      channel: 'retail',
      postalCode: '99501',
      name: 'Test customer',
      email: 'customer@example.com',
      phone: '',
      service: 'curbside',
      notes: 'Residential',
      consent: true,
    });
    await expect(s.t.query(api.dlvOperations.requestStatus, { id: r.id })).rejects.toThrow();
    const detail = await s.admin.query(api.dlvOperations.quoteDetail, { id: r.id });
    const q = await s.admin.mutation(api.ordQuotes.saveVersion, {
      projectId: detail!.request.projectId,
      lines: [
        {
          productId: s.productId,
          variantId: s.variantId,
          packs: 1,
          unitPackMinor: 100000,
          discountMinor: 0,
        },
      ],
      address: { ...ADDRESS, postalCode: '99501' },
      service: 'curbside',
      deliveryMinor: 40000,
      taxMinor: 0,
      validDays: 7,
      terms: 'Fixture quote: curbside, no stock reservation',
      taxEvidence: 'Fixture address tax confirmed zero',
      fixedPaymentMinor: 30,
      freight: [
        {
          supplierCode: 'zuo',
          originZip: '95206',
          freightMinor: 40000,
          supplierFeeMinor: 1000,
          evidence: 'Synthetic carrier quote',
        },
      ],
    });
    await s.admin.mutation(api.ordQuotes.markSent, { versionId: q.id });
    await s.admin.mutation(api.dlvOperations.attachQuote, { id: r.id, versionId: q.id });
    const status = await s.t.query(api.dlvOperations.requestStatus, r);
    expect(status!.quote!.totalMinor).toBe(140000);
    // A valid payment session may finish after the quote's shorter acceptance window.
    await s.t.run(async (ctx) => {
      const shortExpiry = Date.now() + 2 * 60000;
      await ctx.db.patch(q.id, { expiresAt: shortExpiry });
      await ctx.db.patch(r.id, { quoteExpiresAt: shortExpiry });
    });
    await s.t.mutation(api.dlvOperations.acceptQuote, { ...r, versionId: q.id });
    await s.t.mutation(api.dlvOperations.acceptQuote, { ...r, versionId: q.id });
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('accepted');
    const prepared = await s.t.mutation(api.dlvOperations.prepareCheckout, r);
    const retry = await s.t.mutation(api.dlvOperations.prepareCheckout, r);
    expect(retry.estimateId).toBe(prepared.estimateId);
    const intent = await s.t.mutation(internal.ordCheckout.createIntent, {
      estimateId: retry.estimateId,
      guestCapability: retry.guestCapability,
      lines: retry.lines,
      address: retry.address,
      service: retry.service,
      acceptTotalMinor: retry.acceptTotalMinor,
      email: retry.email,
      idempotencyKey: 'manual-fixture-12345678',
    });
    expect(intent.status).toBe('created');
    expect(await s.t.run((ctx) => ctx.db.query('ordOrders').collect())).toHaveLength(0);
    if (intent.status === 'price_changed') throw new Error('Unexpected price change');
    await s.t.mutation(internal.ordCheckout.attachSession, {
      intentId: intent.intentId,
      sessionId: 'cs_manual',
    });
    vi.setSystemTime(Date.now() + 3 * 60000);
    expect(await s.t.mutation(internal.dlvQuoteLifecycle.expire, {})).toBe(1);
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('expired');
    const paid = {
      eventId: 'evt_manual_paid',
      type: 'checkout.session.completed',
      livemode: false,
      payloadHash: 'fixture',
      payload: {
        id: 'cs_manual',
        intentId: intent.intentId,
        payment_status: 'paid',
        amount_total: intent.totalMinor,
        currency: 'usd',
        payment_intent: 'pi_manual',
        email: 'customer@example.com',
        shipping: retry.address,
      },
    };
    await s.t.mutation(internal.ordPayments.receive, paid);
    await processEvents(s.t);
    await s.t.mutation(internal.ordPayments.receive, paid);
    await processEvents(s.t);
    expect(await s.t.query(api.dlvOperations.requestStatus, r)).toMatchObject({
      status: 'converted',
      orderPlaced: true,
    });
    expect(await s.t.run((ctx) => ctx.db.query('ordOrders').collect())).toHaveLength(1);
    await expect(s.t.mutation(api.dlvOperations.prepareCheckout, r)).rejects.toThrow();
  });
  it('records invoices once, rejects conflicting retries and never changes the paid total', async () => {
    const s = await setup();
    await paidOrder(s, [zuoLine(s)]);
    const child = (await s.t.run((ctx) => ctx.db.query('ordSupplierOrders').first()))!;
    const before = (await s.t.run((ctx) => ctx.db.get(child.orderId)))!;
    const invoice = {
      supplierOrderId: child._id,
      reference: 'INV-001',
      carrier: 'Fixture carrier',
      baseMinor: 25000,
      fuelMinor: 2000,
      accessorialMinor: 3000,
      supplierFeeMinor: 1000,
      creditMinor: 0,
      evidence: 'fixture invoice document',
      note: 'Invoice reconciliation test',
    };
    const a = await s.admin.mutation(api.dlvOperations.recordInvoice, invoice);
    expect(await s.admin.mutation(api.dlvOperations.recordInvoice, invoice)).toBe(a);
    expect(await s.admin.mutation(api.dlvOperations.recordInvoice, { ...invoice, reference: ' inv-001 ', carrier: 'fixture CARRIER' })).toBe(a);
    for (const changed of [{ evidence: 'different evidence' }, { note: 'changed explanation' }])
      await expect(s.admin.mutation(api.dlvOperations.recordInvoice, { ...invoice, ...changed })).rejects.toThrow(/different shipment or evidence/);
    const shipmentId = await s.t.run(ctx => ctx.db.insert('ordShipments', { supplierOrderId: child._id, status: 'shipped', createdAt: Date.now() }));
    await expect(s.admin.mutation(api.dlvOperations.recordInvoice, { ...invoice, shipmentId })).rejects.toThrow(/different shipment or evidence/);
    await expect(
      s.admin.mutation(api.dlvOperations.recordInvoice, { ...invoice, baseMinor: 25001 })
    ).rejects.toThrow();
    const r = await s.admin.query(api.dlvOperations.reconciliation, { supplierOrderId: child._id });
    expect(r!.actualFreightMinor).toBe(30000);
    expect(r!.actualSupplierFeeMinor).toBe(1000);
    expect((await s.t.run(ctx => ctx.db.query('sysReviewItems').collect())).some(r => r.kind === 'freight_variance')).toBe(true);
    const statement = {
      orderId: child.orderId,
      wholesaleMinor: 10000,
      dutiesMinor: 0,
      inboundMinor: 0,
      otherSupplierFeesMinor: 0,
      paymentMinor: 100,
      commissionMinor: 0,
      overheadMinor: 500,
      returnLossMinor: 0,
      advertisingMinor: 0,
      recoveriesMinor: 0,
      merchandiseRefundMinor: 0,
      deliveryRefundMinor: 0,
      freightFinal: true,
      evidence: 'Fixture all costs reconciled',
    };
    const statementId = await s.admin.mutation(api.dlvOperations.recordActualCosts, statement);
    expect(await s.admin.mutation(api.dlvOperations.recordActualCosts, statement)).toBe(
      statementId
    );
    const contribution = await s.admin.query(api.dlvOperations.actualContribution, {
      orderId: child.orderId,
    });
    expect(contribution?.complete).toBe(true);
    expect(contribution?.contributionMinor).toBe(
      before.totals.merchandise + before.totals.delivery - 41600
    );
    const legacyId = await s.t.run(ctx => ctx.db.insert('ordFreightActuals', {
      supplierOrderId: child._id, estimatedMinor: 25000, actualMinor: 30000,
      varianceMinor: 5000, invoiceRef: 'Historical INV-001', createdAt: Date.now(),
    }));
    expect(await s.admin.query(api.dlvOperations.actualContribution, { orderId: child.orderId })).toMatchObject({ complete: false, unresolvedLegacy: 1, contributionMinor: null });
    await expect(s.admin.mutation(api.dlvOperations.recordActualCosts, statement)).rejects.toThrow(/historical freight/);
    const review = { legacyId, resolution: 'matched_invoice' as const, invoiceIds: [a], evidence: 'Fixture source invoice', note: 'Verified this historical total matches itemized freight; not another expense.' };
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['finance'] });
    await expect(s.admin.mutation(api.dlvOperations.reviewLegacyFreight, review)).rejects.toSatisfy(e => isCommerceError(e, 'FORBIDDEN'));
    delete process.env.DELIVERY_ADMIN_ROLES;
    await expect(s.admin.mutation(api.dlvOperations.reviewLegacyFreight, { ...review, invoiceIds: [] })).rejects.toThrow();
    await expect(s.admin.mutation(api.dlvOperations.reviewLegacyFreight, { ...review, invoiceIds: [a, a] })).rejects.toThrow();
    const reviewId = await s.admin.mutation(api.dlvOperations.reviewLegacyFreight, review);
    expect(await s.admin.mutation(api.dlvOperations.reviewLegacyFreight, review)).toBe(reviewId);
    expect(await s.admin.query(api.dlvOperations.actualContribution, { orderId: child.orderId })).toMatchObject({ complete: false, unresolvedLegacy: 0 });
    await s.admin.mutation(api.dlvOperations.recordActualCosts, statement);
    expect(await s.admin.query(api.dlvOperations.actualContribution, { orderId: child.orderId })).toMatchObject({ complete: true, contributionMinor: contribution!.contributionMinor });
    expect((await s.admin.query(api.dlvOperations.reconciliation, { supplierOrderId: child._id }))!.legacyFreight[0].review?._id).toBe(reviewId);
    await s.admin.mutation(api.dlvOperations.reviewLegacyFreight, { ...review, resolution: 'duplicate_or_invalid', invoiceIds: [], note: 'Corrected review: duplicate historical record. Original invoice remains counted.' });
    expect(await s.admin.query(api.dlvOperations.actualContribution, { orderId: child.orderId })).toMatchObject({ complete: false });
    expect(await s.t.run(ctx => ctx.db.query('dlvLegacyFreightReviews').collect())).toHaveLength(2);
    expect((await s.t.run(ctx => ctx.db.get(legacyId)))!.actualMinor).toBe(30000);
    await s.admin.mutation(api.dlvOperations.recordActualCosts, {
      ...statement,
      wholesaleMinor: before.totals.total * 2,
      evidence: 'Fixture corrected costs exceed revenue',
    });
    const floorReviews = await s.t.run((ctx) =>
      ctx.db
        .query('sysReviewItems')
        .withIndex('by_entity', (q) =>
          q.eq('entityTable', 'ordOrders').eq('entityId', child.orderId)
        )
        .collect()
    );
    expect(floorReviews.some((r) => r.kind === 'actual_contribution_below_floor')).toBe(true);
    const credit = {
      ...invoice,
      reference: 'CREDIT-001',
      baseMinor: 0,
      fuelMinor: 0,
      accessorialMinor: 0,
      supplierFeeMinor: 0,
      creditMinor: 1000,
      note: 'Fixture carrier credit against INV-001',
    };
    await s.admin.mutation(api.dlvOperations.recordInvoice, credit);
    await s.admin.mutation(api.dlvOperations.recordInvoice, credit);
    expect(
      (await s.admin.query(api.dlvOperations.actualContribution, { orderId: child.orderId }))
        ?.complete
    ).toBe(false);

    expect((await s.t.run((ctx) => ctx.db.get(child.orderId)))!.totals).toEqual(before.totals);
  });
  it('charges each parcel minimum and accepts an explicitly supported supplier LTL method', () => {
    const carton = {
      lengthMm: 100,
      widthMm: 100,
      heightMm: 100,
      grossWeightG: 1000,
      cartonsPerPack: 1,
      supplierMethod: 'ground',
    };
    const line = { packs: 2, cartons: [carton] } as unknown as ResolvedLine;
    const reasons: string[] = [];
    expect(
      groupFreight(
        [line],
        { zip: '95206' },
        { ...FREIGHT, uncertaintyBps: 0 } as FreightConfig,
        reasons
      )
    ).toBe(5000);
    expect(reasons).toEqual([]);
    const ltl = {
      packs: 1,
      cartons: [{ ...carton, supplierMethod: 'ltl' }],
    } as unknown as ResolvedLine;
    expect(
      groupFreight(
        [ltl],
        { zip: '95206' },
        { ...FREIGHT, ltlRatingBasis: 'actual_weight', uncertaintyBps: 0 } as FreightConfig,
        []
      )
    ).toBe(41500);
  });
});

describe('delivery tax exemption scope', () => {
  it('requires a verified certificate, organization membership, destination and current dates', async () => {
    const s = await setup();
    const ids = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'certificate@example.com' });
      await ctx.db.insert('holmProfiles', {
        userId,
        displayName: 'Studio',
        tradeStatus: 'approved',
        createdAt: NOW,
        updatedAt: NOW,
      });
      const org = await ctx.db.insert('prgOrganizations', {
        legalName: 'Studio LLC',
        displayName: 'Studio',
        verification: 'verified',
        createdAt: NOW,
      });
      const other = await ctx.db.insert('prgOrganizations', {
        legalName: 'Other LLC',
        displayName: 'Other',
        verification: 'verified',
        createdAt: NOW,
      });
      const seat = await ctx.db.insert('prgOrganizationMembers', {
        organizationId: org,
        userId,
        role: 'purchasing',
        status: 'active',
        createdAt: NOW,
      });
      const membership = await ctx.db.insert('prgMemberships', {
        program: 'trade',
        userId,
        organizationId: org,
        state: 'approved',
        createdAt: NOW,
        updatedAt: NOW,
      });
      return { userId, org, other, seat, membership };
    });
    const certificate = await s.admin.mutation(api.dlvTaxExemptions.verify, {
      organizationId: ids.org,
      states: ['CA'],
      evidence: 'Fixture verified certificate',
      validFrom: 0,
      validUntil: Date.now() + 60000,
    });
    const trade = s.t.withIdentity({
      subject: `${ids.userId}|s`,
      email: 'certificate@example.com',
    });
    expect(await trade.run((ctx) => exemptionFor(ctx, 'trade', 'CA'))).toMatchObject({
      _id: certificate,
    });
    expect(await trade.run((ctx) => exemptionFor(ctx, 'retail', 'CA'))).toBeNull();
    expect(await trade.run((ctx) => exemptionFor(ctx, 'trade', 'NY'))).toBeNull();
    expect(
      await trade.run((ctx) => exemptionFor(ctx, 'trade', 'CA', Date.now() + 60001))
    ).toBeNull();
    await s.t.run((ctx) => ctx.db.patch(ids.membership, { organizationId: ids.other }));
    expect(await trade.run((ctx) => exemptionFor(ctx, 'trade', 'CA'))).toBeNull();
    await s.t.run((ctx) => ctx.db.patch(ids.membership, { organizationId: ids.org }));
    await s.t.run((ctx) => ctx.db.patch(ids.seat, { status: 'removed' }));
    expect(await trade.run((ctx) => exemptionFor(ctx, 'trade', 'CA'))).toBeNull();
    await s.t.run((ctx) => ctx.db.patch(ids.seat, { status: 'active' }));
    await s.admin.mutation(api.dlvTaxExemptions.revoke, {
      id: certificate,
      reason: 'Fixture revoked',
    });
    expect(await trade.run((ctx) => exemptionFor(ctx, 'trade', 'CA'))).toBeNull();
  });
});

describe('tax reporting reconciliation', () => {
  it('deduplicates and orders verified refund totals without issuing a refund', async () => {
    const s = await setup();
    const { intent } = await paidOrder(s, [zuoLine(s)]);
    const order = await s.t.run((ctx) =>
      ctx.db
        .query('ordOrders')
        .withIndex('by_payment', (q) => q.eq('paymentIntentId', 'pi_1'))
        .unique()
    );
    const event = {
      paymentIntentId: 'pi_1',
      eventId: 'evt_refund_2',
      refundedMinor: 2000,
      chargeMinor: intent.totalMinor,
    };
    await s.t.mutation(internal.dlvTax.receiveRefund, event);
    await s.t.mutation(internal.dlvTax.receiveRefund, event);
    await s.t.mutation(internal.dlvTax.receiveRefund, {
      ...event,
      eventId: 'evt_refund_1',
      refundedMinor: 1000,
    });
    const queue = await s.admin.query(api.dlvTax.reportingQueue, {});
    expect(queue.refunds).toHaveLength(1);
    expect(queue.refunds[0].confirmedRefundMinor).toBe(2000);
    const adjustment = {
      orderId: order!._id,
      kind: 'refund' as const,
      providerRef: 'tax_fixture_reversal',
      cumulativeRefundMinor: 2000,
      taxMinor: 100,
      evidence: 'Fixture provider reversal reviewed',
    };
    await expect(s.t.mutation(api.dlvTax.recordAdjustment, adjustment)).rejects.toThrow();
    const id = await s.admin.mutation(api.dlvTax.recordAdjustment, adjustment);
    expect(await s.admin.mutation(api.dlvTax.recordAdjustment, adjustment)).toBe(id);
    expect((await s.admin.query(api.dlvTax.reportingQueue, {})).refunds).toHaveLength(0);
    const reviews = await s.t.run((ctx) =>
      ctx.db
        .query('sysReviewItems')
        .withIndex('by_entity', (q) => q.eq('entityTable', 'ordOrders').eq('entityId', order!._id))
        .collect()
    );
    expect(reviews.find((r) => r.kind === 'tax_refund_reconciliation')?.status).toBe('resolved');
    expect((await s.t.run((ctx) => ctx.db.get(order!._id)))!.totals.total).toBe(intent.totalMinor);
    await expect(
      s.admin.mutation(api.dlvTax.recordAdjustment, {
        ...adjustment,
        providerRef: 'tax_unverified',
        cumulativeRefundMinor: 3000,
      })
    ).rejects.toThrow();
  });
});

describe('delivery staff permissions', () => {
  it('keeps support away from costs and rate approvals', async () => {
    const s = await setup();
    const estimate = await estimateViaGateway(s.t, { lines: [zuoLine(s)], channel: 'retail', zip: '95206', visitorKey: 'support-fixture' });
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['support'] });
    expect(await s.admin.query(api.dlvAccess.permissions, {})).toMatchObject({
      support: true,
      finance: false,
      approver: false,
    });
    expect(await s.admin.query(api.dlvAccess.supportQueue, {})).toEqual([]);
    const safe = await s.admin.query(api.dlvAccess.supportEstimate, { id: estimate.estimateId });
    expect(safe).toMatchObject({ postalCode: '95206', merchandiseMinor: estimate.merchandiseMinor });
    for (const field of ['internal', 'guestCapabilityHash', 'userId', 'groups', 'sourceVersionsHash']) expect(safe).not.toHaveProperty(field);
    expect((await s.admin.query(api.dlvAccess.supportRequests, { paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([]);

    await expect(s.admin.query(api.sysConfig.list, {})).rejects.toSatisfy((x) =>
      isCommerceError(x, 'FORBIDDEN')
    );
    await expect(s.admin.query(api.dlvAdmin.coverage, {})).rejects.toSatisfy((x) =>
      isCommerceError(x, 'FORBIDDEN')
    );
    await expect(s.admin.query(api.dlvTax.reportingQueue, {})).rejects.toSatisfy((x) =>
      isCommerceError(x, 'FORBIDDEN')
    );
  });
});

describe('delivery request lifecycle', () => {
  const requestInput = (s: Awaited<ReturnType<typeof setup>>, key: string) => ({
    requestKey: key.repeat(64),
    lines: [zuoLine(s)],
    channel: 'retail' as const,
    postalCode: '99501',
    name: 'Customer',
    email: 'customer@example.com',
    phone: '',
    service: 'curbside',
    notes: '',
    consent: true,
  });
  async function quotedRequest() {
    const s = await setup();
    const r = await quoteViaGateway(s.t, requestInput(s, 'a'));
    const detail = await s.admin.query(api.dlvOperations.quoteDetail, { id: r.id });
    const input = {
      projectId: detail!.request.projectId,
      lines: [
        {
          productId: s.productId,
          variantId: s.variantId,
          packs: 1,
          unitPackMinor: 100000,
          discountMinor: 0,
        },
      ],
      address: { ...ADDRESS, postalCode: '99501' },
      service: 'curbside',
      deliveryMinor: 40000,
      taxMinor: 0,
      validDays: 7,
      terms: 'Fixture curbside service',
      taxEvidence: 'Fixture verified zero tax',
      fixedPaymentMinor: 30,
      freight: [
        {
          supplierCode: 'zuo',
          originZip: '95206',
          freightMinor: 40000,
          supplierFeeMinor: 1000,
          evidence: 'Fixture freight',
        },
      ],
    };
    const q = await s.admin.mutation(api.ordQuotes.saveVersion, input);
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('ready_for_review');
    await s.admin.mutation(api.ordQuotes.markSent, { versionId: q.id });
    await s.admin.mutation(api.dlvOperations.attachQuote, { id: r.id, versionId: q.id });
    return { s, r, q, input };
  }
  it('reports overdue staff work but pauses the follow-up clock while awaiting customer information', async () => {
    const s = await setup();
    const r = await quoteViaGateway(s.t, requestInput(s, 'c'));
    const config = await s.admin.query(api.sysConfig.list, { status: 'proposed' });
    await s.admin.mutation(api.sysConfig.approve, {
      id: config.records.find((p) => p.key === 'delivery-monitoring')!._id,
    });
    vi.setSystemTime(Date.now() + 25 * 3600000);
    let report = await s.admin.query(api.dlvTelemetry.report, {});
    expect(report.overdue.find((q) => q.status === 'requested')?.count).toBe(1);
    await s.admin.mutation(api.dlvOperations.updateRequest, {
      id: r.id,
      status: 'needs_information',
      message: 'Please confirm delivery access.',
    });
    report = await s.admin.query(api.dlvTelemetry.report, {});
    expect(report.overdue.every((q) => q.count === 0)).toBe(true);
  });

  it('limits new requests to five per hour while allowing an exact retry', async () => {
    const s = await setup();
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      await quoteViaGateway(s.t, requestInput(s, key));
      vi.setSystemTime(Date.now() + 1000);
    }
    await expect(quoteViaGateway(s.t, requestInput(s, 'f'))).rejects.toThrow();
    await expect(quoteViaGateway(s.t, requestInput(s, 'a'))).resolves.toHaveProperty('id');
    expect(await s.t.run((ctx) => ctx.db.query('dlvQuoteRequests').collect())).toHaveLength(5);
    vi.setSystemTime(Date.now() + 12 * 60000);
    await expect(quoteViaGateway(s.t, requestInput(s, 'f'))).resolves.toHaveProperty('id');
  });
  it('allows only the owner to decline, and prevents acceptance/revision of a closed request', async () => {
    const { s, r, q, input } = await quotedRequest();
    const close = { ...r, outcome: 'declined' as const, reason: 'Project changed' };
    await expect(
      s.t.mutation(api.dlvOperations.closeRequest, { ...close, guestCapability: 'b'.repeat(64) })
    ).rejects.toThrow();
    await s.t.mutation(api.dlvOperations.closeRequest, close);
    await s.t.mutation(api.dlvOperations.closeRequest, close);
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('declined');
    await expect(
      s.t.mutation(api.dlvOperations.acceptQuote, { ...r, versionId: q.id })
    ).rejects.toThrow();
    await expect(
      s.admin.mutation(api.ordQuotes.accept, {
        versionId: q.id,
        acceptedBy: 'Customer',
        evidence: 'Stale approval',
      })
    ).rejects.toThrow();
    await expect(s.admin.mutation(api.ordQuotes.saveVersion, input)).rejects.toThrow();
    expect(await s.t.run((ctx) => ctx.db.query('ordOrders').collect())).toHaveLength(0);
  });
  it('expires sent requests once and requires acceptance of a newly reviewed version', async () => {
    const { s, r, q } = await quotedRequest();
    const version = await s.t.run((ctx) => ctx.db.get(q.id));
    vi.setSystemTime(version!.expiresAt + 1);
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('expired');
    expect(await s.t.mutation(internal.dlvQuoteLifecycle.expire, {})).toBe(1);
    expect(await s.t.mutation(internal.dlvQuoteLifecycle.expire, {})).toBe(0);
    expect((await s.t.run((ctx) => ctx.db.get(q.id)))!.status).toBe('expired');
    await expect(
      s.t.mutation(api.dlvOperations.acceptQuote, { ...r, versionId: q.id })
    ).rejects.toThrow();
  });
  it('preserves accepted versions through expiry and blocks revision of a current acceptance', async () => {
    const { s, r, q, input } = await quotedRequest();
    await s.t.mutation(api.dlvOperations.acceptQuote, { ...r, versionId: q.id });
    await expect(
      s.t.mutation(api.dlvOperations.closeRequest, { ...r, outcome: 'cancelled', reason: '' })
    ).rejects.toThrow();
    await expect(s.admin.mutation(api.ordQuotes.saveVersion, input)).rejects.toThrow();
    const frozen = await s.t.run((ctx) => ctx.db.get(q.id));
    vi.setSystemTime(frozen!.expiresAt + 1);
    expect(await s.t.mutation(internal.dlvQuoteLifecycle.expire, {})).toBe(1);
    expect(await s.t.run((ctx) => ctx.db.get(q.id))).toEqual(frozen);
    expect((await s.t.query(api.dlvOperations.requestStatus, r))!.status).toBe('expired');
    await expect(s.t.mutation(api.dlvOperations.prepareCheckout, r)).rejects.toThrow();
  });
});

describe('partial refund rounding', () => {
  it('preserves every cent across sequential piece returns and refunds delivery tax only with delivery', () => {
    const l = {
      pieces: 3,
      packs: 1,
      unitPackMinor: 10001,
      discountMinor: 0,
      creditMinor: 0,
      taxMinor: 101,
      deliveryAllocMinor: 4999,
      deliveryTaxAllocMinor: 401,
      refundedMinor: 0,
    };
    const p = {
      windowDays: 30,
      restockingBps: 0,
      refundOriginalDelivery: false,
      customerPaysReturnFreight: true,
      damageClaimDays: 2,
      requiresAuthorization: true,
    };
    const rs = [0, 1, 2].map((n) => refundSplit(l, 1, p, false, n));
    expect(rs.reduce((n, r) => n + r.merchandise, 0)).toBe(10001);
    expect(rs.reduce((n, r) => n + r.tax, 0)).toBe(101);
    expect(refundSplit(l, 3, p, true).tax).toBe(502);
  });
});

describe('customer receipts and order access', () => {
  it('requires the scoped capability and frozen verified payment; distinguishes provider acceptance', async () => {
    const s = await setup();
    const { est, intent } = await paidOrder(s, [zuoLine(s)]);
    const args = { sessionId: 'cs_1', guestCapability: est.guestCapability };
    expect(await s.t.query(api.ordReceipts.receipt, { sessionId: 'cs_1' })).toEqual({
      state: 'unavailable',
    });
    expect(
      await s.t.query(api.ordReceipts.receipt, { ...args, guestCapability: 'b'.repeat(64) })
    ).toEqual({ state: 'unavailable' });
    let receipt = await s.t.query(api.ordReceipts.receipt, args);
    expect(receipt).toMatchObject({ state: 'confirmed', emailStatus: 'pending' });
    expect(JSON.stringify(receipt)).not.toMatch(
      /buyer@x.com|guestCapability|supplierCode|costRevision|95206/
    );
    const order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    expect(
      await s.t.query(api.ordFulfillment.orderStatus, {
        number: order.number,
        email: 'buyer@x.com',
      })
    ).toBeNull();
    await s.t.run(async (ctx) => {
      // A later quote preparation may rotate the estimate capability; accepted intent access stays frozen.
      await ctx.db.patch(est.estimateId, { guestCapabilityHash: 'changed' });
      const n = (await ctx.db
        .query('sysNotifications')
        .withIndex('by_dedupe', (q) => q.eq('dedupeKey', `order-confirmation:${order._id}`))
        .unique())!;
      await ctx.db.patch(n._id, { status: 'sent', providerId: 'provider_fixture' });
    });
    receipt = await s.t.query(api.ordReceipts.receipt, args);
    expect(receipt).toMatchObject({ state: 'confirmed', emailStatus: 'accepted' });
    for (const [status, state] of [
      ['session_open', 'pending'],
      ['exception', 'review_required'],
      ['failed', 'not_completed'],
      ['expired', 'not_completed'],
    ] as const) {
      await s.t.run((ctx) => ctx.db.patch(intent.intentId, { status }));
      expect(await s.t.query(api.ordReceipts.receipt, args)).toEqual({ state });
    }
  });

  it('expires guest access, permits verified guest-email recovery, and isolates account-owned orders', async () => {
    const s = await setup();
    const { est, intent } = await paidOrder(s, [zuoLine(s)]);
    const order = (await s.t.run((ctx) => ctx.db.query('ordOrders').first()))!;
    const uid = await s.t.run((ctx) => ctx.db.insert('users', { email: 'buyer@x.com' }));
    const account = s.t.withIdentity({ subject: `${uid}|s`, email: 'buyer@x.com' });
    expect(await account.query(api.ordReceipts.receipt, { sessionId: 'cs_1' })).toEqual({
      state: 'unavailable',
    });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(uid, { emailVerificationTime: Date.now() });
      await ctx.db.patch(intent.intentId, { createdAt: Date.now() - 90 * 86400000 });
      await ctx.db.patch(est.estimateId, { createdAt: Date.now() - 90 * 86400000 });
    });
    expect(
      await s.t.query(api.ordReceipts.receipt, {
        sessionId: 'cs_1',
        guestCapability: est.guestCapability,
      })
    ).toEqual({ state: 'unavailable' });
    await expect(
      s.t.query(api.dlvEstimates.get, {
        estimateId: est.estimateId,
        guestCapability: est.guestCapability,
      })
    ).rejects.toThrow();
    expect(await account.query(api.ordReceipts.receipt, { sessionId: 'cs_1' })).toMatchObject({
      state: 'confirmed',
    });
    expect(
      await account.query(api.ordFulfillment.orderStatus, { number: order.number })
    ).toMatchObject({ number: order.number });
    const owner = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'owner@example.com' });
      await ctx.db.patch(intent.intentId, { buyer: { userId, email: 'buyer@x.com' } });
      await ctx.db.patch(order._id, { buyerUserId: userId });
      return userId;
    });
    expect(await account.query(api.ordReceipts.receipt, { sessionId: 'cs_1' })).toEqual({
      state: 'unavailable',
    });
    expect(
      await account.query(api.ordFulfillment.orderStatus, { number: order.number })
    ).toBeNull();
    expect(
      await s.t
        .withIdentity({ subject: `${owner}|s` })
        .query(api.ordReceipts.receipt, { sessionId: 'cs_1' })
    ).toMatchObject({ state: 'confirmed' });
  });

  it('keeps legacy receipts minimal and unknown/invalid redirects cannot confirm payment', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.ordReceipts.receipt, { sessionId: 'not-a-session' })).toEqual({
      state: 'unavailable',
    });
    expect(await t.query(api.ordReceipts.receipt, { sessionId: 'cs_unknown' })).toEqual({
      state: 'pending',
    });
    const id = await t.mutation(internal.orders.createOrder, {
      stripeSessionId: 'cs_legacy_fixture',
      customerEmail: 'private@example.com',
      items: [],
      subtotal: 20,
      total: 20,
      currency: 'usd',
    });
    const receipt = await t.query(api.ordReceipts.receipt, { sessionId: 'cs_legacy_fixture' });
    expect(receipt).toEqual({ state: 'legacy_confirmed', disclosure: SPLIT_MAY });
    await t.run((ctx) => ctx.db.patch(id, { status: 'cancelled' }));
    expect(await t.query(api.ordReceipts.receipt, { sessionId: 'cs_legacy_fixture' })).toEqual({
      state: 'not_completed',
    });
    await t.run((ctx) =>
      ctx.db.patch(id, {
        status: 'paid',
        createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      })
    );
    expect(await t.query(api.ordReceipts.receipt, { sessionId: 'cs_legacy_fixture' })).toEqual({
      state: 'unavailable',
    });
  });
});

describe('delivery public error and input privacy', () => {
  it('omits internal policy detail on both public estimate paths and retains every rejected cart line', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const config = await ctx.db.query('sysConfig').collect();
      for (const row of config)
        if (row.kind === 'estimatePolicy') await ctx.db.patch(row._id, { status: 'retired' });
    });
    const args = {
      lines: [zuoLine(s)],
      channel: 'retail' as const,
      zip: '95206',
      visitorKey: 'fixture-privacy',
    };
    for (const run of [
      () => estimateViaGateway(s.t, args),
      () => s.t.mutation(internal.dlvEstimates.compute, args),
    ]) {
      const error = await run().then(
        () => null,
        (e) => e
      );
      expect(commerceErrorData(error)).toEqual({
        code: 'POLICY_NOT_APPROVED',
        message: "This isn't available yet.",
      });
      expect(JSON.stringify(error)).not.toMatch(/detail|estimate-policy|estimatePolicy/);
    }
    const invalid = await quoteViaGateway(s.t, {
      requestKey: 'a'.repeat(64),
      lines: [zuoLine(s)],
      channel: 'retail',
      postalCode: '95206',
      name: 'Customer',
      email: 'customer@example.com',
      phone: '',
      service: 'curbside',
      notes: '',
      consent: true,
      address: { ...ADDRESS, line2: 'x'.repeat(201) },
    }).then(
      () => null,
      (e) => e
    );
    expect(commerceErrorData(invalid)?.code).toBe('INVALID_INPUT');
    expect(await s.t.run((ctx) => ctx.db.query('dlvQuoteRequests').collect())).toHaveLength(0);
    expect(await s.t.run((ctx) => ctx.db.query('dlvEstimates').collect())).toHaveLength(0);
  });
});

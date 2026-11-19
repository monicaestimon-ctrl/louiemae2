// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
const stripe = vi.hoisted(() => ({
  customer: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class {
    customers = { create: stripe.customer };
    checkout = {
      sessions: { create: stripe.create, retrieve: stripe.retrieve, list: stripe.list },
    };
  },
}));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
beforeEach(() => {
  vi.stubEnv('TRENDSI_MANUAL_ENABLED', 'true');
  vi.stubEnv('CJ_ADMIN_EMAILS', 'owner@example.com');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  stripe.customer.mockReset().mockResolvedValue({ id: 'cus_manual' });
  stripe.create
    .mockReset()
    .mockResolvedValue({ id: 'cs_manual', url: 'https://checkout.stripe.com/manual' });
  stripe.retrieve.mockReset();
  stripe.list.mockReset().mockResolvedValue({ data: [], has_more: false });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const { user, product } = await t.run(async (ctx) => ({
    user: await ctx.db.insert('users', { email: 'owner@example.com' }),
    product: await ctx.db.insert('products', {
      name: 'Annalise Set',
      description: 'Cotton set.',
      price: 90,
      images: ['https://example.com/set.jpg'],
      category: 'Sets',
      collection: 'fashion',
      storefrontStatus: 'published',
      inStock: true,
      sourceProperties: {
        supplier: 'Trendsi',
        supplierProductId: '123',
        supplierVariants: JSON.stringify([{ id: 7, sku: 'ABC-7' }]),
      },
      variants: [{ id: 'trendsi-7', name: 'Pink / S', priceAdjustment: 0, inStock: true }],
    }),
  }));
  const admin = t.withIdentity({ subject: user + '|s', email: 'owner@example.com' });
  const input = {
    token: 'manual-request-token-12345',
    name: 'Test Customer',
    email: 'buyer@example.com',
    phone: '',
    address: {
      line1: '123 Main St',
      line2: '',
      city: 'Chicago',
      state: 'IL',
      postalCode: '60601',
      country: 'US' as const,
    },
    notes: '',
    website: '',
    items: [{ productId: product, variantId: 'trendsi-7', quantity: 2 }],
  };
  await t.mutation(api.trendsiManual.submit, input);
  const o = await t.run((ctx) => ctx.db.query('trendsiOrders').unique());
  const id = o!._id;
  const confirm = async (revision = 1) =>
    admin.mutation(api.trendsiManual.confirm, {
      id,
      revision,
      shippingMinor: 600,
      deliveryEstimate: '5–10 business days',
      stockEvidence: 'Checked the exact SKU in supplier account',
      quantities: [2],
      confirmed: true,
    });
  return { t, admin, product, input, id, confirm };
}
async function paymentFixture() {
  const s = await fixture();
  await s.confirm();
  await s.admin.action(api.trendsiPayments.createLink, { id: s.id, revision: 2 });
  const paid = {
    id: 'cs_manual',
    livemode: false,
    metadata: { trendsiOrderId: s.id, revision: '2' },
    payment_status: 'paid',
    status: 'complete',
    currency: 'usd',
    amount_subtotal: 18000,
    shipping_cost: { amount_subtotal: 600 },
    amount_total: 18600,
    total_details: { amount_tax: 0 },
    automatic_tax: { status: 'complete' },
    payment_intent: {
      id: 'pi_manual',
      latest_charge: { amount: 18600, amount_refunded: 0, disputed: false },
    },
  };
  stripe.retrieve.mockResolvedValue(paid);
  return { ...s, paid };
}
describe('Trendsi request, payment and manual fulfillment', () => {
  it('snapshots server prices and exact supplier options, and makes identical requests idempotent', async () => {
    const s = await fixture();
    await s.t.mutation(api.trendsiManual.submit, s.input);
    const orders = await s.t.run((ctx) => ctx.db.query('trendsiOrders').collect());
    expect(orders).toHaveLength(1);
    expect(orders[0].items[0]).toMatchObject({
      supplierSku: 'ABC-7',
      unitMinor: 9000,
      quantity: 2,
    });
    await expect(
      s.t.mutation(api.trendsiManual.submit, { ...s.input, name: 'Changed' })
    ).rejects.toThrow('new request');
    await expect(
      s.t.mutation(api.trendsiManual.submit, {
        ...s.input,
        token: 'other-request-token-12345',
        items: [{ ...s.input.items[0], quantity: -1 }],
      })
    ).rejects.toThrow();
  });
  it('keeps customer records and operations mutations private', async () => {
    const s = await fixture();
    await expect(s.t.query(api.trendsiManual.detail, { id: s.id })).rejects.toThrow();
    await expect(
      s.t.mutation(api.trendsiManual.confirm, {
        id: s.id,
        revision: 1,
        shippingMinor: 0,
        deliveryEstimate: 'Ground',
        stockEvidence: 'Checked stock',
        quantities: [2],
        confirmed: true,
      })
    ).rejects.toThrow();
    expect(await s.t.query(api.trendsiManual.receipt, { id: s.id, access: 'wrong' })).toBeNull();
  });
  it('requires fresh manual confirmation and prevents two requests promising the same units', async () => {
    const s = await fixture();
    await s.confirm();
    await s.t.mutation(api.trendsiManual.submit, {
      ...s.input,
      token: 'second-request-token-12345',
    });
    const second = await s.t.run((ctx) =>
      ctx.db
        .query('trendsiOrders')
        .withIndex('by_token', (q) => q.eq('token', 'second-request-token-12345'))
        .unique()
    );
    await expect(
      s.admin.mutation(api.trendsiManual.confirm, {
        id: second!._id,
        revision: 1,
        shippingMinor: 0,
        deliveryEstimate: 'Ground',
        stockEvidence: 'Checked stock',
        quantities: [2],
        confirmed: true,
      })
    ).rejects.toThrow('Other pending orders');
    await s.t.run((ctx) => ctx.db.patch(s.id, { stockConfirmedAt: Date.now() - 31 * 60_000 }));
    await expect(
      s.admin.action(api.trendsiPayments.createLink, { id: s.id, revision: 2 })
    ).rejects.toThrow('Reconfirm');
    expect(stripe.create).not.toHaveBeenCalled();
  });
  it('verifies payment once, then permits supplier ordering and bounded partial shipments', async () => {
    const s = await paymentFixture();
    await expect(
      s.admin.mutation(api.trendsiManual.progress, {
        id: s.id,
        revision: 2,
        action: 'ordered',
        note: 'Placed order',
        supplierReference: 'T-100',
      })
    ).rejects.toThrow('Verify payment');
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect(
      (await s.t.run((ctx) => ctx.db.query('trendsiOrderEvents').collect())).filter(
        (e) => e.action === 'payment_verified'
      )
    ).toHaveLength(1);
    await s.admin.mutation(api.trendsiManual.progress, {
      id: s.id,
      revision: 2,
      action: 'ordered',
      note: 'Supplier order placed manually',
      supplierReference: 'T-100',
    });
    await s.admin.mutation(api.trendsiManual.ship, {
      id: s.id,
      revision: 3,
      lineIndex: 0,
      quantity: 1,
      carrier: 'USPS',
      tracking: '9400-first',
    });
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.status).toBe('partially_shipped');
    await expect(
      s.admin.mutation(api.trendsiManual.ship, {
        id: s.id,
        revision: 4,
        lineIndex: 0,
        quantity: 2,
        carrier: 'USPS',
        tracking: 'too-many',
      })
    ).rejects.toThrow('exceeds');
    await s.admin.mutation(api.trendsiManual.ship, {
      id: s.id,
      revision: 4,
      lineIndex: 0,
      quantity: 1,
      carrier: 'USPS',
      tracking: '9400-second',
    });
    await s.admin.mutation(api.trendsiManual.progress, {
      id: s.id,
      revision: 5,
      action: 'delivered',
      note: 'Carrier delivery confirmed',
    });
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.status).toBe('delivered');
    expect(await s.t.run((ctx) => ctx.db.query('orders').collect())).toHaveLength(0);
  });
  it('holds mismatched payments and refunds instead of releasing fulfillment', async () => {
    const s = await paymentFixture();
    stripe.retrieve.mockResolvedValue({ ...s.paid, amount_total: 1 });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({ status: 'exception' });
    stripe.retrieve.mockResolvedValue(s.paid);
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.status).toBe('exception');
    await expect(
      s.admin.mutation(api.trendsiManual.progress, {
        id: s.id,
        revision: 2,
        action: 'ordered',
        note: 'Order now',
        supplierReference: 'T-100',
      })
    ).rejects.toThrow();
  });
  it('expires a payment and releases its local holds only after Stripe confirms expiry', async () => {
    const s = await paymentFixture();
    stripe.retrieve.mockResolvedValue({
      ...s.paid,
      payment_status: 'unpaid',
      status: 'expired',
      payment_intent: null,
    });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      status: 'requested',
      revision: 3,
    });
    expect(
      (await s.t.run((ctx) => ctx.db.query('trendsiStockHolds').collect())).every((h) => !h.active)
    ).toBe(true);
  });
  it('recovers a session after a lost attach response without creating a second payment', async () => {
    const s = await paymentFixture();
    await s.t.run((ctx) => ctx.db.patch(s.id, { sessionId: undefined, paymentUrl: undefined }));
    stripe.list.mockResolvedValue({
      data: [{ ...s.paid, url: 'https://checkout.stripe.com/manual' }],
      has_more: false,
    });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      sessionId: 'cs_manual',
      status: 'paid',
    });
    expect(stripe.create).toHaveBeenCalledTimes(1);
  });
  it('rejects the wrong Stripe mode even when metadata matches', async () => {
    const s = await paymentFixture();
    stripe.retrieve.mockResolvedValue({ ...s.paid, livemode: true });
    await expect(s.admin.action(api.trendsiPayments.check, { id: s.id })).rejects.toThrow(
      'identity'
    );
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.paidAt).toBeUndefined();
  });
  it('records verified full refunds, releases holds, and never reopens a refunded order', async () => {
    const s = await paymentFixture();
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    stripe.retrieve.mockResolvedValue({
      ...s.paid,
      payment_intent: {
        id: 'pi_manual',
        latest_charge: { amount: 18600, amount_refunded: 18600, disputed: false },
      },
    });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.status).toBe('refunded');
    expect(
      (await s.t.run((ctx) => ctx.db.query('trendsiStockHolds').collect())).every((h) => !h.active)
    ).toBe(true);
    stripe.retrieve.mockResolvedValue(s.paid);
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect((await s.t.run((ctx) => ctx.db.get(s.id)))?.status).toBe('refunded');
  });
  it('holds partial refunds and prevents fulfillment even after payment was recorded', async () => {
    const s = await paymentFixture();
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    stripe.retrieve.mockResolvedValue({
      ...s.paid,
      payment_intent: {
        id: 'pi_manual',
        latest_charge: { amount: 18600, amount_refunded: 100, disputed: false },
      },
    });
    await s.admin.action(api.trendsiPayments.check, { id: s.id });
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      status: 'exception',
      paymentHold: expect.stringContaining('refund'),
    });
    await expect(
      s.admin.mutation(api.trendsiManual.resolveException, {
        id: s.id,
        revision: 2,
        note: 'Resume order',
      })
    ).rejects.toThrow();
  });
});

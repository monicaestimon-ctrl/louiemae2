// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';

const stripe = vi.hoisted(() => ({ create: vi.fn(), event: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  checkout = { sessions: { create: stripe.create } };
  webhooks = { constructEventAsync: stripe.event };
} }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const product = { name: 'Stored chair', price: 100, description: 'Chair', images: ['https://example.com/chair.jpg'], category: 'chairs', collection: 'furniture', inStock: true };
const variant = { id: 'large', name: 'Large', priceAdjustment: 25, inStock: true, cjVariantId: 'stored-vid', cjSku: 'stored-sku' };
const checkout = (t: ReturnType<typeof convexTest>, items: unknown[]) => t.fetch('/stripe/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items, successUrl: 'https://www.louiemae.com/#checkout/success', cancelUrl: 'https://www.louiemae.com/#checkout/cancel' }),
});
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_mock');
  vi.stubEnv('CJ_AUTO_FULFILLMENT_ENABLED', 'false');
  stripe.create.mockReset().mockResolvedValue({ id: 'cs_test_mock', url: 'https://checkout.stripe.com/test' });
  stripe.event.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('checkout uses authoritative catalog data before calling Stripe', () => {
  it('overrides manipulated price, name, image and fulfillment identifiers with the selected stored variant', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', { ...product, variants: [variant] }));
    const response = await checkout(t, [{ productId: id, variantId: 'large', quantity: 2, price: 0.01, name: 'Forged', image: 'https://evil.example/image', cjVariantId: 'forged', cjSku: 'forged' }]);
    expect(response.status).toBe(200);
    const session = stripe.create.mock.calls[0][0];
    expect(session.line_items).toEqual([{ price_data: { currency: 'usd', product_data: { name: 'Stored chair - Large', images: product.images }, unit_amount: 12500 }, quantity: 2 }]);
    expect(JSON.parse(session.metadata.items)).toEqual([{ productId: id, variantId: 'large', variantName: 'Large', cjVariantId: 'stored-vid', cjSku: 'stored-sku', name: 'Stored chair - Large', price: 125, quantity: 2 }]);
    expect(await t.run(ctx => ctx.db.query('orders').collect())).toEqual([]);
  });

  it('supports normal manual products without accepting browser-supplied CJ mappings', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', product));
    expect((await checkout(t, [{ productId: id, quantity: 1, cjVariantId: 'forged', cjSku: 'forged' }])).status).toBe(200);
    expect(JSON.parse(stripe.create.mock.calls[0][0].metadata.items)[0]).toEqual({ productId: id, name: product.name, price: 100, quantity: 1 });
  });

  it('records the authoritative checkout snapshot once when the paid session is delivered twice', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', product));
    expect((await checkout(t, [{ productId: id, quantity: 2, price: 0.01 }])).status).toBe(200);
    const session = stripe.create.mock.calls[0][0];
    // Stripe signature verification is mocked; database/order behavior is real.
    // No customer email or CJ mapping is supplied, so no external action runs.
    stripe.event.mockResolvedValue({ type: 'checkout.session.completed', data: { object: {
      id: 'cs_test_mock', payment_status: 'paid', payment_intent: 'pi_mock',
      metadata: session.metadata, amount_subtotal: 20000, amount_total: 20000,
      currency: 'usd',
    } } });
    for (let delivery = 0; delivery < 2; delivery++) {
      expect((await t.fetch('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 'mock' }, body: '{}' })).status).toBe(200);
    }
    const orders = await t.run(ctx => ctx.db.query('orders').collect());
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'paid', subtotal: 200, items: [{ productId: id, price: 100, quantity: 2 }] });
  });

  it.each(['missing', 'invalid', 'deleted'])('rejects %s catalog IDs even when automatic fulfillment is disabled', async kind => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => { const id = await ctx.db.insert('products', product); await ctx.db.delete(id); return id; });
    const productId = kind === 'missing' ? undefined : kind === 'invalid' ? 'invalid' : id;
    expect((await checkout(t, [{ productId, quantity: 1, price: 1 }])).status).toBe(409);
    expect(stripe.create).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'missing', 'sold-out', 'unpublished', 'invalid-price'])('rejects %s selections before creating a payment session', async kind => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', {
      ...product, ...(kind === 'unpublished' ? { storefrontStatus: 'hidden' as const } : {}),
      price: kind === 'invalid-price' ? -100 : 100,
      variants: [{ ...variant, inStock: kind !== 'sold-out' }],
    }));
    const variantId = kind === 'missing' ? undefined : kind === 'unknown' ? 'forged' : 'large';
    expect((await checkout(t, [{ productId: id, variantId, quantity: 1, price: 1 }])).status).toBe(409);
    expect(stripe.create).not.toHaveBeenCalled();
  });
});

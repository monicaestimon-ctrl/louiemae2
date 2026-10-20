// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { api, internal } from './_generated/api';
const stripe = vi.hoisted(() => ({ create: vi.fn(), event: vi.fn() }));
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: stripe.create } };
    webhooks = { constructEventAsync: stripe.event };
  },
}));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const checkout = (t: ReturnType<typeof convexTest>, items: unknown[]) =>
  t.fetch('/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
async function fixture(
  t: ReturnType<typeof convexTest>,
  provider: 'ashcroft' | 'owner_managed' = 'ashcroft'
) {
  return t.run(async (ctx) => {
    const draft = {
      ...blankCommerceDraft(),
      name: 'Bramwell Leather Sofa',
      description: 'A sofa.',
      category: 'Sofas',
      images: ['https://example.com/sofa.jpg'],
      factsApproved: true,
      imagesApproved: true,
      variants: [
        {
          id: 'tan',
          name: 'Tan',
          sku: 'SOF00401401',
          cost: 899,
          minimum: 1,
          increment: 1,
          retail: 224750,
          commercial: 180000,
        },
      ],
    };
    const id = await ctx.db.insert('commerceProducts', {
      provider,
      sourceKey: 'ashcroft:sofa',
      draft,
      revision: 1,
      updatedAt: 1,
    });
    const listing = await ctx.db.insert('commerceListings', {
      productId: id,
      channel: 'retail',
      published: true,
      revision: 1,
      snapshot: listingSnapshot(draft, 'ashcroft', 'retail'),
      fulfillment: draft.variants,
      updatedAt: 1,
    });
    return { id, listing };
  });
}
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_mock');
  stripe.create
    .mockReset()
    .mockResolvedValue({ id: 'cs_mock', url: 'https://checkout.stripe.com/test' });
  stripe.event.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe('Ashcroft retail checkout', () => {
  it('uses the existing LouieMae card and detail shape with the same checkout prices', async () => {
    const t = convexTest(schema, modules);
    const { id, listing } = await fixture(t);
    const page = await t.query(api.retailLaunch.storefrontPage, { paginationOpts: { numItems: 25, cursor: null } });
    const detail = await t.query(api.products.getStorefrontDetail, { id });
    expect(page.page[0]).toMatchObject({ _id: id, price: 2549, category: 'Sofas', collection: 'furniture', inStock: true });
    expect(detail).toMatchObject({ _id: id, price: 2549, deliveryFee: 79, variants: [{ id: 'tan', priceAdjustment: 0, inStock: true }] });
    expect(detail).not.toHaveProperty('fulfillment');
    await t.run(ctx => ctx.db.patch(listing, { published: false }));
    expect(await t.query(api.products.getStorefrontDetail, { id })).toBeNull();
  });
  it('uses stored prices, per-unit delivery, and supplier mapping despite client manipulation', async () => {
    const t = convexTest(schema, modules);
    const { id } = await fixture(t);
    const response = await checkout(t, [
      { productId: id, variantId: 'tan', quantity: 2, price: 1, cjSku: 'forged', deliveryFee: 0 },
    ]);
    expect(response.status).toBe(200);
    const session = stripe.create.mock.calls[0][0];
    expect(session.line_items[0]).toMatchObject({
      price_data: { unit_amount: 254900 },
      quantity: 2,
    });
    expect(session.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(15800);
    const saved = await t.query(internal.retailLaunch.snapshot, {
      id: session.metadata.retailCheckoutId,
    });
    expect(saved?.items[0]).toMatchObject({
      supplierSku: 'SOF00401401',
      fulfillmentProvider: 'ashcroft',
      price: 2549,
    });
    expect(saved?.items[0]).not.toHaveProperty('cjSku');
    expect(await t.run((ctx) => ctx.db.query('orders').collect())).toHaveLength(0);
  });
  it.each(['legacy', 'wrong-provider', 'unpublished', 'wrong-variant', 'invalid-id'])(
    'rejects %s before contacting Stripe',
    async (kind) => {
      const t = convexTest(schema, modules);
      const { id, listing } = await fixture(
        t,
        kind === 'wrong-provider' ? 'owner_managed' : 'ashcroft'
      );
      if (kind === 'unpublished') await t.run((ctx) => ctx.db.patch(listing, { published: false }));
      const productId =
        kind === 'legacy'
          ? await t.run((ctx) =>
              ctx.db.insert('products', {
                name: 'Dress',
                price: 100,
                description: 'Dress',
                images: [],
                category: 'dress',
                collection: 'clothing',
                inStock: true,
              })
            )
          : kind === 'invalid-id'
            ? 'invalid'
            : id;
      expect(
        (
          await checkout(t, [
            { productId, variantId: kind === 'wrong-variant' ? 'bad' : 'tan', quantity: 1 },
          ])
        ).status
      ).toBe(409);
      expect(stripe.create).not.toHaveBeenCalled();
    }
  );
  it.each([0, -1, 1.5, 21])('rejects invalid quantity %s', async (quantity) => {
    const t = convexTest(schema, modules);
    const { id } = await fixture(t);
    expect(
      (await checkout(t, [{ productId: id, variantId: 'tan', quantity }])).status
    ).toBeGreaterThanOrEqual(400);
    expect(stripe.create).not.toHaveBeenCalled();
  });
  it('records a paid snapshot once with shipping details and no CJ fulfillment, even after catalog edits', async () => {
    const t = convexTest(schema, modules);
    const { id, listing } = await fixture(t);
    await checkout(t, [{ productId: id, variantId: 'tan', quantity: 1 }]);
    const metadata = stripe.create.mock.calls[0][0].metadata;
    await t.run((ctx) => ctx.db.patch(listing, { published: false }));
    stripe.event.mockResolvedValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_mock',
          payment_status: 'paid',
          metadata,
          currency: 'usd',
          amount_subtotal: 254900,
          amount_total: 262800,
          shipping_cost: { amount_subtotal: 7900, amount_total: 7900 },
          total_details: { amount_tax: 0 },
          collected_information: {
            shipping_details: {
              address: {
                line1: 'Example address',
                city: 'Rosenberg',
                state: 'TX',
                postal_code: '77469',
                country: 'US',
              },
            },
          },
        },
      },
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await t.fetch('/stripe/webhook', {
            method: 'POST',
            headers: { 'stripe-signature': 'mock' },
            body: '{}',
          })
        ).status
      ).toBe(200);
    const orders = await t.run((ctx) => ctx.db.query('orders').collect());
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      total: 2628,
      shipping: 79,
      status: 'paid',
      shippingAddress: { state: 'TX' },
      items: [{ supplierSku: 'SOF00401401', fulfillmentProvider: 'ashcroft' }],
    });
    expect(orders[0].cjStatus).toBeUndefined();
  });
  it('refuses a paid event with mismatched totals', async () => {
    const t = convexTest(schema, modules);
    const { id } = await fixture(t);
    await checkout(t, [{ productId: id, variantId: 'tan', quantity: 1 }]);
    stripe.event.mockResolvedValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_bad',
          payment_status: 'paid',
          metadata: stripe.create.mock.calls[0][0].metadata,
          currency: 'usd',
          amount_subtotal: 1,
          amount_total: 1,
        },
      },
    });
    expect(
      (
        await t.fetch('/stripe/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': 'mock' },
          body: '{}',
        })
      ).status
    ).toBe(400);
    expect(await t.run((ctx) => ctx.db.query('orders').collect())).toHaveLength(0);
  });
});

// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { cartReview } from './retailLaunch';
import type { QueryCtx } from './_generated/server';
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
  it('uses the imported supplier quantity in storefront and checkout instead of static availability', async () => {
    const t = convexTest(schema, modules);
    const { id } = await fixture(t);
    const feed = { source: 'Daily active inventory attachment', sha256: 'a'.repeat(64), observedAt: Date.now() - 2000,
      rows: [{ sku: 'SOF00401401', quantity: 2 }] };
    await t.mutation(internal.ashcroftInventory.reconcile, feed);
    const page = await t.query(api.retailLaunch.storefrontPage, { paginationOpts: { numItems: 25, cursor: null } });
    expect(page.page[0].inStock).toBe(true);
    await expect(t.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId: id, variantId: 'tan', quantity: 3 }] })).rejects.toThrow();
    await t.mutation(internal.ashcroftInventory.reconcile, { ...feed, sha256: 'b'.repeat(64), observedAt: Date.now() - 1000, rows: [{ sku: 'SOF00401401', quantity: 0 }] });
    const updated = await t.query(api.retailLaunch.storefrontPage, { paginationOpts: { numItems: 25, cursor: null } });
    expect(updated.page[0].inStock).toBe(false);
    await expect(t.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId: id, variantId: 'tan', quantity: 1 }] })).rejects.toThrow();
  });
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
  it('exposes the same minimum and increment enforced by checkout without guessing pack pieces', async () => {
    const t = convexTest(schema, modules);
    const { id, listing } = await fixture(t);
    await t.mutation(internal.ashcroftInventory.reconcile, {
      source: 'Synthetic quantity contract',
      sha256: 'c'.repeat(64),
      observedAt: Date.now() - 1000,
      rows: [{ sku: 'SOF00401401', quantity: 20000 }],
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(listing))!;
      await ctx.db.patch(listing, {
        snapshot: {
          ...row.snapshot,
          variants: row.snapshot.variants.map((v) => ({ ...v, minimum: 3, increment: 2 })),
        },
      });
    });
    const detail = await t.query(api.products.getStorefrontDetail, { id });
    expect(detail?.variants?.[0]).toMatchObject({
      quantityRules: { minimum: 3, increment: 2 },
      priceAdjustment: 0,
    });
    expect(detail?.variants?.[0]).not.toHaveProperty('quantityRules.piecesPerPack');
    await expect(
      t.mutation(internal.retailLaunch.createSnapshot, {
        items: [{ productId: id, variantId: 'tan', quantity: 4 }],
      }),
    ).rejects.toThrow(/quantity/);
    const valid = await t.mutation(internal.retailLaunch.createSnapshot, {
      items: [{ productId: id, variantId: 'tan', quantity: 5 }],
    });
    expect(valid.items[0]).toMatchObject({ quantity: 5, price: detail!.price });
    for (const minimum of [0, 10000]) {
      await t.run(async (ctx) => {
        const row = (await ctx.db.get(listing))!;
        await ctx.db.patch(listing, {
          snapshot: {
            ...row.snapshot,
            variants: row.snapshot.variants.map((v) => ({ ...v, minimum })),
          },
        });
      });
      expect((await t.query(api.products.getStorefrontDetail, { id }))?.inStock).toBe(false);
      expect(
        (await t.query(api.retailLaunch.catalog, { paginationOpts: { cursor: null, numItems: 20 } }))
          .page[0].variants[0].purchasable,
      ).toBe(false);
      await expect(
        t.mutation(internal.retailLaunch.createSnapshot, {
          items: [{ productId: id, variantId: 'tan', quantity: 1 }],
        }),
      ).rejects.toThrow(/quantity/);
      const rejected = await checkout(t, [{ productId: id, variantId: 'tan', quantity: 1 }]);
      expect(rejected.status).toBe(409);
      expect(stripe.create).not.toHaveBeenCalled();
    }
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


describe('current cart review contract', () => {
  it('returns the current quantity cap without private supplier mappings', async () => {
    const t = convexTest(schema, modules); const { id } = await fixture(t);
    const args = { id, variantId: 'tan', quantity: 5, attempt: 0 };
    expect(await t.query(api.retailLaunch.cartReview, args)).toMatchObject({ maximum: 0 });
    await t.mutation(internal.ashcroftInventory.reconcile, { source: 'Synthetic cart stock', sha256: 'd'.repeat(64), observedAt: Date.now()-2000, rows: [{ sku: 'SOF00401401', quantity: 3 }] });
    const review = await t.query(api.retailLaunch.cartReview, args);
    expect(review).toMatchObject({ maximum: 3, quantity: 5, variantId: 'tan', product: { inStock: true } });
    expect(JSON.stringify(review)).not.toMatch(/SOF00401401|supplierSku|fulfillment"|cost"/);
    await t.mutation(internal.ashcroftInventory.reconcile, { source: 'Synthetic refreshed stock', sha256: 'e'.repeat(64), observedAt: Date.now()-1000, rows: [{ sku: 'SOF00401401', quantity: 30 }] });
    expect(await t.query(api.retailLaunch.cartReview, { ...args, attempt: 1 })).toMatchObject({ maximum: 20 });
    expect(await t.query(api.retailLaunch.cartReview, { ...args, variantId: 'retired' })).toMatchObject({ maximum: 0 });
    await expect(t.query(api.retailLaunch.cartReview, { ...args, attempt: -1 })).rejects.toThrow();
  });
  it('reads the source feed once for projection and selected-option quantity', async () => {
    const t = convexTest(schema, modules); const { id } = await fixture(t);
    await t.run(async ctx => {
      const read = vi.spyOn(ctx.db, 'query');
      const handler = (cartReview as unknown as { _handler: (ctx: QueryCtx, args: {id: string; variantId: string; quantity: number; attempt: number}) => Promise<unknown> })._handler;
      try {
        expect(await handler(ctx, { id, variantId: 'tan', quantity: 1, attempt: 0 })).toMatchObject({ maximum: 0, expiresAt: null });
        expect(read.mock.calls.filter(([table]) => table === 'ashcroftInventoryFeeds')).toHaveLength(1);
      } finally { read.mockRestore(); }
    });
  });
  it('keeps fresh inventory usable until its exact expiry and returns the review deadline', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const t = convexTest(schema, modules); const { id } = await fixture(t);
      const observedAt = now - 72 * 3600000 + 1000;
      await t.mutation(internal.ashcroftInventory.reconcile, { source: 'Synthetic expiry', sha256: 'f'.repeat(64), observedAt, rows: [{ sku: 'SOF00401401', quantity: 3 }] });
      const args = { id, variantId: 'tan', quantity: 1, attempt: 0 };
      expect(await t.query(api.retailLaunch.cartReview, args)).toMatchObject({ maximum: 3, expiresAt: now + 1000 });
      vi.setSystemTime(now + 999);
      expect(await t.query(api.retailLaunch.cartReview, { ...args, attempt: 1 })).toMatchObject({ maximum: 3 });
      vi.setSystemTime(now + 1000);
      expect(await t.query(api.retailLaunch.cartReview, { ...args, attempt: 2 })).toMatchObject({ maximum: 0 });
    } finally { vi.useRealTimers(); }
  });
  it.each([{ merchandiseMinor: 254899, deliveryMinor: 7900 }, { merchandiseMinor: 254900, deliveryMinor: 7899 }])('rejects changed reviewed amounts before creating a snapshot or Stripe session', async reviewed => {
    const t = convexTest(schema, modules); const { id } = await fixture(t);
    const r = await t.fetch('/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewVersion: 1, items: [{ productId: id, variantId: 'tan', quantity: 1, reviewed }] }) });
    expect(r.status).toBe(409); expect(await r.json()).toMatchObject({ code: 'PRICE_CHANGED' });
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('retailCheckouts').collect())).toHaveLength(0);
  });
  it('uses matching reviewed amounts but still computes all totals on the server', async () => {
    const t = convexTest(schema, modules); const { id } = await fixture(t);
    const r = await t.fetch('/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewVersion: 1, items: [{ productId: id, variantId: 'tan', quantity: 2, price: 1, reviewed: { merchandiseMinor: 254900, deliveryMinor: 7900, currency: 'USD', ignored: 'not forwarded' } }] }) });
    expect(r.status).toBe(200);
    expect(stripe.create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(254900);
    expect(stripe.create.mock.calls[0][0].shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(15800);
  });
  it('rejects a versioned request with missing reviewed amounts before side effects', async () => {
    const t = convexTest(schema, modules); const { id } = await fixture(t);
    const r = await t.fetch('/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewVersion: 1, items: [{ productId: id, variantId: 'tan', quantity: 1 }] }) });
    expect(r.status).toBe(409); expect(stripe.create).not.toHaveBeenCalled();
  });
});

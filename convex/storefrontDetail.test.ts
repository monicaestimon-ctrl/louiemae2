// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);

it('returns complete public details while excluding supplier and mapping evidence', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('products', {
    name: 'Complete product', description: 'd'.repeat(4000), price: 25, category: 'clothing', collection: 'kids',
    images: Array.from({ length: 30 }, (_, i) => `image-${i}`), inStock: true,
    rawHtmlDescription: 'private supplier evidence', sourceUrl: 'https://private.example',
    variants: Array.from({ length: 150 }, (_, i) => ({ id: `v${i}`, name: `Option ${i}`, priceAdjustment: i,
      inStock: true, cjVariantId: `private-${i}`, cjSku: `private-sku-${i}` })),
  }));
  const detail = await t.query(api.products.getStorefrontDetail, { id });
  expect(detail?.images).toHaveLength(30);
  expect(detail?.variants).toHaveLength(150);
  expect(detail?.description).toHaveLength(4000);
  expect(detail?.variants?.[149]).toEqual({ id: 'v149', name: 'Option 149', priceAdjustment: 149, inStock: true });
  expect(detail).not.toHaveProperty('sourceUrl');
  expect(detail).not.toHaveProperty('rawHtmlDescription');
  const legacy = await t.query(api.products.get, { id });
  expect(legacy?.variants).toHaveLength(100);
  expect(legacy?.images).toHaveLength(24);
  await t.run(ctx => ctx.db.patch(id, { price: 30, variants: [{ id: 'v149', name: 'Changed', priceAdjustment: 2, inStock: false }] }));
  expect(await t.query(api.products.getStorefrontDetail, { id })).toMatchObject({ price: 30, variants: [{ id: 'v149', inStock: false }] });
  await t.run(ctx => ctx.db.patch(id, { storefrontStatus: 'hidden' }));
  expect(await t.query(api.products.getStorefrontDetail, { id })).toBeNull();
  await t.run(ctx => ctx.db.delete(id));
  expect(await t.query(api.products.getStorefrontDetail, { id })).toBeNull();
  expect(await t.query(api.products.getStorefrontDetail, { id: 'retired-static-id' })).toBeNull();
});

it('does not expose products with pending fulfillment or unavailable inventory', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('products', { name: 'Pending', description: '', price: 1,
    images: [], category: 'clothing', collection: 'kids', cjSourcingStatus: 'pending', inStock: true }));
  expect(await t.query(api.products.getStorefrontDetail, { id })).toBeNull();
  await t.run(ctx => ctx.db.patch(id, { cjSourcingStatus: 'none', inStock: false }));
  expect(await t.query(api.products.getStorefrontDetail, { id })).toBeNull();
});

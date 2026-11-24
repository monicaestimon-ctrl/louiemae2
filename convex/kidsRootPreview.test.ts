// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';
import { CATALOG_VERSION } from '../lib/catalogProjection';
import { syncCatalogProduct } from './catalogMaintenance';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const product = { name: 'Cotton dress', price: 32, description: 'Private detail payload',
  images: ['first.jpg', 'second.jpg'], category: 'Dresses', collection: 'kids',
  sourceUrl: 'https://supplier.example/private' };
const state = { version: CATALOG_VERSION, enabled: true, phase: 'verified' as const,
  cursor: null, checked: 0, mismatchIds: [], updatedAt: 1 };

describe('atomic kids root preview', () => {
  it('does not return cards before the current projection is verified and enabled', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
    });
    const blocked = { ready: false, version: CATALOG_VERSION, products: [] };
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual(blocked);
    const id = await t.run(ctx => ctx.db.insert('catalogReadiness', { ...state, version: CATALOG_VERSION - 1 }));
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual(blocked);
    await t.run(ctx => ctx.db.patch(id, { version: CATALOG_VERSION, phase: 'failed' }));
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual(blocked);
    await t.run(ctx => ctx.db.patch(id, { phase: 'verified', enabled: false }));
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual(blocked);
    await t.run(ctx => ctx.db.patch(id, { enabled: true }));
    expect((await t.query(api.catalog.kidsRootPreview, {})).products).toHaveLength(1);
    await t.run(ctx => ctx.db.patch(id, { enabled: false }));
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual(blocked);
  });
  it('distinguishes a verified empty selection from an unavailable catalog', async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert('catalogReadiness', state));
    expect(await t.query(api.catalog.kidsRootPreview, {})).toEqual({ ready: true, version: CATALOG_VERSION, products: [] });
  });
  it('returns only eight visible kids cards in existing order with compact public fields', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert('catalogReadiness', state);
      for (let i = 0; i < 15; i++) {
        const id = await ctx.db.insert('products', { ...product, name: `Dress ${i}`,
          collection: i === 0 ? 'fashion' : 'kids',
          storefrontStatus: i === 1 ? 'hidden' : 'published', inStock: i !== 2,
          variants: Array.from({ length: 150 }, (_, n) => ({ id: `${n}`, name: `Size ${n}`, priceAdjustment: 0, inStock: true })),
        });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
    });
    const result = await t.query(api.catalog.kidsRootPreview, {});
    const existing = await t.query(api.catalog.storefrontPage, { collection: 'kids', paginationOpts: { numItems: 8, cursor: null } });
    expect(result.ready).toBe(true);
    expect(result.products).toHaveLength(8);
    expect(result.products.map(row => row._id)).toEqual(existing.page.map(row => row._id));
    for (const row of result.products) {
      expect(Object.keys(row).sort()).toEqual(['_id', 'name', 'images', 'price', 'category', 'variantCount'].sort());
      expect(row.images).toEqual(['first.jpg']);
      expect(row.variantCount).toBe(150);
      expect(['Dress 0', 'Dress 1', 'Dress 2']).not.toContain(row.name);
    }
  });
  it('reflects price and visibility updates and fails closed on a stale projection row', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      await ctx.db.insert('catalogReadiness', state);
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      return id;
    });
    await t.run(async ctx => {
      await ctx.db.patch(id, { price: 42, isNew: true });
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
    });
    expect((await t.query(api.catalog.kidsRootPreview, {})).products[0]).toMatchObject({ price: 42, isNew: true });
    await t.run(async ctx => {
      const row = await ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', id)).unique();
      await ctx.db.patch(row!._id, { version: CATALOG_VERSION - 1 });
    });
    await expect(t.query(api.catalog.kidsRootPreview, {})).rejects.toThrow('CATALOG_VERSION_MISMATCH');
    await t.run(async ctx => {
      await ctx.db.patch(id, { inStock: false });
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
    });
    expect((await t.query(api.catalog.kidsRootPreview, {})).products).toEqual([]);
  });
});

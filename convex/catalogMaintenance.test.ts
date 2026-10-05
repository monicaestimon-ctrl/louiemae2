// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { syncCatalogProduct } from './catalogMaintenance';
import { sameCatalogValue } from '../lib/catalogProjection';
import { internalMutation } from './functions';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { makeFunctionReference } from 'convex/server';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const product = { name: 'Chair', price: 90, description: 'An oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };

describe('isolated catalog projection maintenance', () => {
  it('creates, updates, hides, and deletes the projection with the authoritative product', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      return id;
    });
    const read = () => t.run(ctx => ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', id)).unique());
    expect(await read()).toMatchObject({ visible: true, publicData: { _id: id, price: 90 } });
    await t.run(async ctx => {
      await ctx.db.patch(id, { price: 105, storefrontStatus: 'hidden' });
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
    });
    expect(await read()).toMatchObject({ visible: false, publicData: { price: 105 } });
    await t.run(async ctx => {
      await ctx.db.delete(id);
      await syncCatalogProduct(ctx, id, null);
    });
    expect(await read()).toBeNull();
  });

  it('rolls back source and summary together on failure', async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(async ctx => {
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(await t.run(ctx => ctx.db.query('products').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });

  it('keeps supplier payloads and mappings out of the public projection', async () => {
    const t = convexTest(schema, modules);
    const stored = await t.run(async ctx => {
      const id = await ctx.db.insert('products', { ...product, rawHtmlDescription: 'x'.repeat(100_000),
        sourceUrl: 'https://supplier.example/private',
        variants: [{ id: 'oak', name: 'Oak', priceAdjustment: 5, inStock: true, cjSku: 'private-sku', cjVariantId: 'private-id' }] });
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      return ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', id)).unique();
    });
    expect(stored?.publicData).not.toHaveProperty('sourceUrl');
    expect(stored?.publicData.variants[0]).not.toHaveProperty('cjSku');
    expect(stored?.adminData.sourceUrl).toBe('https://supplier.example/private');
    expect(JSON.stringify(stored).length).toBeLessThan(5_000);
  });

  it('compares stored objects regardless of property order and omitted undefined values', () => {
    expect(sameCatalogValue({ b: 1, a: { x: 2, absent: undefined } }, { a: { x: 2 }, b: 1 })).toBe(true);
    expect(sameCatalogValue({ rows: [1, 2] }, { rows: [2, 1] })).toBe(false);
  });

  it('stores an explicit excerpt rather than duplicating large descriptions in list rows', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      const id = await ctx.db.insert('products', { ...product, description: 'x'.repeat(800_000) });
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      return id;
    });
    const row = await t.run(ctx => ctx.db.query('productCatalog').first());
    expect(row?.publicData).toMatchObject({ descriptionTruncated: true, descriptionExcerpt: 'x'.repeat(2000) });
    expect(row?.adminData).not.toHaveProperty('description');
    expect(JSON.stringify(row).length).toBeLessThan(15_000);
    expect((await t.run(ctx => ctx.db.get(id)))?.description).toHaveLength(800_000);
  });

  it('the real image caching writer atomically updates the source and summary', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', product));
    await t.mutation(makeFunctionReference<'mutation'>('productImageRecords:patchCachedProductImages'), {
      productId: id, images: ['cached.jpg'], descriptionImages: ['private-description.jpg'],
    });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ images: ['cached.jpg'], descriptionImages: ['private-description.jpg'] });
    const row = await t.run(ctx => ctx.db.query('productCatalog').first());
    expect(row?.publicData.images).toEqual(['cached.jpg']);
    expect(row?.publicData).not.toHaveProperty('descriptionImages');
  });

  it('does not write a summary for telemetry-only product changes', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      await ctx.db.patch(id, { cjLastCheckedAt: new Date().toISOString() });
      const writes: string[] = [];
      const observed = { db: new Proxy(ctx.db, { get(target, key, receiver) {
        if (key === 'replace') writes.push('replace');
        return Reflect.get(target, key, receiver);
      } }) };
      await syncCatalogProduct(observed, id, await ctx.db.get(id));
      expect(writes).toEqual([]);
    });
  });

  it('prototype builder runs maintenance for insert, patch, replace and delete atomically', async () => {
    const t = convexTest(schema, modules);
    const registered = internalMutation({ args: {}, handler: async ctx => {
      const id = await ctx.db.insert('products', product);
      const read = () => ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', id)).unique();
      expect(await read()).toMatchObject({ name: 'Chair', visible: true });
      await ctx.db.patch(id, { inStock: false });
      expect(await read()).toMatchObject({ visible: false });
      await ctx.db.replace(id, { ...product, name: 'Oak chair', price: 110 });
      expect(await read()).toMatchObject({ name: 'Oak chair', visible: true, publicData: { price: 110 } });
      await ctx.db.delete(id);
      expect(await read()).toBeNull();
      return id;
    } });
    const handler = (registered as unknown as { _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<Id<'products'>> })._handler;
    await t.run(ctx => handler(ctx, {}));
  });
});

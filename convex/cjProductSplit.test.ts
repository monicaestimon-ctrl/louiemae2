// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { requireCjAdminIdentity } from './cjAdminAccess';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn() }));

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const append = makeFunctionReference<'mutation'>('cjHelpers:appendCjVariant');
const status = makeFunctionReference<'mutation'>('cjHelpers:updateProductSourcingStatus');
const inventory = makeFunctionReference<'mutation'>('cjHelpers:updateProductInventorySnapshot');
const split = makeFunctionReference<'mutation'>('products:splitCjProduct');
const scoped = { name: 'Pink', price: 90, description: 'Pink dress', images: ['pink.jpg'], category: 'dresses', collection: 'fashion', cjVariantScope: ['pink'], cjVariants: [{ vid: 'pink', sku: 'P', name: 'Pink' }] };

describe('split listing boundaries with transactional catalog maintenance', () => {
  it('ignores catalog and sourcing updates for a different dress', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', scoped));
    await t.mutation(append, { productId, cjVariant: { vid: 'green', sku: 'G', name: 'Green' } });
    await t.mutation(status, { productId, status: 'approved', cjVariantId: 'green' });
    expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject(scoped);
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });

  it('allows updates to a variant still assigned to the listing', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', scoped));
    await t.mutation(append, { productId, cjVariant: { vid: 'pink', sku: 'P', name: 'Pink updated' } });
    expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject({ cjVariants: [{ vid: 'pink', sku: 'P', name: 'Pink updated' }] });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ productId, publicData: { name: 'Pink' } });
  });

  it('discards an inventory poll from before the split and requests a fresh one', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', scoped));
    const checkedAt = new Date().toISOString();
    await t.mutation(inventory, { productId, checkedAt, status: 'in_stock', totalInventoryNum: 100,
      snapshots: [{ vid: 'green', sku: 'G', status: 'in_stock', lowStockThreshold: 5, lastCheckedAt: checkedAt }] });
    expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject({ cjInventoryNextCheckAt: 0, cjVariants: scoped.cjVariants });
    expect(await t.run(ctx => ctx.db.get(productId))).not.toHaveProperty('cjInventoryTotal');
  });

  it('requires CJ admin access before changing products or summaries', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', scoped));
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.mutation(split, { productId, selectedVariantIds: ['pink'], name: 'Pink', expectedRevision: 0 })).rejects.toThrow('Not an admin');
    expect(await t.run(ctx => ctx.db.query('products').collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });

  it('hides exhausted stock atomically and keeps restocked products hidden pending review', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', { ...scoped, storefrontStatus: 'published', inStock: true }));
    const checkedAt = new Date().toISOString();
    await t.mutation(inventory, { productId, checkedAt, status: 'out_of_stock', totalInventoryNum: 0, snapshots: [] });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, publicData: { inStock: false }, adminData: { cjInventoryTotal: 0 } });
    await t.mutation(inventory, { productId, checkedAt, status: 'in_stock', totalInventoryNum: 20, snapshots: [] });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, publicData: { inStock: true }, adminData: { cjInventoryReviewReason: 'restocked' } });
  });
});

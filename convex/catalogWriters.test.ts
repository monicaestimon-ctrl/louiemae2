// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { requireCjAdminIdentity } from './cjAdminAccess';
import type { Id } from './_generated/dataModel';
import { blankCommerceDraft } from '../lib/commerce';

vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const fixture = { name: 'Oak chair', price: 90, description: 'An oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
const update = makeFunctionReference<'mutation'>('products:update');
const remove = makeFunctionReference<'mutation'>('products:remove');
const create = makeFunctionReference<'mutation'>('products:create');
const recover = makeFunctionReference<'mutation'>('productSources:attachRecovered');

describe('authoritative product writers and catalog maintenance', () => {
  it('shared commerce unpublishing hides the authoritative retail product and summary together', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const productId = await ctx.db.insert('products', { ...fixture, storefrontStatus: 'published' });
      const commerceId = await ctx.db.insert('commerceProducts', { provider: 'cj', sourceKey: 'cj:chair', cjProductId: productId, draft: blankCommerceDraft(), revision: 1, updatedAt: 1 });
      return { productId, commerceId };
    });
    await t.mutation(makeFunctionReference<'mutation'>('commerce:unpublish'), { id: ids.commerceId, channel: 'retail' });
    expect(await t.run(ctx => ctx.db.get(ids.productId))).toMatchObject({ storefrontStatus: 'hidden' });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ productId: ids.productId, visible: false });
  });

  it('legacy category assignments keep the projected category in sync', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(async ctx => {
      await ctx.db.insert('siteContent', { navLinks: [], home: {}, story: {}, collections: [{ id: 'furniture', title: 'Furniture', subcategories: [{ id: 'chairs', title: 'Chairs', image: 'chair.jpg' }] }] });
      return ctx.db.insert('products', fixture);
    });
    await t.mutation(makeFunctionReference<'mutation'>('productMigrations:assignLegacyCategories'), { assignments: [{ productId, subcategoryIds: ['chairs'], primarySubcategoryId: 'chairs' }] });
    const product = await t.run(ctx => ctx.db.get(productId));
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ category: product?.category, publicData: { subcategoryIds: ['chairs'], primarySubcategoryId: 'chairs' } });
  });

  it('projects sourcing admission and worker retry state without changing price or stock', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(ctx => ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'pending', inStock: true }));
    const jobId = await t.mutation(makeFunctionReference<'mutation'>('cjSourcingJobs:ensureJobForProduct'), { productId, source: 'import' }) as Id<'cjSourcingJobs'>;
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, adminData: { cjSourcingState: 'needs_input' } });
    await t.run(ctx => ctx.db.patch(jobId, { leaseToken: 'owner', leaseExpiresAt: Date.now() + 60_000 }));
    await t.mutation(makeFunctionReference<'mutation'>('cjSourcingJobs:releaseWorkerForRetry'), { jobId, leaseToken: 'owner', code: 'TRANSIENT', message: 'Provider unavailable', retryAt: Date.now() + 60_000 });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, publicData: { price: 90, inStock: true }, adminData: { cjSourcingState: 'retry_wait' } });
  });

  it('creates a hidden product and its private summary in one transaction', async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(create, { ...fixture, storefrontStatus: 'hidden' });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ productId: id, visible: false, publicData: { name: 'Oak chair' } });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ productRevision: 1 });
  });

  it('source recovery advances the summary revision while keeping supplier evidence private', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => ({
      productId: await ctx.db.insert('products', fixture),
      sourceSnapshotId: await ctx.db.insert('productSourceSnapshots', { sourceKey: 'supplier', schemaVersion: 1, adapterVersion: 1, fetchedAt: 1, contentHash: 'hash', snapshot: { private: 'supplier evidence' }, status: 'complete', warnings: [] }),
    }));
    expect(await t.mutation(recover, { ...ids, expectedRevision: 0 })).toBe('recovered');
    const row = await t.run(ctx => ctx.db.query('productCatalog').first());
    expect(row?.adminData.productRevision).toBe(1);
    expect(JSON.stringify(row)).not.toContain('supplier evidence');
    expect(await t.mutation(recover, { ...ids, expectedRevision: 0 })).toBe('changed');
  });

  it('updates price and stock atomically, rejects stale edits, and removes the summary on deletion', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', fixture));
    await t.mutation(update, { id, expectedRevision: 0, price: 105, inStock: false });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, publicData: { price: 105 }, adminData: { productRevision: 1 } });
    await expect(t.mutation(update, { id, expectedRevision: 0, price: 200 })).rejects.toThrow('PRODUCT_REVISION_CONFLICT');
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ price: 105 });
    expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ publicData: { price: 105 } });
    await t.mutation(remove, { id });
    expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });

  it('does not change either table when product editing authorization fails', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', fixture));
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.mutation(update, { id, price: 1 })).rejects.toThrow('Not an admin');
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ price: 90 });
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });
});

describe('supplier property storage compatibility', () => {
  it.each([
    { label: 'legacy map', value: { Material: 'Oak' } },
    { label: 'Unicode entries', value: [{ key: '材质', value: '白蜡木' }, { key: '尺寸', value: '65厘米' }] },
  ])('creates and edits hidden products with $label without losing evidence', async ({ value }) => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(create, { ...fixture, storefrontStatus: 'hidden', sourceProperties: value }) as Id<'products'>;
    const source = await t.run(ctx => ctx.db.get(id));
    expect(source?.sourceProperties).toEqual(value);
    const updated = [{ key: '材质', value: '白蜡木' }, { key: '尺寸', value: '75厘米' }];
    await t.mutation(update, { id, expectedRevision: source?.productRevision, sourceProperties: updated });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ sourceProperties: updated, price: 90, storefrontStatus: 'hidden' });
    const summary = await t.run(ctx => ctx.db.query('productCatalog').unique());
    expect(summary).toMatchObject({ productId: id, visible: false, publicData: { price: 90 } });
    expect(summary?.publicData).not.toHaveProperty('sourceProperties');
  });
});
// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';
import type { Doc } from './_generated/dataModel';

vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
async function setup(overrides: Partial<Doc<'products'>> = {}) {
  const t = convexTest(schema, modules);
  const id = await t.run(async ctx => {
    await ctx.db.insert('siteContent', { navLinks: [], home: {}, story: {}, collections: [{ id: 'furniture', title: 'Furniture', subcategories: [{ id: 'chairs', title: 'Chairs', image: 'chair.jpg' }] }] });
    return ctx.db.insert('products', { name: 'Oak chair', price: 90, description: 'An oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture', storefrontStatus: 'hidden', productRevision: 2, ...overrides });
  });
  return { t, id };
}

it('publishes and hides the authoritative product and catalog summary together', async () => {
  const { t, id } = await setup();
  await t.mutation(api.products.update, { id, storefrontStatus: 'published' });
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ storefrontStatus: 'published', productRevision: 3 });
  expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: true, publicData: { storefrontStatus: 'published' } });
  await t.mutation(api.products.update, { id, storefrontStatus: 'hidden' });
  expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ visible: false, publicData: { storefrontStatus: 'hidden' } });
});

it('returns an actionable pricing error and leaves the product hidden', async () => {
  const { t, id } = await setup({ cjProductId: 'cj-chair' });
  await expect(t.mutation(api.products.update, { id, storefrontStatus: 'published' })).rejects.toThrow('Refresh CJ prices and shipping before publishing.');
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ storefrontStatus: 'hidden', productRevision: 2 });
});

it('allows hiding and queueing old inventory with a removed category or mismatched source', async () => {
  const { t, id } = await setup({ storefrontStatus: 'published', subcategoryIds: ['removed-category'] });
  const sourceSnapshotId = await t.run(ctx => ctx.db.insert('productSourceSnapshots', { sourceKey: 'old-source', schemaVersion: 1, adapterVersion: 1, fetchedAt: 1, contentHash: 'hash', snapshot: {}, status: 'complete', warnings: [] }));
  await t.run(ctx => ctx.db.patch(id, { sourceSnapshotId }));
  await t.mutation(api.products.update, { id, storefrontStatus: 'hidden' });
  await t.mutation(api.products.update, { id, storefrontStatus: 'next_launch' });
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ storefrontStatus: 'next_launch', subcategoryIds: ['removed-category'] });
  await expect(t.mutation(api.products.update, { id, storefrontStatus: 'published' })).rejects.toThrow();
});

it('bulk launch rejects invalid categories with a product name and preserves queued status', async () => {
  const { t, id } = await setup({ storefrontStatus: 'next_launch', category: 'removed' });
  await expect(t.mutation(api.products.launchNextProducts, {})).rejects.toThrow('Oak chair:');
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ storefrontStatus: 'next_launch', productRevision: 2 });
});

it('bulk launch advances revision so an old editor cannot overwrite the launch', async () => {
  const { t, id } = await setup({ storefrontStatus: 'next_launch' });
  expect(await t.mutation(api.products.launchNextProducts, {})).toMatchObject({ launched: 1 });
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ storefrontStatus: 'published', productRevision: 3, subcategoryIds: ['chairs'] });
  await expect(t.mutation(api.products.update, { id, expectedRevision: 2, storefrontStatus: 'hidden' })).rejects.toThrow('This product changed');
});

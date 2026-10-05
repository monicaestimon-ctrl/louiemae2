// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import type { FunctionReturnType } from 'convex/server';
import schema from './schema';
import { api } from './_generated/api';
import { CATALOG_VERSION } from '../lib/catalogProjection';
import { syncCatalogProduct } from './catalogMaintenance';
import { requireCjAdminIdentity } from './cjAdminAccess';
import type { Doc, Id } from './_generated/dataModel';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const product = { name: 'Chair', price: 90, description: 'Private source description', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
async function seed(values: Array<Partial<Doc<'products'>>>) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const ids: Id<'products'>[] = [];
    for (const value of values) { const id = await ctx.db.insert('products', { ...product, ...value }); await syncCatalogProduct(ctx, id, await ctx.db.get(id)); ids.push(id); }
    await ctx.db.insert('catalogReadiness', { version: CATALOG_VERSION, enabled: true, phase: 'verified', cursor: null, checked: ids.length, mismatchIds: [], updatedAt: 1 });
    return ids;
  });
  return { t, ids };
}

it('provides every picker option beyond 500 and pins off-page selections without full product fields', async () => {
  const { t, ids } = await seed(Array.from({ length: 535 }, (_, i) => ({ name: `Product ${i}`, storefrontStatus: 'hidden' })));
  const found: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const batch: FunctionReturnType<typeof api.catalog.adminOptionsPage> = await t.query(api.catalog.adminOptionsPage, { paginationOpts: { cursor, numItems: 50 } });
    for (const row of batch.page) { expect(Object.keys(row).sort()).toEqual(['id', 'name']); found.push(row.id); }
    if (batch.isDone) break;
    cursor = batch.continueCursor;
  }
  expect(found).toEqual(ids);
  expect(await t.query(api.catalog.adminOption, { id: ids[534] })).toEqual({ id: ids[534], name: 'Product 534' });
  const empty = await t.query(api.catalog.adminOptionsPage, { search: 'Product 534', paginationOpts: { cursor: null, numItems: 50 } });
  expect(empty.page).toEqual([]); expect(empty.isDone).toBe(false);
  expect(await t.query(api.catalog.adminOption, { id: 'old-static-id' })).toBeNull();
  await t.run(async ctx => { await ctx.db.delete(ids[534]); await syncCatalogProduct(ctx, ids[534], null); });
  expect(await t.query(api.catalog.adminOption, { id: ids[534] })).toBeNull();
});

it('requires admin access and verified current-version options', async () => {
  const { t, ids } = await seed([{}]);
  vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
  await expect(t.query(api.catalog.adminOptionsPage, { paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow('Not an admin');
  vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
  await expect(t.query(api.catalog.adminOption, { id: ids[0] })).rejects.toThrow('Not an admin');
  await t.run(async ctx => { const state = (await ctx.db.query('catalogReadiness').first())!; await ctx.db.patch(state._id, { version: CATALOG_VERSION - 1 }); });
  await expect(t.query(api.catalog.adminOption, { id: ids[0] })).rejects.toThrow('NOT_READY');
});

it('orders collection drops by publication date, preserves date ties, and prioritizes legacy featured items', async () => {
  const { t } = await seed([
    { name: 'Old', publishedAt: '2026-09-01T00:00:00Z' },
    { name: 'Newest first', publishedAt: '2026-10-01T00:00:00Z' },
    { name: 'Newest tie', publishedAt: '2026-10-01T00:00:00Z', isNew: true },
    { name: 'Plain' }, { name: 'Featured', isNew: true },
    { name: 'Invalid date', publishedAt: 'invalid' },
    { name: 'Hidden', publishedAt: '2026-10-05T00:00:00Z', storefrontStatus: 'hidden' },
    { name: 'Other collection', collection: 'fashion' },
  ]);
  const result = await t.query(api.catalog.dropPage, { collection: 'furniture', paginationOpts: { cursor: null, numItems: 25 } });
  expect(result.page.map(row => row.name)).toEqual(['Newest first', 'Newest tie', 'Old', 'Featured', 'Plain', 'Invalid date']);
  expect(result.page[0]).not.toHaveProperty('adminSearchText');
});

it('keeps unconfigured public category options reachable through bounded collection pages', async () => {
  const { t } = await seed([{ category: 'legacy chairs' }, { category: 'legacy chairs' }, { category: 'other furniture' },
    { category: 'private category', storefrontStatus: 'hidden' }, { category: 'fashion category', collection: 'fashion' }]);
  const first = await t.query(api.catalog.categoryOptionsPage, { collection: 'furniture', paginationOpts: { cursor: null, numItems: 2 } });
  expect(first.page).toEqual(['legacy chairs']); expect(first.isDone).toBe(false);
  const next = await t.query(api.catalog.categoryOptionsPage, { collection: 'furniture', paginationOpts: { cursor: first.continueCursor, numItems: 2 } });
  expect(next.page).toEqual(['other furniture']); expect(next.isDone).toBe(true);
});

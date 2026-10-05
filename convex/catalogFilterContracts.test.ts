// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';
import { CATALOG_VERSION } from '../lib/catalogProjection';
import { syncCatalogProduct } from './catalogMaintenance';
import type { Doc } from './_generated/dataModel';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const base = { name: 'Chair', price: 90, description: 'Oak', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
async function seed(values: Array<Partial<Doc<'products'>>>) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const ids = [];
    for (const value of values) { const id = await ctx.db.insert('products', { ...base, ...value }); await syncCatalogProduct(ctx, id, await ctx.db.get(id)); ids.push(id); }
    await ctx.db.insert('catalogReadiness', { version: CATALOG_VERSION, enabled: true, phase: 'verified', cursor: null, checked: values.length, mismatchIds: [], updatedAt: 1 });
    return ids;
  });
  return { t, ids };
}
const paginationOpts = { cursor: null, numItems: 25 };

it('sorts public pages by price and featured priority without exposing private search metadata', async () => {
  const { t } = await seed([{ name: 'Middle', price: 20 }, { name: 'Cheap', price: 5, isNew: true }, { name: 'Expensive', price: 99 }, { name: 'Hidden', price: 1, storefrontStatus: 'hidden' }]);
  expect((await t.query(api.catalog.storefrontPage, { paginationOpts, sort: 'price-asc' })).page.map(p => p.name)).toEqual(['Cheap', 'Middle', 'Expensive']);
  expect((await t.query(api.catalog.storefrontPage, { paginationOpts, sort: 'price-desc' })).page.map(p => p.name)).toEqual(['Expensive', 'Middle', 'Cheap']);
  const featured = await t.query(api.catalog.storefrontPage, { paginationOpts, sort: 'featured', collection: 'furniture' });
  expect(featured.page.map(p => p.name)).toEqual(['Cheap', 'Middle', 'Expensive']);
  expect(featured.page[0]).not.toHaveProperty('adminSearchText');
  expect(featured.page[0]).not.toHaveProperty('adminSearchNeedsDetail');
});

it('searches complete admin descriptions/options while bounding oversized-source searches', async () => {
  const { t, ids } = await seed([{ description: 'x'.repeat(20_000) + ' late-description-needle',
    launchAddedAt: '2026-10-01', images: ['', 'one', 'two'],
    variants: Array.from({ length: 150 }, (_, i) => ({ id: `v${i}`, name: `Option ${i}`, inStock: true, priceAdjustment: 0, image: i === 149 ? 'image' : undefined })) },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `Other ${i}` }))]);
  const row = await t.run(ctx => ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', ids[0])).unique());
  expect(row).toMatchObject({ adminSearchText: '', adminSearchNeedsDetail: true });
  const found = await t.query(api.catalog.adminPage, { paginationOpts, adminSearch: 'LATE-description-needle' });
  expect(found.page).toHaveLength(1);
  expect(found.isDone).toBe(false);
  expect(found.page[0]).toMatchObject({ launchAddedAt: '2026-10-01', imageCount: 2, variantCount: 150, variantImageCount: 1 });
  expect(found.page[0]).not.toHaveProperty('adminSearchText');
  expect((await t.query(api.catalog.adminPage, { paginationOpts, adminSearch: 'option 149' })).page).toHaveLength(1);
  expect((await t.query(api.catalog.adminPage, { paginationOpts, connectionState: 'not_linked' })).page).toHaveLength(9);
  expect((await t.query(api.catalog.adminPage, { paginationOpts, connectionState: 'ready' })).page).toHaveLength(0);
});

it('preserves strict arrival windows, legacy isNew fallback and newest-first dated order', async () => {
  const { t } = await seed([{ name: 'Boundary', publishedAt: '2026-10-01T00:00:00Z', isNew: true },
    { name: 'Newer', publishedAt: '2026-10-03T00:00:00Z' }, { name: 'Newest', publishedAt: '2026-10-04T00:00:00Z' },
    { name: 'Legacy', isNew: true }, { name: 'Invalid', publishedAt: 'bad-date', isNew: true }, { name: 'Plain' }]);
  const args = { collection: 'furniture', since: Date.parse('2026-10-01T00:00:00Z'), paginationOpts };
  expect((await t.query(api.catalog.arrivalsPage, { ...args, kind: 'dated' })).page.map(p => p.name)).toEqual(['Newest', 'Newer']);
  expect((await t.query(api.catalog.arrivalsPage, { ...args, kind: 'legacy' })).page.map(p => p.name)).toEqual(['Legacy']);
});

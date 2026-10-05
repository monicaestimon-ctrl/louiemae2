// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReturnType } from 'convex/server';
import { api } from './_generated/api';
import schema from './schema';
import { CATALOG_VERSION } from '../lib/catalogProjection';
import { syncCatalogProduct } from './catalogMaintenance';
import { requireCjAdminIdentity } from './cjAdminAccess';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const publicPage = makeFunctionReference<'query'>('catalog:storefrontPage');
const adminPage = makeFunctionReference<'query'>('catalog:adminPage');
const variantPage = makeFunctionReference<'query'>('catalog:variantQueuePage');
const sourcingPage = makeFunctionReference<'query'>('catalog:sourcingPage');
const approvalsPage = makeFunctionReference<'query'>('catalog:recentApprovalsPage');
const update = makeFunctionReference<'mutation'>('products:update');
const product = { name: 'Chair', price: 90, description: 'Oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture', sourceUrl: 'https://supplier.example/private', rawHtmlDescription: 'private payload' };
async function ready(t: ReturnType<typeof convexTest>) {
  await t.run(ctx => ctx.db.insert('catalogReadiness', { version: CATALOG_VERSION, enabled: true, phase: 'verified', cursor: null, checked: 0, mismatchIds: [], updatedAt: 1 }));
}
describe('bounded catalog pages', () => {
  it('keeps all pending sourcing products reachable and applies approval cutoffs in index order', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 515; i++) {
        const id = await ctx.db.insert('products', { ...product, name: `Pending ${i}`, cjSourcingStatus: 'pending' });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
      for (const [name, date] of [['Old', '2026-09-01T00:00:00.000Z'], ['First recent', '2026-10-01T00:00:00.000Z'], ['Latest', '2026-10-04T00:00:00.000Z']]) {
        const id = await ctx.db.insert('products', { ...product, name, cjSourcingStatus: 'approved', cjApprovedAt: date });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
      const rejected = await ctx.db.insert('products', { ...product, cjSourcingStatus: 'rejected', cjSourcingError: 'Provider rejected' });
      await syncCatalogProduct(ctx, rejected, await ctx.db.get(rejected));
    });
    await expect(t.query(sourcingPage, { status: 'pending', paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow('CATALOG_NOT_READY');
    await ready(t);
    const ids = new Set<string>();
    let cursor: string | null = null;
    let done = false;
    while (!done) {
      const page: FunctionReturnType<typeof api.catalog.sourcingPage> = await t.query(sourcingPage, { status: 'pending', paginationOpts: { cursor, numItems: 25 } });
      expect(page.page.length).toBeLessThanOrEqual(25);
      for (const row of page.page) {
        expect(ids.has(row._id)).toBe(false); ids.add(row._id);
        expect(row).not.toHaveProperty('rawHtmlDescription');
        expect(row).not.toHaveProperty('variants');
      }
      cursor = page.continueCursor; done = page.isDone;
    }
    expect(ids.size).toBe(515);
    const recent = await t.query(approvalsPage, { since: '2026-10-01T00:00:00.000Z', paginationOpts: { cursor: null, numItems: 1 } });
    expect(recent.page.map((row: { name: string }) => row.name)).toEqual(['Latest']);
    const next = await t.query(approvalsPage, { since: '2026-10-01T00:00:00.000Z', paginationOpts: { cursor: recent.continueCursor, numItems: 25 } });
    expect(next.page.map((row: { name: string }) => row.name)).toEqual(['First recent']);
    expect(next.isDone).toBe(true);
    expect((await t.query(sourcingPage, { status: 'rejected', paginationOpts: { cursor: null, numItems: 25 } })).page[0].cjSourcingError).toBe('Provider rejected');
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(approvalsPage, { since: '', paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow('Not an admin');
  });
  it('pages the complete variant queue in legacy priority order without supplier payloads', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 535; i++) {
        const id = await ctx.db.insert('products', { ...product, name: `Queue ${i}`,
          cjSourcingStatus: 'pending', variants: Array.from({ length: i % 3 }, (_, n) => ({ id: `${n}`, name: `Option ${n}`, priceAdjustment: 0, inStock: true })) });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
      const excluded = await ctx.db.insert('products', { ...product, cjSourcingState: 'queued' });
      await syncCatalogProduct(ctx, excluded, await ctx.db.get(excluded));
    });
    await ready(t);
    const seen = new Set<string>();
    let cursor: string | null = null;
    let previousUnmapped = Infinity;
    let done = false;
    while (!done) {
      const batch: FunctionReturnType<typeof api.catalog.variantQueuePage> = await t.query(variantPage, { filter: 'all', paginationOpts: { cursor, numItems: 25 } });
      expect(batch.page.length).toBeLessThanOrEqual(25);
      for (const row of batch.page) {
        expect(seen.has(row._id)).toBe(false);
        seen.add(row._id);
        expect(row.mappingSummary.unmappedVariantCount).toBeLessThanOrEqual(previousUnmapped);
        previousUnmapped = row.mappingSummary.unmappedVariantCount;
        expect(row).not.toHaveProperty('rawHtmlDescription');
        expect(row).not.toHaveProperty('variants');
        expect(row).not.toHaveProperty('queueSearchValues');
      }
      cursor = batch.continueCursor; done = batch.isDone;
    }
    expect(seen.size).toBe(535);
  });
  it('searches options beyond display limits and preserves empty-page continuation and authorization', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (const name of ['First', 'Second']) {
        const id = await ctx.db.insert('products', { ...product, name, cjSourcingStatus: 'pending',
          variants: Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, priceAdjustment: 0, inStock: true, name: name === 'Second' && i === 149 ? 'Rare Needle' : `Option ${i}` })) });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
    });
    const args = { filter: 'awaiting_approval', search: ' RARE needle ', paginationOpts: { cursor: null, numItems: 1 } };
    await expect(t.query(variantPage, args)).rejects.toThrow('CATALOG_NOT_READY');
    await ready(t);
    const first = await t.query(variantPage, args);
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const next = await t.query(variantPage, { ...args, paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect(next.page.map((row: { name: string }) => row.name)).toEqual(['Second']);
    expect(next.page[0].mappingSummary.customerVariantCount).toBe(150);
    expect((await t.query(variantPage, { ...args, search: 'second https', paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([]);
    expect((await t.query(variantPage, { ...args, search: '', filter: 'ready' })).page).toEqual([]);
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(variantPage, args)).rejects.toThrow('Not an admin');
  });
  it('keeps every public product reachable beyond 500 and excludes hidden/private data', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 570; i++) {
        const id = await ctx.db.insert('products', { ...product, name: `Chair ${i}`, storefrontStatus: i % 10 === 0 ? 'hidden' : 'published' });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
    });
    await ready(t);
    const ids = new Set<string>();
    let cursor: string | null = null;
    let done = false;
    while (!done) {
      const batch: { page: Array<{ _id: string; storefrontStatus?: string }>; continueCursor: string; isDone: boolean } = await t.query(publicPage, { paginationOpts: { cursor, numItems: 25 } });
      expect(batch.page.length).toBeLessThanOrEqual(25);
      for (const row of batch.page) {
        expect(row).not.toHaveProperty('sourceUrl');
        expect(row).not.toHaveProperty('rawHtmlDescription');
        expect(row.storefrontStatus).toBe('published');
        expect(ids.has(row._id)).toBe(false);
        ids.add(row._id);
      }
      cursor = batch.continueCursor; done = batch.isDone;
    }
    expect(ids.size).toBe(513);
    const admin = await t.query(adminPage, { paginationOpts: { cursor: null, numItems: 1000 } });
    expect(admin.page).toHaveLength(50);
    expect(admin.page[0].sourceUrl).toBe(product.sourceUrl);
    expect(admin.page[0]).not.toHaveProperty('rawHtmlDescription');
  });
  it('preserves continuation through empty filtered pages and collection/ordering semantics', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (const [name, category, collection] of [['First', 'chairs', 'furniture'], ['Needle table', 'tables', 'furniture'], ['Other', 'tables', 'fashion']]) {
        const id = await ctx.db.insert('products', { ...product, name, category, collection, description: name });
        await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      }
    });
    await ready(t);
    const args = { collection: 'furniture', category: 'tables', search: 'needle' };
    const first = await t.query(publicPage, { ...args, paginationOpts: { cursor: null, numItems: 1 } });
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const next = await t.query(publicPage, { ...args, paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect(next.page.map((row: { name: string }) => row.name)).toEqual(['Needle table']);
    const reverse = await t.query(publicPage, { collection: 'furniture', order: 'desc', paginationOpts: { cursor: null, numItems: 25 } });
    expect(reverse.page.map((row: { name: string }) => row.name)).toEqual(['Needle table', 'First']);
  });
  it('reflects atomic price and stock changes and removes hidden products immediately', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      const id = await ctx.db.insert('products', product);
      await syncCatalogProduct(ctx, id, await ctx.db.get(id));
      return id;
    });
    await ready(t);
    const args = { paginationOpts: { cursor: null, numItems: 25 } };
    await t.mutation(update, { id, expectedRevision: 0, price: 110 });
    expect((await t.query(publicPage, args)).page[0].price).toBe(110);
    await t.mutation(update, { id, expectedRevision: 1, inStock: false });
    expect((await t.query(publicPage, args)).page).toEqual([]);
    expect((await t.query(adminPage, args)).page[0]).toMatchObject({ price: 110, inStock: false, productRevision: 2 });
  });
  it('fails closed before readiness and checks admin authorization', async () => {
    const t = convexTest(schema, modules);
    const args = { paginationOpts: { cursor: null, numItems: 25 } };
    await expect(t.query(publicPage, args)).rejects.toThrow('CATALOG_NOT_READY');
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(adminPage, args)).rejects.toThrow('Not an admin');
    await ready(t);
    await expect(t.query(publicPage, { paginationOpts: { cursor: null, numItems: 0 } })).rejects.toThrow('positive');
  });
});

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
import type { Id } from './_generated/dataModel';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const product = { name: 'Chair', price: 90, description: 'private long source', images: ['chair.jpg'], category: 'chairs', collection: 'furniture', sourceUrl: 'https://supplier.example/item' };
async function seed(count = 130) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const productId = await ctx.db.insert('products', product);
    await syncCatalogProduct(ctx, productId, await ctx.db.get(productId));
    await ctx.db.insert('catalogReadiness', { version: CATALOG_VERSION, enabled: true, phase: 'verified', cursor: null, checked: 1, mismatchIds: [], updatedAt: 1 });
    const jobs: Id<'cjSourcingJobs'>[] = [];
    for (let i = 0; i < count; i++) jobs.push(await ctx.db.insert('cjSourcingJobs', {
      productId, state: 'queued', generation: 1, sourceSnapshot: { productName: 'private snapshot', productUrl: 'https://supplier.example', remark: 'private evidence' },
      sourceSnapshotHash: 'private-hash', attemptCount: 1, transientFailureCount: 0,
      leaseToken: 'private-lease', createdAt: i, updatedAt: i, version: 1,
    }));
    return { productId, jobs };
  });
  return { t, ...ids };
}

it('reaches jobs beyond the legacy cap in bounded newest-first pages with legacy row parity', async () => {
  const { t, jobs } = await seed();
  const legacy = await t.query(api.cjSourcingJobs.getAdminOperations, { limit: 100 });
  expect(legacy.jobs).toHaveLength(100);
  let cursor: string | null = null;
  const rows: FunctionReturnType<typeof api.cjSourcingJobs.adminJobsPage>['page'] = [];
  for (let i = 0; i < 30; i++) {
    const batch: FunctionReturnType<typeof api.cjSourcingJobs.adminJobsPage> = await t.query(api.cjSourcingJobs.adminJobsPage, { paginationOpts: { cursor, numItems: 100 } });
    expect(batch.page.length).toBeLessThanOrEqual(5);
    rows.push(...batch.page);
    if (batch.isDone) break;
    cursor = batch.continueCursor;
  }
  expect(rows.map(row => row.id)).toEqual([...jobs].reverse());
  expect(rows.slice(0, 100)).toEqual(legacy.jobs.map(({ activeAttempt: _attempt, ...row }) => row));
  expect(rows[0]).toMatchObject({ productName: 'Chair', sourceUrl: product.sourceUrl });
  for (const key of ['leaseToken', 'sourceSnapshot', 'sourceSnapshotHash', 'description', 'activeAttempt']) expect(rows[0]).not.toHaveProperty(key);
});

it('keeps summary-only operations independent of job hydration and requires readiness/auth for pages', async () => {
  const { t } = await seed(1);
  await t.run(async ctx => { const row = (await ctx.db.query('productCatalog').first())!; await ctx.db.patch(row._id, { version: -1 }); });
  expect((await t.query(api.cjSourcingJobs.getAdminOperations, { includeJobs: false })).jobs).toEqual([]);
  await expect(t.query(api.cjSourcingJobs.getAdminOperations, {})).rejects.toThrow('VERSION_MISMATCH');
  await t.run(async ctx => { const state = (await ctx.db.query('catalogReadiness').first())!; await ctx.db.patch(state._id, { enabled: false }); });
  await expect(t.query(api.cjSourcingJobs.adminJobsPage, { paginationOpts: { cursor: null, numItems: 5 } })).rejects.toThrow('NOT_READY');
  vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
  await expect(t.query(api.cjSourcingJobs.adminJobsPage, { paginationOpts: { cursor: null, numItems: 5 } })).rejects.toThrow('Not an admin');
});

it('preserves deleted-product history without falling back to full source records', async () => {
  const { t, productId } = await seed(1);
  await t.run(async ctx => { await ctx.db.delete(productId); await syncCatalogProduct(ctx, productId, null); });
  const page = await t.query(api.cjSourcingJobs.adminJobsPage, { paginationOpts: { cursor: null, numItems: 5 } });
  expect(page.page[0]).toMatchObject({ productId, productName: 'Deleted product' });
});

// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import type { Id } from './_generated/dataModel';
import { syncCatalogProduct } from './catalogMaintenance';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const backfill = makeFunctionReference<'mutation'>('catalogMigration:backfill');
const verify = makeFunctionReference<'query'>('catalogMigration:verifyPage');
const orphans = makeFunctionReference<'query'>('catalogMigration:verifyOrphans');
const fixture = { name: 'Chair', price: 90, description: 'Oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };

describe('catalog migration', () => {
  it('resumes beyond 500 records, tolerates retried batches, and preserves a concurrent edit', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const ids: Id<'products'>[] = [];
      for (let i = 0; i < 535; i++) ids.push(await ctx.db.insert('products', { ...fixture, name: `Chair ${i}`, rawHtmlDescription: 'x'.repeat(30_000) }));
      return ids;
    });
    let state = await t.mutation(backfill, { expectedCursor: null, limit: 25 });
    expect(state.processed).toBe(5);
    const duplicate = await t.mutation(backfill, { expectedCursor: null, limit: 25 });
    expect(duplicate.advanced).toBe(false);
    expect(duplicate.processed).toBe(5);
    await t.run(async ctx => {
      await ctx.db.patch(ids[0], { price: 105, storefrontStatus: 'hidden' });
      await syncCatalogProduct(ctx, ids[0], await ctx.db.get(ids[0]));
    });
    for (let attempts = 0; !state.complete && attempts < 120; attempts++) {
      const next = await t.mutation(backfill, { expectedCursor: state.cursor, limit: 25 });
      expect(next.processed - state.processed).toBeLessThanOrEqual(5);
      state = next;
    }
    expect(state.complete).toBe(true);
    expect(state.processed).toBe(535);
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toHaveLength(535);
    const changed = await t.run(ctx => ctx.db.query('productCatalog').withIndex('by_product', q => q.eq('productId', ids[0])).unique());
    expect(changed).toMatchObject({ visible: false, publicData: { price: 105 } });
    expect(await t.mutation(backfill, { expectedCursor: state.cursor })).toMatchObject({ advanced: false, processed: 535 });
  });

  it('reports missing, changed, and orphan summaries without repairing or deleting them', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', fixture));
    expect(await t.query(verify, { cursor: null })).toMatchObject({ mismatches: [id] });
    await t.mutation(backfill, { expectedCursor: null });
    expect(await t.query(verify, { cursor: null })).toMatchObject({ mismatches: [] });
    await t.run(ctx => ctx.db.patch(id, { price: 100 }));
    expect(await t.query(verify, { cursor: null })).toMatchObject({ mismatches: [id] });
    await t.run(ctx => ctx.db.delete(id));
    expect(await t.query(orphans, { cursor: null })).toMatchObject({ orphanIds: [id] });
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toHaveLength(1);
  });
});

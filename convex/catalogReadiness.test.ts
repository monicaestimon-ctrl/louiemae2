// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { CATALOG_VERSION } from '../lib/catalogProjection';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ref = (name: string) => makeFunctionReference<'mutation'>(`catalogReadiness:${name}`);
const status = makeFunctionReference<'query'>('catalogReadiness:status');
const backfill = makeFunctionReference<'mutation'>('catalogMigration:backfill');
const product = { name: 'Chair', price: 90, description: 'Oak chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
async function fill(t: ReturnType<typeof convexTest>) {
  let state = await t.mutation(backfill, { expectedCursor: null });
  while (!state.complete) state = await t.mutation(backfill, { expectedCursor: state.cursor });
}
async function verify(t: ReturnType<typeof convexTest>) {
  let state = await t.mutation(ref('begin'), {});
  while (state.phase === 'source' || state.phase === 'orphans') state = await t.mutation(ref('verifyNext'), { expectedPhase: state.phase, expectedCursor: state.cursor });
  return state;
}
describe('catalog reader readiness', () => {
  it('requires a complete backfill, two complete verification passes, and explicit enablement', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(status, {})).toEqual({ ready: false, version: CATALOG_VERSION });
    await expect(t.mutation(ref('begin'), {})).rejects.toThrow('backfill');
    await expect(t.mutation(ref('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    await t.run(async ctx => { for (let i = 0; i < 535; i++) await ctx.db.insert('products', { ...product, name: `Chair ${i}` }); });
    await fill(t);
    await t.mutation(ref('begin'), {});
    const first = await t.mutation(ref('verifyNext'), { expectedPhase: 'source', expectedCursor: null });
    expect(first.checked).toBe(5);
    expect(await t.mutation(ref('verifyNext'), { expectedPhase: 'source', expectedCursor: null })).toMatchObject({ advanced: false, checked: 5 });
    await expect(t.mutation(ref('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    const verified = await verify(t);
    expect(verified).toMatchObject({ phase: 'verified', checked: 1070, enabled: false });
    expect(await t.query(status, {})).toMatchObject({ ready: false });
    await t.mutation(ref('setEnabled'), { enabled: true });
    expect(await t.query(status, {})).toMatchObject({ ready: true });
    await t.mutation(ref('setEnabled'), { enabled: false });
    expect(await t.query(status, {})).toMatchObject({ ready: false });
  }, 30_000);
  it('detects drift and orphans, repairs exact IDs, and requires verification again', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', product));
    await fill(t);
    await verify(t);
    await t.mutation(ref('setEnabled'), { enabled: true });
    // Simulate a dashboard edit that bypasses application writers.
    await t.run(ctx => ctx.db.patch(id, { price: 100 }));
    expect(await verify(t)).toMatchObject({ phase: 'failed', mismatchIds: [id] });
    expect(await t.query(status, {})).toMatchObject({ ready: false });
    await t.mutation(ref('repair'), { productIds: [id] });
    await expect(t.mutation(ref('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    expect(await verify(t)).toMatchObject({ phase: 'verified' });
    await t.run(ctx => ctx.db.delete(id));
    expect(await verify(t)).toMatchObject({ phase: 'failed', mismatchIds: [id] });
    await t.mutation(ref('repair'), { productIds: [id] });
    expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
    expect(await verify(t)).toMatchObject({ phase: 'verified' });
    await expect(t.mutation(ref('repair'), { productIds: [id, id] })).rejects.toThrow('distinct');
  });
});

// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { syncProductHealth } from './productHealthMaintenance';
import { productHealthProblems, productHealthProjection, healthDetails } from '../lib/productHealth';
import { requireCjAdminIdentity } from './cjAdminAccess';
import type { Doc } from './_generated/dataModel';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const mutation = (name: string) => makeFunctionReference<'mutation'>(`productHealth:${name}`);
const status = makeFunctionReference<'query'>('productHealth:status');
const issues = makeFunctionReference<'query'>('productHealth:issuesPage');
const fixture = { name: 'Oak chair', price: 90, description: 'Chair', images: ['chair.jpg'], category: 'chairs', collection: 'furniture' };
afterEach(() => { vi.useRealTimers(); });
async function finish(t: ReturnType<typeof convexTest>, state: Pick<Doc<'productHealthState'>, 'epoch' | 'phase' | 'cursor'>) {
  for (let i = 0; !['ready', 'failed'].includes(state.phase) && i < 400; i++) state = await t.mutation(mutation('rebuildNext'), { epoch: state.epoch, expectedPhase: state.phase, expectedCursor: state.cursor });
  return state;
}
describe('incremental product health', () => {
  it('preserves image, sourcing-age, and variant rules without storing changing hour strings', () => {
    const now = Date.parse('2026-10-05T00:00:00Z');
    const base = { ...fixture, _id: 'id', _creationTime: 1 } as Doc<'products'>;
    expect(productHealthProblems(base, now)).toEqual([]);
    expect(productHealthProblems({ ...base, images: [] }, now)).toEqual(['No images']);
    expect(productHealthProblems({ ...base, images: ['//cbu01.alicdn.com/photo-1612196808214'] }, now)).toEqual([
      'Protocol-relative image URL (missing https:)', 'Image hosted on 1688/AliExpress CDN (may expire)', 'Known broken Unsplash URL',
    ]);
    const pending = { ...base, cjSourcingStatus: 'pending' as const, cjSubmittedAt: new Date(now - 48 * 3_600_000).toISOString() };
    expect(productHealthProblems(pending, now).some(p => p.startsWith('Stuck pending'))).toBe(false);
    expect(productHealthProblems(pending, now + 1)).toContain('Stuck pending for 48h');
    expect(productHealthProblems({ ...pending, cjSubmittedAt: 'invalid' }, now).some(p => p.startsWith('Stuck pending'))).toBe(false);
    const projection = productHealthProjection(pending, now + 1);
    expect(projection.details.problems).toContain('Stuck pending');
    expect(healthDetails(projection, now + 2 * 3_600_000).problems).toContain('Stuck pending for 50h');
    const approved = { ...base, cjSourcingStatus: 'approved' as const, variants: [{ id: 'oak', name: 'Oak', inStock: true, priceAdjustment: 0 }] };
    const problems = productHealthProblems(approved, now);
    expect(problems).toContain('Approved but missing cjProductId');
    expect(problems).toContain("Approved but no CJ variants (won't appear in Variant Mapping)");
    expect(problems).toContain('1/1 customer variants not linked to CJ');
    expect(new Set(problems).size).toBe(problems.length);
  });
  it('rebuilds more than 500 sources without double-counting concurrent changes or stale retries', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const ids = [];
      for (let i = 0; i < 535; i++) ids.push(await ctx.db.insert('products', { ...fixture, images: i % 2 ? [] : fixture.images }));
      return ids;
    });
    const initial = await t.mutation(mutation('startRebuild'), {});
    let state = await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: 'backfill', expectedCursor: null });
    expect(state.total).toBe(5);
    expect(await t.mutation(mutation('rebuildNext'), { epoch: initial.epoch, expectedPhase: 'backfill', expectedCursor: null })).toMatchObject({ advanced: false, total: 5 });
    await t.mutation(makeFunctionReference<'mutation'>('products:update'), { id: ids[1], expectedRevision: 0, images: ['fixed.jpg'] });
    state = await finish(t, state);
    expect(state).toMatchObject({ phase: 'ready', total: 535, issues: 266, enabled: false });
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect(await t.query(status, {})).toMatchObject({ ready: true, totalProducts: 535, productsWithIssues: 266 });
    await t.mutation(makeFunctionReference<'mutation'>('products:remove'), { id: ids[3] });
    expect(await t.query(status, {})).toMatchObject({ totalProducts: 534, productsWithIssues: 265 });
    // Restarting after a counter drift repairs totals rather than incrementing old totals.
    await t.run(async ctx => { const state = (await ctx.db.query('productHealthState').first())!; await ctx.db.patch(state._id, { total: 999 }); });
    state = await finish(t, await t.mutation(mutation('startRebuild'), {}));
    expect(state).toMatchObject({ phase: 'ready', total: 534, issues: 265 });
  }, 30_000);
  it('refreshes time-driven pending issues from the due index in bounded batches', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-10-05T00:00:00Z'); vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    await t.run(async ctx => { for (let i = 0; i < 57; i++) await ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'pending', cjSourcingId: `source-${i}`, cjSubmittedAt: new Date(now - 47 * 3_600_000).toISOString() }); });
    await finish(t, await t.mutation(mutation('startRebuild'), {}));
    await t.mutation(mutation('setEnabled'), { enabled: true });
    vi.setSystemTime(now + 2 * 3_600_000);
    expect(await t.mutation(mutation('refreshDue'), {})).toMatchObject({ refreshed: 50 });
    expect(await t.mutation(mutation('refreshDue'), {})).toMatchObject({ refreshed: 7 });
    expect(await t.mutation(mutation('refreshDue'), {})).toMatchObject({ refreshed: 0 });
    const rows = await t.query(issues, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(rows.page).toHaveLength(25);
    expect(rows.page.every((row: { problems: string[] }) => row.problems.includes('Stuck pending for 49h'))).toBe(true);
    await t.mutation(mutation('verifyAgain'), {});
    expect(await finish(t, (await t.run(ctx => ctx.db.query('productHealthState').first()))!)).toMatchObject({ phase: 'ready' });
  });
  it('rolls counters and projections back atomically and preserves no-op revisions', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(mutation('startRebuild'), {});
    const id = await t.run(async ctx => { const id = await ctx.db.insert('products', fixture); await syncProductHealth(ctx, id, await ctx.db.get(id)); return id; });
    const before = await t.run(ctx => ctx.db.query('productHealthState').first());
    await t.run(async ctx => { await syncProductHealth(ctx, id, await ctx.db.get(id)); });
    expect(await t.run(ctx => ctx.db.query('productHealthState').first())).toEqual(before);
    await expect(t.run(async ctx => { await ctx.db.patch(id, { images: [] }); await syncProductHealth(ctx, id, await ctx.db.get(id)); throw new Error('abort'); })).rejects.toThrow('abort');
    expect(await t.run(ctx => ctx.db.query('productHealthState').first())).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('productHealth').first())).toMatchObject({ hasIssues: false });
  });
  it('rejects incomplete activation, private reads and source drift', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    const id = await t.run(ctx => ctx.db.insert('products', fixture));
    const state = await finish(t, await t.mutation(mutation('startRebuild'), {}));
    expect(state.phase).toBe('ready');
    await t.run(ctx => ctx.db.patch(id, { images: [] }));
    await t.mutation(mutation('verifyAgain'), {});
    const verifyState = await t.run(ctx => ctx.db.query('productHealthState').first());
    expect(await finish(t, verifyState!)).toMatchObject({ phase: 'failed', mismatchIds: expect.arrayContaining([id]) });
    await expect(t.mutation(mutation('setEnabled'), { enabled: true })).rejects.toThrow('Verify');
    await expect(t.query(issues, { paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow('NOT_READY');
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(status, {})).rejects.toThrow('Not an admin');
  });
  it('keeps the diagnostic-candidate count exact and restarts verification after a live change', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('products', { ...fixture, cjSourcingStatus: 'approved', cjProductId: 'cj', variants: [{ id: 'oak', name: 'Oak', inStock: true, priceAdjustment: 0 }] }));
    await finish(t, await t.mutation(mutation('startRebuild'), {}));
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect(await t.query(status, {})).toMatchObject({ productsMissingCjVariants: 1 });
    await t.mutation(mutation('verifyAgain'), {});
    await t.run(async ctx => { await ctx.db.patch(id, { cjVariants: [{ vid: 'oak', name: 'Oak', sku: 'OAK' }] }); await syncProductHealth(ctx, id, await ctx.db.get(id)); });
    const current = (await t.run(ctx => ctx.db.query('productHealthState').first()))!;
    expect(await t.mutation(mutation('rebuildNext'), { epoch: current.epoch, expectedPhase: 'verify', expectedCursor: null })).toMatchObject({ advanced: false, verificationRestarted: true });
    await finish(t, (await t.run(ctx => ctx.db.query('productHealthState').first()))!);
    await t.mutation(mutation('setEnabled'), { enabled: true });
    expect(await t.query(status, {})).toMatchObject({ productsMissingCjVariants: 0 });
  });
});

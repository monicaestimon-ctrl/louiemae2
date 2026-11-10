// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { ashcroftAvailable } from './ashcroftInventory';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const args = () => ({ source: 'Ashc.xlsx; active-only export', sha256: 'a'.repeat(64), observedAt: Date.now() - 1000,
  rows: [{ sku: 'SOF00401401', quantity: 2 }, { sku: 'ZERO', quantity: 0 }, { sku: 'DTB04601603', quantity: 3 }] });

describe('Ashcroft daily attachment reconciliation', () => {
  it('enforces quantities and missing SKUs, and replaces the old static sold-out list', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ashcroftInventory.reconcile, args());
    await t.run(async ctx => {
      expect(await ashcroftAvailable(ctx, 'SOF00401401', '', 2)).toBe(true);
      expect(await ashcroftAvailable(ctx, 'SOF00401401', '', 3)).toBe(false);
      expect(await ashcroftAvailable(ctx, 'ZERO')).toBe(false);
      expect(await ashcroftAvailable(ctx, 'MISSING')).toBe(false);
      expect(await ashcroftAvailable(ctx, 'DTB04601603')).toBe(true);
    });
  });
  it('rejects conflicting, older, duplicate-SKU and invalid quantity inputs', async () => {
    const t = convexTest(schema, modules); const a = args();
    await t.mutation(internal.ashcroftInventory.reconcile, a);
    expect((await t.mutation(internal.ashcroftInventory.reconcile, a)).duplicate).toBe(true);
    await expect(t.mutation(internal.ashcroftInventory.reconcile, { ...a, sha256: 'b'.repeat(64) })).rejects.toThrow('conflicting');
    await expect(t.mutation(internal.ashcroftInventory.reconcile, { ...a, rows: [a.rows[0], a.rows[0]] })).rejects.toThrow('duplicate');
    await expect(t.mutation(internal.ashcroftInventory.reconcile, { ...a, rows: [{ sku: 'BAD', quantity: -1 }] })).rejects.toThrow('Invalid');
  });
  it('fails closed after the feed expires without deleting listings or inventory history', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ashcroftInventory.reconcile, args());
    await t.run(async ctx => {
      const feed = await ctx.db.query('ashcroftInventoryFeeds').first();
      await ctx.db.patch(feed!._id, { validUntil: Date.now() - 1 });
      expect(await ashcroftAvailable(ctx, 'SOF00401401')).toBe(false);
      expect(await ctx.db.query('ashcroftInventoryFeeds').collect()).toHaveLength(1);
    });
  });
});

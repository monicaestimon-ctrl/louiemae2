// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import type { PaginationResult } from 'convex/server';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { api } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
beforeEach(() => vi.stubEnv('CJ_ADMIN_EMAILS', 'owner@example.com'));
afterEach(() => vi.unstubAllEnvs());

async function fixture(count: number) {
  const t = convexTest(schema, modules);
  const userId = await t.run(async ctx => {
    const user = await ctx.db.insert('users', { email: 'owner@example.com' });
    for (let i = 0; i < count; i++) {
      const productId = await ctx.db.insert('commerceProducts', {
        provider: 'zuo', sourceKey: `zuo:${i}`, draft: blankCommerceDraft(), revision: 1, updatedAt: 1,
      });
      await ctx.db.insert('catProductMeta', {
        productId, commissionCategory: 'furniture', navCategory: 'chairs', louieMaeName: `Chair ${i}`,
        slug: `chair-${i}`, slugHistory: [], supplierName: 'Zuo', holds: ['MANUAL'],
        stage: 'imported_draft', createdAt: 1, updatedAt: 1,
      });
    }
    return user;
  });
  return { t, admin: t.withIdentity({ subject: `${userId}|s`, email: 'owner@example.com' }) };
}

it('counts all 803 drafts through bounded pages and marks the legacy count incomplete', async () => {
  const { admin } = await fixture(803);
  const ids = new Set<string>();
  let cursor: string | null = null;
  let complete = false;
  for (let page = 0; page < 20 && !complete; page++) {
    const result: PaginationResult<{ _id: Id<'catProductMeta'> }> = await admin.query(api.v2Admin.pipelineStage, {
      stage: 'imported_draft', paginationOpts: { cursor, numItems: 10000 },
    });
    expect(result.page.length).toBeLessThanOrEqual(100);
    for (const row of result.page) {
      expect(Object.keys(row)).toEqual(['_id']);
      expect(ids.has(row._id)).toBe(false);
      ids.add(row._id);
    }
    cursor = result.continueCursor;
    complete = result.isDone;
  }
  expect(complete).toBe(true);
  expect(ids.size).toBe(803);
  const legacy = await admin.query(api.v2Admin.pipeline, {});
  expect(legacy.imported_draft).toMatchObject({ count: 500, countIsExact: false });
  expect(legacy.published).toMatchObject({ count: 0, countIsExact: true });
});

it('keeps stage membership current and distinguishes an exact 500 from a capped count', async () => {
  const { t, admin } = await fixture(500);
  expect((await admin.query(api.v2Admin.pipeline, {})).imported_draft).toMatchObject({ count: 500, countIsExact: true });
  await t.run(async ctx => {
    const first = await ctx.db.query('catProductMeta').first();
    await ctx.db.patch(first!._id, { stage: 'evidence_review', updatedAt: 2 });
  });
  const page = await admin.query(api.v2Admin.pipelineStage, {
    stage: 'evidence_review', paginationOpts: { cursor: null, numItems: 100 },
  });
  expect(page.isDone).toBe(true);
  expect(page.page).toHaveLength(1);
  expect((await admin.query(api.v2Admin.pipeline, {})).imported_draft.count).toBe(499);
});

it('denies anonymous and non-admin reads, including continuation requests', async () => {
  const { t, admin } = await fixture(2);
  const first = await admin.query(api.v2Admin.pipelineStage, {
    stage: 'imported_draft', paginationOpts: { cursor: null, numItems: 1 },
  });
  const args = { stage: 'imported_draft' as const, paginationOpts: { cursor: first.continueCursor, numItems: 1 } };
  await expect(t.query(api.v2Admin.pipelineStage, args)).rejects.toThrow();
  const user = await t.run(ctx => ctx.db.insert('users', { email: 'customer@example.com' }));
  await expect(t.withIdentity({ subject: `${user}|s`, email: 'customer@example.com' })
    .query(api.v2Admin.pipelineStage, args)).rejects.toThrow();
});

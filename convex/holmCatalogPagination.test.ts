// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);

it('continues across bounded candidate pages with no eligible results', async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    for (let i = 0; i < 30; i++) {
      const productId = await ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: `fixture:${i}`, draft: blankCommerceDraft(), revision: 1, updatedAt: 1 });
      await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1, updatedAt: 1,
        snapshot: { name: `Unqualified ${i}`, description: '', category: '', images: [], facts: '', variants: [] } });
    }
  });
  const first = await t.query(api.holm.catalogPage, { paginationOpts: { numItems: 50, cursor: null } });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  const second = await t.query(api.holm.catalogPage, { paginationOpts: { numItems: 50, cursor: first.continueCursor } });
  expect(second.page).toEqual([]);
  expect(second.isDone).toBe(true);
});

// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
it('returns only published summaries and resolves article details independently', async () => {
  const t = convexTest(schema, modules);
  const fields = {
    title: 'Story',
    excerpt: 'Summary',
    content: '<p>Full article</p><script>unsafe()</script>',
    image: '/photo.jpg',
    category: 'Home',
    date: 'November 17, 2026',
  };
  const ids = await t.run(async (ctx) => ({
    published: await ctx.db.insert('blogPosts', { ...fields, status: 'published' }),
    draft: await ctx.db.insert('blogPosts', { ...fields, status: 'draft' }),
  }));
  const summaries = await t.query(api.blogPosts.publicSummaries, {});
  expect(summaries).toHaveLength(1);
  expect(summaries[0]._id).toBe(ids.published);
  expect(summaries[0].content).toBe('');
  const detail = await t.query(api.blogPosts.publicDetail, { id: ids.published });
  expect(detail?.contentHtml).toBe('<p>Full article</p>');
  expect(detail).not.toHaveProperty('content');
  expect(await t.query(api.blogPosts.publicDetail, { id: ids.draft })).toBeNull();
  expect(await t.query(api.blogPosts.publicDetail, { id: 'invalid' })).toBeNull();
  await t.run((ctx) => ctx.db.patch(ids.published, { status: 'draft' }));
  expect(await t.query(api.blogPosts.publicDetail, { id: ids.published })).toBeNull();
});

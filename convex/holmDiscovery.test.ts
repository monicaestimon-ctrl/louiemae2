// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { internalMutation } from './functions';
import { discoveryProjection } from './holmDiscoveryMaintenance';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
type Test = ReturnType<typeof convexTest>;
type State = Pick<Doc<'holmDiscoveryState'>, 'generation' | 'phase' | 'cursor'>;
async function seed(t: Test) {
  return t.run(async ctx => {
    const draft = { ...blankCommerceDraft(), name: 'Marlowe Light Grey Fabric Chair', description: 'A fabric chair.', category: 'Accent Chairs',
      facts: 'Color: Grey; Supplier secret: DO-NOT-INDEX', images: ['https://example.com/chair.jpg'], factsApproved: true, imagesApproved: true,
      variants: [{ id: 'grey', name: 'Grey', sku: 'PRIVATE-SKU', cost: 899, minimum: 1, increment: 1, retail: 224750, commercial: 180000 }] };
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'discovery-test', draft, revision: 1, updatedAt: 1 });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1, snapshot: listingSnapshot(draft, 'ashcroft', 'house'), fulfillment: draft.variants, updatedAt: 1 });
    return { productId, listingId };
  });
}
const step = (t: Test, state: State) => t.mutation(internal.holmDiscoveryMigration.step, {
  expectedGeneration: state.generation, expectedPhase: state.phase, expectedCursor: state.cursor,
});
async function finish(t: Test, state: State) {
  let current = state;
  for (let count = 0; count < 100 && !['verified', 'failed'].includes(current.phase); count++) current = await step(t, current);
  return current;
}
it('stores public navigation hints without supplier fields, prices or eligibility claims', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  const listing = await t.run(ctx => ctx.db.get(source.listingId));
  const projection = discoveryProjection(listing);
  expect(projection).toMatchObject({ name: 'Marlowe Light Grey Fabric Chair', type: 'chair', material: 'fabric', tone: '#CFCBC4' });
  expect(JSON.stringify(projection)).not.toMatch(/DO-NOT-INDEX|PRIVATE-SKU/);
  for (const privateOrAuthoritative of ['cost', 'retail', 'trade', 'fulfillment', 'facts', 'inStock', 'approved']) {
    expect(projection).not.toHaveProperty(privateOrAuthoritative);
  }
  expect(discoveryProjection({ ...listing!, published: false })).toBeNull();
  expect(discoveryProjection({ ...listing!, channel: 'retail' })).toBeNull();
});
it('resumes bounded batches, rejects old run/replayed requests and repairs orphans', async () => {
  const t = convexTest(schema, modules);
  const sources: Awaited<ReturnType<typeof seed>>[] = [];
  for (let n = 0; n < 25; n++) sources.push(await seed(t));
  const old = await t.mutation(internal.holmDiscoveryMigration.begin, {});
  const started = await t.mutation(internal.holmDiscoveryMigration.begin, {});
  expect((await step(t, old)).advanced).toBe(false);
  let current = await step(t, started);
  expect(current).toMatchObject({ phase: 'listings', checked: 20 });
  expect(current.cursor).not.toBeNull();
  expect((await step(t, started)).advanced).toBe(false);
  while (current.phase === 'listings') current = await step(t, current);
  // Simulate an orphan from before transactional maintenance.
  await t.run(ctx => ctx.db.delete(sources[0].listingId));
  expect((await finish(t, current)).phase).toBe('verified');
  expect(await t.run(ctx => ctx.db.query('holmDiscoveryIndex').collect())).toHaveLength(24);
  expect(await t.query(internal.holmDiscoveryMigration.status, {})).toMatchObject({ phase: 'verified', mismatchIds: [] });
});
it('fails verification on incorrect derived content instead of silently certifying it', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  let current: State = await t.mutation(internal.holmDiscoveryMigration.begin, {});
  while (current.phase !== 'verifyListings') current = await step(t, current);
  await t.run(async ctx => { const row = await ctx.db.query('holmDiscoveryIndex').first(); await ctx.db.patch(row!._id, { material: 'leather' }); });
  const failed = await step(t, current);
  expect(failed).toMatchObject({ phase: 'failed', mismatchIds: [source.listingId] });
  expect((await step(t, failed)).advanced).toBe(false);
});
it('transactionally follows renames and withdrawals without rewriting irrelevant changes', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  await finish(t, await t.mutation(internal.holmDiscoveryMigration.begin, {}));
  const command = internalMutation({ args: {}, handler: async ctx => {
    const first = await ctx.db.query('holmDiscoveryIndex').first();
    await ctx.db.patch(source.listingId, { updatedAt: 500 });
    expect(await ctx.db.query('holmDiscoveryIndex').first()).toEqual(first);
    const listing = await ctx.db.get(source.listingId);
    await ctx.db.patch(source.listingId, { snapshot: { ...listing!.snapshot,
      variants: listing!.snapshot.variants.map(option => ({ ...option, price: option.price + 100 })) } });
    expect(await ctx.db.query('holmDiscoveryIndex').first()).toEqual(first);
    await ctx.db.patch(source.listingId, { snapshot: { ...listing!.snapshot, name: 'Quill', category: '', facts: '' } });
    expect(await ctx.db.query('holmDiscoveryIndex').first()).toMatchObject({ name: 'Quill', material: 'unknown', type: 'other', tone: '' });
    await ctx.db.patch(source.listingId, { published: false });
    expect(await ctx.db.query('holmDiscoveryIndex').collect()).toEqual([]);
    await ctx.db.patch(source.listingId, { published: true });
    expect(await ctx.db.query('holmDiscoveryIndex').collect()).toHaveLength(1);
    await ctx.db.patch(source.listingId, { channel: 'retail' });
    expect(await ctx.db.query('holmDiscoveryIndex').collect()).toEqual([]);
    await ctx.db.patch(source.listingId, { channel: 'house' });
    await ctx.db.delete(source.listingId);
    expect(await ctx.db.query('holmDiscoveryIndex').collect()).toEqual([]);
  } });
  const handler = (command as unknown as { _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<void> })._handler;
  await t.run(ctx => handler(ctx, {}));
});

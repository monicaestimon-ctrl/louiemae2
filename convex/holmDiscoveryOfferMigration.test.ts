// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import type { Doc } from './_generated/dataModel';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
type Test = ReturnType<typeof convexTest>;
type State = Pick<Doc<'holmDiscoveryOfferState'>, 'generation' | 'phase' | 'cursor'>;
const step = (t: Test, state: State) => t.mutation(internal.holmDiscoveryOfferMigration.step, {
  expectedGeneration: state.generation, expectedPhase: state.phase, expectedCursor: state.cursor,
});
async function seed(t: Test) {
  return t.run(async ctx => {
    const draft = { ...blankCommerceDraft(), name: 'Fixture Chair', description: 'Fixture chair.', category: 'Chairs',
      images: ['https://example.com/chair.jpg'], factsApproved: true, imagesApproved: true,
      variants: [{ id: 'grey', name: 'Grey', sku: 'fixture', cost: 10, minimum: 1, increment: 1, retail: 10000, commercial: 7500 }] };
    const productId = await ctx.db.insert('commerceProducts', { provider: 'owner_managed', sourceKey: 'fixture', draft, revision: 1, updatedAt: 1 });
    return ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1,
      snapshot: listingSnapshot(draft, 'owner_managed', 'house'), fulfillment: draft.variants, updatedAt: 1 });
  });
}
async function finish(t: Test, start: State) {
  let state = start;
  for (let n = 0; n < 100 && !['verified', 'failed'].includes(state.phase); n++) state = await step(t, state);
  return state;
}
it('resumes bounded preparation, rejects stale/replayed steps and removes orphan prices', async () => {
  const t = convexTest(schema, modules);
  const listings: Awaited<ReturnType<typeof seed>>[] = [];
  for (let n = 0; n < 25; n++) listings.push(await seed(t));
  const stale = await t.mutation(internal.holmDiscoveryOfferMigration.begin, {});
  const start = await t.mutation(internal.holmDiscoveryOfferMigration.begin, {});
  expect((await step(t, stale)).advanced).toBe(false);
  let state = await step(t, start);
  expect(state).toMatchObject({ phase: 'listings', checked: 20 });
  expect((await step(t, start)).advanced).toBe(false);
  while (state.phase === 'listings') state = await step(t, state);
  await t.run(ctx => ctx.db.delete(listings[0]));
  expect((await finish(t, state)).phase).toBe('verified');
  expect(await t.run(ctx => ctx.db.query('holmDiscoveryOffers').collect())).toHaveLength(24);
});
it('fails verification when a derived price is wrong and never enables customer reads', async () => {
  const t = convexTest(schema, modules); const listingId = await seed(t);
  let state: State = await t.mutation(internal.holmDiscoveryOfferMigration.begin, {});
  while (state.phase !== 'verifyListings') state = await step(t, state);
  await t.run(async ctx => { const row = await ctx.db.query('holmDiscoveryOffers').first(); await ctx.db.patch(row!._id, { tradeMinor: 1 }); });
  const failed = await step(t, state);
  expect(failed).toMatchObject({ phase: 'failed', mismatchIds: [listingId] });
  expect((await step(t, failed)).advanced).toBe(false);
  expect(await t.query(internal.holmDiscoveryOfferMigration.status, {})).not.toHaveProperty('enabled');
});

// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { holmLegacyId } from '../lib/holmProductIdentity';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation } from './functions';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
type Test = ReturnType<typeof convexTest>;
async function seed(t: Test) {
  return t.run(async ctx => {
    const draft = { ...blankCommerceDraft(), name: 'Marlowe Sofa', description: 'A sofa.', category: 'Sofas', images: ['https://example.com/sofa.jpg'], factsApproved: true, imagesApproved: true,
      variants: [{ id: 'tan', name: 'Tan', sku: 'SOF00401401', cost: 899, minimum: 1, increment: 1, retail: 224750, commercial: 180000 }] };
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:identity-fixture', draft, revision: 1, updatedAt: 1 });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1, snapshot: listingSnapshot(draft, 'ashcroft', 'house'), fulfillment: draft.variants, updatedAt: 1 });
    await ctx.db.insert('commerceListings', { productId, channel: 'retail', published: true, revision: 1, snapshot: listingSnapshot(draft, 'ashcroft', 'retail'), fulfillment: draft.variants, updatedAt: 1 });
    return { productId, listingId, legacyId: holmLegacyId(productId) };
  });
}
async function prepare(t: Test) {
  let current: Pick<Doc<'holmIdentityState'>, 'phase' | 'cursor'> = await t.mutation(internal.holmIdentityMigration.begin, {});
  for (let count = 0; count < 100 && current.phase !== 'verified'; count++) current = await t.mutation(internal.holmIdentityMigration.step, { expectedPhase: current.phase, expectedCursor: current.cursor });
  expect(current.phase).toBe('verified');
  await t.mutation(internal.holmIdentityMigration.setEnabled, { enabled: true });
}
it('resolves legacy identities independently of pages while rechecking current public eligibility', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  const query = () => t.query(api.holm.catalogLegacyItems, { legacyIds: [source.legacyId] });
  expect(await query()).toEqual({ ready: false, items: [] });
  await prepare(t);
  const result = await query();
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ status: 'resolved', item: { id: source.productId, name: 'Marlowe Sofa', variants: [{ trade: null }] } });
  expect(JSON.stringify(result)).not.toMatch(/SOF00401401|180000|fulfillment|supplierContact/);
  const mixed = await t.query(api.holm.catalogItems, { productIds: ['broken-saved-id', source.productId] });
  expect(mixed[0]).toEqual({ productId: 'broken-saved-id', item: null });
  expect(mixed[1].item?.id).toBe(source.productId);
  await t.run(ctx => ctx.db.patch(source.listingId, { published: false }));
  expect((await query()).items).toEqual([{ legacyId: source.legacyId, status: 'unavailable', item: null }]);
});
it('rejects ambiguous numeric identities instead of selecting the first source', async () => {
  const t = convexTest(schema, modules); const source = await seed(t); await prepare(t);
  await t.run(ctx => ctx.db.insert('holmCatalogIdentities', { listingId: source.listingId, productId: source.productId, legacyId: source.legacyId }));
  expect((await t.query(api.holm.catalogLegacyItems, { legacyIds: [source.legacyId] })).items).toEqual([{ legacyId: source.legacyId, status: 'conflict', item: null }]);
  await expect(t.query(api.holm.catalogLegacyItems, { legacyIds: Array(25).fill(1) })).rejects.toThrow();
  await expect(t.query(api.holm.catalogLegacyItems, { legacyIds: [1.5] })).rejects.toThrow();
});
it('requires verified migration, handles replayed batches and detects stale index fields', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  expect(await t.query(internal.holmIdentityMigration.status, {})).toBeNull();
  let current: Pick<Doc<'holmIdentityState'>, 'phase' | 'cursor'> = await t.mutation(internal.holmIdentityMigration.begin, {});
  await expect(t.mutation(internal.holmIdentityMigration.setEnabled, { enabled: true })).rejects.toThrow(/Verify/);
  const first = { expectedPhase: current.phase, expectedCursor: current.cursor };
  current = await t.mutation(internal.holmIdentityMigration.step, first);
  const resumed = await t.query(internal.holmIdentityMigration.status, {});
  expect(resumed).toMatchObject({ phase: current.phase, cursor: current.cursor, enabled: false });
  expect(await t.query(internal.holmIdentityMigration.status, {})).toEqual(resumed);
  expect((await t.mutation(internal.holmIdentityMigration.step, first)).advanced).toBe(false);
  while (current.phase !== 'verifyListings') current = await t.mutation(internal.holmIdentityMigration.step, { expectedPhase: current.phase, expectedCursor: current.cursor });
  await t.run(async ctx => { const row = await ctx.db.query('holmCatalogIdentities').first(); await ctx.db.patch(row!._id, { legacyId: source.legacyId + 1 }); });
  const failed = await t.mutation(internal.holmIdentityMigration.step, { expectedPhase: current.phase, expectedCursor: current.cursor });
  expect(failed.phase).toBe('failed'); expect(failed.mismatchIds).toEqual([source.listingId]);
  expect((await t.query(api.holm.catalogLegacyItems, { legacyIds: [source.legacyId] })).ready).toBe(false);
});
it('maintains identities transactionally when House listings change channel or are deleted', async () => {
  const t = convexTest(schema, modules); const source = await seed(t); await prepare(t);
  const command = internalMutation({ args: {}, handler: async ctx => {
    await ctx.db.patch(source.listingId, { channel: 'retail' });
    expect(await ctx.db.query('holmCatalogIdentities').collect()).toEqual([]);
    await ctx.db.patch(source.listingId, { channel: 'house' });
    expect(await ctx.db.query('holmCatalogIdentities').collect()).toHaveLength(1);
    await ctx.db.delete(source.listingId);
    expect(await ctx.db.query('holmCatalogIdentities').collect()).toEqual([]);
  } });
  const handler = (command as unknown as { _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<void> })._handler;
  await t.run(ctx => handler(ctx, {}));
});

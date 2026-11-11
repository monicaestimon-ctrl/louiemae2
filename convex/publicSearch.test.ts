// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation } from './functions';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const legacy = {
  name: 'Rowan Chair',
  price: 100,
  description: 'Private supplier phrase',
  images: ['https://example.com/chair.jpg'],
  category: 'Chairs',
  collection: 'furniture',
};
async function prepare(t: ReturnType<typeof convexTest>) {
  let current: Pick<Doc<'publicSearchState'>, 'phase' | 'cursor'> = await t.mutation(
    internal.publicSearchMigration.begin,
    {}
  );
  for (let step = 0; step < 100 && current.phase !== 'verified'; step++)
    current = await t.mutation(internal.publicSearchMigration.step, {
      expectedPhase: current.phase,
      expectedCursor: current.cursor,
    });
  expect(current.phase).toBe('verified');
  await t.mutation(internal.publicSearchMigration.setEnabled, { enabled: true });
}
const search = (t: ReturnType<typeof convexTest>, term = 'chair', cursor: string | null = null) =>
  t.query(api.publicSearch.search, { term, paginationOpts: { cursor, numItems: 20 } });

describe('verified public search', () => {
  it('uses current Ashcroft retail pricing and stock while excluding trade-only or unpublished listings', async () => {
    const t = convexTest(schema, modules);
    const listingId = await t.run(async (ctx) => {
      const draft = {
        ...blankCommerceDraft(),
        name: 'Marlowe Sofa',
        category: 'Sofas',
        description: 'A sofa.',
        images: ['https://example.com/sofa.jpg'],
        factsApproved: true,
        imagesApproved: true,
        variants: [
          {
            id: 'tan',
            name: 'Tan',
            sku: 'SOF00401401',
            cost: 899,
            minimum: 1,
            increment: 1,
            retail: 224750,
            commercial: 180000,
          },
        ],
      };
      const productId = await ctx.db.insert('commerceProducts', {
        provider: 'ashcroft',
        sourceKey: 'ashcroft:fixture',
        draft,
        revision: 1,
        updatedAt: 1,
      });
      await ctx.db.insert('commerceListings', {
        productId,
        channel: 'house',
        published: true,
        revision: 1,
        snapshot: listingSnapshot(draft, 'ashcroft', 'house'),
        updatedAt: 1,
      });
      return ctx.db.insert('commerceListings', {
        productId,
        channel: 'retail',
        published: true,
        revision: 1,
        snapshot: listingSnapshot(draft, 'ashcroft', 'retail'),
        fulfillment: draft.variants,
        updatedAt: 1,
      });
    });
    await prepare(t);
    const page = await search(t, 'marlowe');
    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({ price: 2549, availability: 'available', currency: 'USD' });
    expect(JSON.stringify(page)).not.toMatch(/180000|SOF00401401|899|fulfillment/);
    await t.mutation(internal.ashcroftInventory.reconcile, {
      source: 'Fixture inventory',
      sha256: 'a'.repeat(64),
      observedAt: Date.now(),
      rows: [{ sku: 'SOF00401401', quantity: 0 }],
    });
    expect((await search(t, 'marlowe')).page[0].availability).toBe('unavailable');
    await t.run((ctx) => ctx.db.patch(listingId, { published: false }));
    expect((await search(t, 'marlowe')).page).toHaveLength(0);
  });
  it('bounds pages, retains a cursor after an empty eligible page and excludes private fields', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ids: Id<'products'>[] = [];
      for (let i = 0; i < 35; i++)
        ids.push(
          await ctx.db.insert('products', {
            ...legacy,
            name: `Chair ${i}`,
            sourceUrl: 'https://supplier.example/private',
            confirmedLandedCost: 50,
          })
        );
      return ids;
    });
    await expect(search(t)).rejects.toThrow(/Search is being updated/);
    await prepare(t);
    const first = await search(t);
    expect(first.page).toHaveLength(20);
    expect(first.isDone).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(
      /confirmedLandedCost|supplier\.example|Private supplier/
    );
    expect(JSON.stringify(first).length).toBeLessThan(100_000);
    // Simulate stale index rows: current publication still controls the returned page.
    await t.run(async (ctx) => {
      for (const row of first.page)
        await ctx.db.patch(row._id as Id<'products'>, { storefrontStatus: 'hidden' });
    });
    const hidden = await search(t);
    expect(hidden.page).toHaveLength(0);
    expect(hidden.isDone).toBe(false);
    const later = await search(t, 'chair', hidden.continueCursor);
    expect(later.page).toHaveLength(15);
    expect(later.isDone).toBe(true);
    expect((await search(t, 'supplier')).page).toHaveLength(0);
    expect(ids).toHaveLength(35);
  });

  it('updates legacy and listing projections transactionally without price or supplier payloads', async () => {
    const t = convexTest(schema, modules);
    const command = internalMutation({
      args: {},
      handler: async (ctx) => {
        const id = await ctx.db.insert('products', legacy);
        const rows = () => ctx.db.query('publicSearch').collect();
        expect(await rows()).toHaveLength(1);
        await ctx.db.patch(id, { name: 'Renamed Chair', price: 120 });
        expect((await rows())[0].text).toContain('renamed chair');
        await ctx.db.patch(id, { inStock: false });
        expect(await rows()).toHaveLength(0);
        const draft = {
          ...blankCommerceDraft(),
          name: 'Marlowe Sofa',
          category: 'Sofas',
          variants: [],
        };
        const productId = await ctx.db.insert('commerceProducts', {
          provider: 'ashcroft',
          sourceKey: 'fixture',
          draft,
          revision: 1,
          updatedAt: 1,
        });
        const listingId = await ctx.db.insert('commerceListings', {
          productId,
          channel: 'retail',
          published: true,
          revision: 1,
          snapshot: {
            name: draft.name,
            category: draft.category,
            description: '',
            images: [],
            facts: '',
            variants: [],
          },
          updatedAt: 1,
        });
        expect(await rows()).toMatchObject([{ productId, text: 'marlowe sofa sofas' }]);
        await ctx.db.patch(listingId, { channel: 'house' });
        expect(await rows()).toHaveLength(0);
        await ctx.db.patch(listingId, { channel: 'retail' });
        await ctx.db.delete(listingId);
        expect(await rows()).toHaveLength(0);
      },
    });
    const handler = (
      command as unknown as {
        _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<void>;
      }
    )._handler;
    await t.run((ctx) => handler(ctx, {}));
  });

  it('rejects an unverified cutover and detects a mismatched projection', async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert('products', legacy));
    let current: Pick<Doc<'publicSearchState'>, 'phase' | 'cursor'> = await t.mutation(
      internal.publicSearchMigration.begin,
      {}
    );
    await expect(
      t.mutation(internal.publicSearchMigration.setEnabled, { enabled: true })
    ).rejects.toThrow(/Verify both/);
    for (let step = 0; step < 10 && current.phase !== 'verifyLegacy'; step++)
      current = await t.mutation(internal.publicSearchMigration.step, {
        expectedPhase: current.phase,
        expectedCursor: current.cursor,
      });
    expect(current.phase).toBe('verifyLegacy');
    await t.run(async (ctx) => {
      const row = await ctx.db.query('publicSearch').first();
      await ctx.db.patch(row!._id, { text: 'Wrong' });
    });
    const failed = await t.mutation(internal.publicSearchMigration.step, {
      expectedPhase: current.phase,
      expectedCursor: current.cursor,
    });
    expect(failed.phase).toBe('failed');
    expect(failed.mismatchIds).toHaveLength(1);
    expect(await t.query(api.publicSearch.status, {})).toEqual({ ready: false });
    await prepare(t);
    expect((await search(t)).page).toHaveLength(1);
  });
});

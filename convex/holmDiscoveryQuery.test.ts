// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { discoveryProjection, HOLM_DISCOVERY_VERSION } from './holmDiscoveryMaintenance';
import { syncDiscoveryOffers } from './holmDiscoveryOffers';
import { holmLegacyId } from '../lib/holmProductIdentity';
import type { DiscoveryRequest } from '../lib/holmDiscoveryFilters';
import type { FunctionReturnType } from 'convex/server';
const access = vi.hoisted(() => ({ me: null as null | { userId: string; profile: { tradeStatus: string } } }));
vi.mock('./holmAccess', async original => ({ ...await original<typeof import('./holmAccess')>(), viewer: async () => access.me }));
afterEach(() => { access.me = null; });
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const base: DiscoveryRequest = { query: '', type: 'all', materials: [], tones: [], photoPalette: [], maximumMinor: null, inStock: false, sort: 'priceAsc', channel: 'retail' };
type Test = ReturnType<typeof convexTest>;
async function seed(t: Test) {
  return t.run(async ctx => {
    const sources = [];
    for (const [name, prices] of [['Ivory Fabric Chair', [30000, 10000]], ['Black Leather Sofa', [20000, 20000]], ['Stone Wood Table', [50000]]] as [string, number[]][]) {
      const draft = { ...blankCommerceDraft(), name, category: name.includes('Sofa') ? 'Sofas' : name.includes('Table') ? 'Dining Tables' : 'Accent Chairs',
        description: 'Fixture', images: ['https://example.com/fixture.jpg'], facts: '', factsApproved: true, imagesApproved: true,
        variants: prices.map((retail, index) => ({ id: String.fromCharCode(97 + index), name: `Option ${index}`, sku: `PRIVATE-${index}`, cost: 10,
          minimum: 1, increment: 1, retail, commercial: Math.round(retail * 0.75) })) };
      const productId = await ctx.db.insert('commerceProducts', { provider: 'owner_managed', sourceKey: name, draft, revision: 1, updatedAt: 1 });
      const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1,
        snapshot: listingSnapshot(draft, 'owner_managed', 'house'), fulfillment: draft.variants, updatedAt: 1 });
      await ctx.db.insert('holmDiscoveryIndex', discoveryProjection(await ctx.db.get(listingId))!);
      await syncDiscoveryOffers(ctx, listingId);
      await ctx.db.insert('holmCatalogIdentities', { productId, listingId, legacyId: holmLegacyId(productId) });
      sources.push({ productId, listingId });
    }
    const metadataId = await ctx.db.insert('holmDiscoveryState', { version: HOLM_DISCOVERY_VERSION, generation: 1, readerEnabled: true, readerOfferGeneration: 1,
      phase: 'verified', cursor: null, checked: 3, mismatchIds: [], updatedAt: 1 });
    await ctx.db.insert('holmDiscoveryOfferState', { version: 1, generation: 1, phase: 'verified', cursor: null, checked: 5, mismatchIds: [], updatedAt: 1 });
    return { sources, metadataId };
  });
}
async function all(t: Test, request: DiscoveryRequest) {
  const items = []; let cursor: string | null = null; let pages = 0;
  do {
    const result: FunctionReturnType<typeof api.holmDiscoveryQuery.page> = await t.query(api.holmDiscoveryQuery.page, { request, cursor, pageSize: 1 });
    expect(result.ready).toBe(true); expect(result.items.length).toBeLessThanOrEqual(1);
    items.push(...result.items); cursor = result.nextCursor;
    if (++pages > 80) throw new Error('Pagination did not advance.');
  } while (cursor);
  return items;
}
it('paginates globally by each product’s cheapest eligible variant in either direction without duplicates', async () => {
  const t = convexTest(schema, modules); await seed(t);
  const ascending = await all(t, base);
  expect(ascending.map(item => item.name)).toEqual(['Ivory Fabric Chair', 'Black Leather Sofa', 'Stone Wood Table']);
  expect(ascending.map(item => item.defaultVariantId)).toEqual(['b', 'a', 'a']);
  expect((await all(t, { ...base, sort: 'priceDesc' })).map(item => item.name)).toEqual([...ascending].reverse().map(item => item.name));
  expect(ascending.every(item => item.variants.every(variant => variant.trade === null))).toBe(true);
  expect(JSON.stringify(ascending)).not.toMatch(/PRIVATE-|"cost"|"fulfillment"/);
});
it('retains empty candidate continuations and applies material, color and current price filters globally', async () => {
  const t = convexTest(schema, modules); await seed(t);
  const request = { ...base, materials: ['leather'] };
  const first = await t.query(api.holmDiscoveryQuery.page, { request, cursor: null, pageSize: 1 });
  expect(first.items).toEqual([]); expect(first.nextCursor).not.toBeNull();
  expect((await all(t, request)).map(item => item.name)).toEqual(['Black Leather Sofa']);
  expect((await all(t, { ...base, tones: ['#E7DFD0'], maximumMinor: 15000 })).map(item => item.name)).toEqual(['Ivory Fabric Chair']);
});
it('uses full color-bucket order for photos while explicit price sorting overrides that order', async () => {
  const t = convexTest(schema, modules); await seed(t);
  expect((await all(t, { ...base, sort: 'relevance', photoPalette: ['#2A2522'] })).map(item => item.name)).toEqual(['Black Leather Sofa', 'Stone Wood Table', 'Ivory Fabric Chair']);
  expect((await all(t, { ...base, photoPalette: ['#2A2522'] })).map(item => item.name)).toEqual(['Ivory Fabric Chair', 'Black Leather Sofa', 'Stone Wood Table']);
});
it('rejects cross-filter, viewer and generation cursors and denies anonymous trade prices', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  await expect(t.query(api.holmDiscoveryQuery.page, { request: { ...base, channel: 'trade' }, cursor: null, pageSize: 1 })).rejects.toThrow('Trade pricing');
  const first = await t.query(api.holmDiscoveryQuery.page, { request: base, cursor: null, pageSize: 1 });
  await expect(t.query(api.holmDiscoveryQuery.page, { request: { ...base, type: 'sofa' }, cursor: first.nextCursor, pageSize: 1 })).rejects.toThrow('check the details');
  access.me = { userId: 'approved-user', profile: { tradeStatus: 'approved' } };
  await expect(t.query(api.holmDiscoveryQuery.page, { request: base, cursor: first.nextCursor, pageSize: 1 })).rejects.toThrow('check the details');
  expect((await all(t, { ...base, channel: 'trade' })).every(item => item.variants.every(variant => variant.trade !== null))).toBe(true);
  access.me = null;
  await t.run(ctx => ctx.db.patch(source.metadataId, { generation: 2 }));
  await expect(t.query(api.holmDiscoveryQuery.page, { request: base, cursor: first.nextCursor, pageSize: 1 })).rejects.toThrow('check the details');
});
it('keeps activation explicit, verified, generation-bound and audited', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  await t.mutation(internal.holmDiscoveryQuery.setReaderEnabled, { enabled: false, metadataGeneration: 1, offerGeneration: 1, reason: 'Fixture rollback' });
  expect(await t.query(api.holmDiscoveryQuery.readiness, {})).toMatchObject({ ready: false });
  expect((await t.query(api.holmDiscoveryQuery.page, { request: base, cursor: null, pageSize: 1 })).items).toEqual([]);
  await t.run(ctx => ctx.db.patch(source.metadataId, { phase: 'failed' }));
  await expect(t.mutation(internal.holmDiscoveryQuery.setReaderEnabled, { enabled: true, metadataGeneration: 1, offerGeneration: 1, reason: 'Invalid activation' })).rejects.toThrow('temporarily unavailable');
  expect(await t.run(ctx => ctx.db.query('sysAuditEvents').collect())).toHaveLength(1);
});
it('rejects derived-price drift and conflicting legacy display identities', async () => {
  const t = convexTest(schema, modules); const source = await seed(t);
  await t.run(async ctx => { const row = await ctx.db.query('holmDiscoveryOffers').withIndex('by_listing', q => q.eq('listingId', source.sources[0].listingId)).filter(q => q.eq(q.field('variantId'), 'b')).first(); await ctx.db.patch(row!._id, { retailMinor: 1 }); });
  await expect(t.query(api.holmDiscoveryQuery.page, { request: base, cursor: null, pageSize: 1 })).rejects.toThrow('temporarily unavailable');
  await t.run(async ctx => { await syncDiscoveryOffers(ctx, source.sources[0].listingId); await ctx.db.insert('holmCatalogIdentities', { ...source.sources[1], legacyId: holmLegacyId(source.sources[0].productId) }); });
  expect((await all(t, base)).map(item => item.name)).not.toContain('Ivory Fabric Chair');
});

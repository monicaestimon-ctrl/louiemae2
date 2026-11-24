// @vitest-environment node
/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import { blankCommerceDraft, listingSnapshot } from '../lib/commerce';
import { approvedDiscoveryPrice, discoveryOffers, syncDiscoveryOffers } from './holmDiscoveryOffers';
import { internalMutation } from './functions';
import type { MutationCtx } from './_generated/server';
import { catalogItem } from './holmCatalogRead';
import { ensureSupplier } from './catCore';
import type { Doc, Id } from './_generated/dataModel';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
async function wrapped(t: ReturnType<typeof convexTest>, run: (ctx: MutationCtx) => Promise<void>) {
  const command = internalMutation({ args: {}, handler: run });
  await t.run(ctx => (command as unknown as { _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<void> })._handler(ctx, {}));
}

it('uses existing Ashcroft prices and keeps stock-independent candidates separate from sellability', async () => {
  const t = convexTest(schema, modules);
  const source = await t.run(async ctx => {
    const draft = { ...blankCommerceDraft(), name: 'Fixture Sofa', description: 'A sofa.', category: 'Sofas', images: ['https://example.com/sofa.jpg'], factsApproved: true, imagesApproved: true,
      variants: [{ id: 'tan', name: 'Tan', sku: 'SOF00401401', cost: 899, minimum: 1, increment: 1, retail: 224750, commercial: 180000 }] };
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'discovery-offer-fixture', draft, revision: 1, updatedAt: 1 });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1, snapshot: listingSnapshot(draft, 'ashcroft', 'house'), fulfillment: draft.variants, updatedAt: 1 });
    await ctx.db.insert('commerceListings', { productId, channel: 'retail', published: true, revision: 1, snapshot: listingSnapshot(draft, 'ashcroft', 'retail'), fulfillment: draft.variants, updatedAt: 1 });
    await ctx.db.insert('ashcroftInventoryFeeds', { source: 'fixture', sha256: 'a'.repeat(64), observedAt: Date.now(), validUntil: Date.now() + 60000, importedAt: Date.now(), rows: [{ sku: 'SOF00401401', quantity: 10 }] });
    return { productId, listingId, variants: draft.variants };
  });
  const inspect = () => t.run(async ctx => {
    const listing = (await ctx.db.get(source.listingId))!;
    return { offers: await discoveryOffers(ctx, listing), item: await catalogItem(ctx, listing, true, Date.now()) };
  });
  const first = await inspect();
  expect(first.offers).toHaveLength(1);
  expect(first.offers[0]).toMatchObject({ retailMinor: first.item!.variants[0].retail, tradeMinor: first.item!.variants[0].trade });
  expect(first.offers[0]).not.toHaveProperty('cost');
  await t.run(ctx => syncDiscoveryOffers(ctx, source.listingId));
  const rows = () => t.run(ctx => ctx.db.query('holmDiscoveryOffers').collect());
  const initialRows = await rows();
  await wrapped(t, async ctx => {
    await ctx.db.patch(source.listingId, { updatedAt: 999 });
    await ctx.db.patch(source.productId, { updatedAt: 999 });
  });
  expect(await rows()).toEqual(initialRows);
  await wrapped(t, async ctx => {
    const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', source.productId).eq('channel', 'retail')).unique();
    await ctx.db.patch(retail!._id, { snapshot: { ...retail!.snapshot, variants: retail!.snapshot.variants.map(v => ({ ...v, price: v.price + 50000 })) } });
  });
  expect((await rows())[0].retailMinor).toBeGreaterThan(initialRows[0].retailMinor!);
  expect((await rows())[0].tradeMinor).toBe((await inspect()).offers[0].tradeMinor);
  await wrapped(t, async ctx => {
    const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', source.productId).eq('channel', 'retail')).unique();
    await ctx.db.patch(retail!._id, { snapshot: { ...retail!.snapshot, variants: retail!.snapshot.variants.map(v => ({ ...v, price: v.price - 50000 })) } });
  });
  await t.run(async ctx => { const feed = await ctx.db.query('ashcroftInventoryFeeds').first(); await ctx.db.patch(feed!._id, { rows: [{ sku: 'SOF00401401', quantity: 0 }] }); });
  expect(await inspect()).toEqual({ offers: first.offers, item: null });
  expect((await t.query(api.holm.catalogItems, { productIds: [source.productId] }))[0].item).toBeNull();
  await wrapped(t, async ctx => { await ctx.db.patch(source.listingId, { fulfillment: source.variants.map(v => ({ ...v, cost: 0 })) }); });
  expect((await inspect()).offers).toEqual([]);
  expect(await rows()).toEqual([]);
  await wrapped(t, async ctx => { await ctx.db.patch(source.listingId, { fulfillment: source.variants }); });
  expect(await rows()).toHaveLength(1);
  await wrapped(t, async ctx => { await ctx.db.patch(source.listingId, { published: false }); });
  expect((await inspect()).offers).toEqual([]);
  expect(await rows()).toEqual([]);
  await wrapped(t, async ctx => { await ctx.db.patch(source.listingId, { published: true }); });
  expect(await rows()).toHaveLength(1);
  await wrapped(t, async ctx => { await ctx.db.delete(source.productId); });
  expect(await rows()).toEqual([]);
});

const variantId = 'variant' as Id<'catVariants'>;
const price: Doc<'catPriceRevisions'> = {
  _id: 'price' as Id<'catPriceRevisions'>, _creationTime: 1, variantId, channel: 'trade', packPriceMinor: 10000, piecePriceMinorInfo: 5000,
  marginPolicyKey: 'fixture', marginPolicyVersion: 1, roundingPolicyVersion: 1, status: 'approved', origin: 'manual',
  createdAt: 1, createdBy: 'fixture', effectiveFrom: 100, effectiveTo: 200, source: 'fixture',
};
it('retains a valid approved price window without claiming it is currently effective', () => {
  expect(approvedDiscoveryPrice(price, variantId, 'trade')).toEqual({ minor: 10000, revisionId: price._id, from: 100, to: 200 });
  expect(approvedDiscoveryPrice({ ...price, effectiveFrom: 9999999999999, effectiveTo: undefined }, variantId, 'trade'))
    .toMatchObject({ from: 9999999999999, to: null });
});
it('rejects wrong channel/identity, nonapproved, invalid windows and invalid amounts', () => {
  expect(approvedDiscoveryPrice(price, variantId, 'retail')).toBeNull();
  expect(approvedDiscoveryPrice(price, 'other' as Id<'catVariants'>, 'trade')).toBeNull();
  for (const change of [{ status: 'candidate' as const }, { status: 'superseded' as const }, { effectiveTo: 100 }, { effectiveFrom: Infinity }, { effectiveFrom: -1 }, { packPriceMinor: 0 }, { packPriceMinor: 1.5 }]) {
    expect(approvedDiscoveryPrice({ ...price, ...change }, variantId, 'trade')).toBeNull();
  }
});

it('binds Zuo candidates to exact approved variant/channel revisions and the published trade price', async () => {
  const t = convexTest(schema, modules);
  const source = await t.run(async ctx => {
    const productId = await ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: 'zuo-offer-fixture', draft: blankCommerceDraft(), revision: 1, updatedAt: 1 });
    const supplier = await ensureSupplier(ctx, 'zuo');
    const id = await ctx.db.insert('catVariants', { productId, supplierId: supplier!._id, supplierSku: 'PRIVATE-ZUO-SKU', packId: 'pair', optionKey: 'grey',
      supplierVariantName: 'Supplier', louieMaeVariantName: 'Grey', piecesPerPack: 2, orderMinimumPacks: 1, orderIncrementPacks: 1,
      availability: 'in_stock', fulfillmentRoute: 'manual_dealer_zuo', holds: ['MANUAL'], createdAt: 1, updatedAt: 1 });
    const revision = { variantId: id, packPriceMinor: 10000, piecePriceMinorInfo: 5000, marginPolicyKey: 'fixture', marginPolicyVersion: 1,
      roundingPolicyVersion: 1, status: 'approved' as const, origin: 'manual' as const, createdAt: 1, createdBy: 'fixture', effectiveFrom: 1, source: 'fixture' };
    const tradeId = await ctx.db.insert('catPriceRevisions', { ...revision, channel: 'trade' });
    const retailId = await ctx.db.insert('catPriceRevisions', { ...revision, channel: 'retail', packPriceMinor: 16000, piecePriceMinorInfo: 8000 });
    await ctx.db.patch(id, { tradePriceRevisionId: tradeId, retailPriceRevisionId: retailId });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1, updatedAt: 1,
      snapshot: { name: 'Fixture Chair', description: 'A chair.', category: 'Accent Chairs', images: [], facts: '',
        variants: [{ id, name: 'Grey', minimum: 1, increment: 1, price: 10000 }] } });
    return { id, productId, listingId, tradeId, retailId };
  });
  const inspect = () => t.run(async ctx => discoveryOffers(ctx, (await ctx.db.get(source.listingId))!));
  expect(await inspect()).toMatchObject([{ variantId: source.id, retailMinor: 16000, tradeMinor: 10000, retailRevisionId: source.retailId, tradeRevisionId: source.tradeId }]);
  await t.run(ctx => syncDiscoveryOffers(ctx, source.listingId));
  const rows = () => t.run(ctx => ctx.db.query('holmDiscoveryOffers').collect());
  const initial = await rows();
  await wrapped(t, async ctx => { await ctx.db.patch(source.id, { availability: 'out_of_stock', holds: ['STOCK_UNVERIFIED'], updatedAt: 1234 }); });
  expect(await rows()).toEqual(initial);
  await wrapped(t, async ctx => { await ctx.db.patch(source.tradeId, { status: 'superseded' }); });
  expect(await rows()).toEqual([]);
  await wrapped(t, async ctx => { await ctx.db.patch(source.tradeId, { status: 'approved' }); });
  expect(await rows()).toHaveLength(1);
  // Candidate evidence cannot override disabled/unqualified catalog eligibility.
  expect((await t.query(api.holm.catalogItems, { productIds: [source.productId] }))[0].item).toBeNull();
  await t.run(async ctx => { const listing = (await ctx.db.get(source.listingId))!; await ctx.db.patch(listing._id, { snapshot: { ...listing.snapshot, variants: listing.snapshot.variants.map(v => ({ ...v, price: 9999 })) } }); });
  expect(await inspect()).toEqual([]);
  await t.run(async ctx => { const listing = (await ctx.db.get(source.listingId))!; await ctx.db.patch(listing._id, { snapshot: { ...listing.snapshot, variants: listing.snapshot.variants.map(v => ({ ...v, price: 10000 })) } }); await ctx.db.patch(source.retailId, { status: 'superseded' }); });
  expect(await inspect()).toMatchObject([{ retailMinor: null, tradeMinor: 10000 }]);
  await t.run(ctx => ctx.db.patch(source.id, { tradePriceRevisionId: source.retailId }));
  expect(await inspect()).toEqual([]);
});

it('follows linked landed costs and currency changes without indexing stock as price authority', async () => {
  const t = convexTest(schema, modules);
  const source = await t.run(async ctx => {
    const linked = await ctx.db.insert('products', { name: 'Linked fixture', price: 200, description: 'Fixture', images: [], category: 'chairs', collection: 'furniture', estimatedLandedCost: 10 });
    const draft = { ...blankCommerceDraft(), name: 'Fixture chair', description: 'Fixture', category: 'Chairs', images: ['https://example.com/chair.jpg'], factsApproved: true, imagesApproved: true,
      variants: [{ id: 'grey', name: 'Grey', sku: 'fixture', cost: 10, minimum: 1, increment: 1, retail: 20000, commercial: 15000 }] };
    const productId = await ctx.db.insert('commerceProducts', { provider: 'owner_managed', cjProductId: linked, sourceKey: 'linked-fixture', draft, revision: 1, updatedAt: 1 });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'house', published: true, revision: 1,
      snapshot: listingSnapshot(draft, 'owner_managed', 'house'), fulfillment: draft.variants, updatedAt: 1 });
    await syncDiscoveryOffers(ctx, listingId);
    return { linked, productId, listingId, draft };
  });
  const rows = () => t.run(ctx => ctx.db.query('holmDiscoveryOffers').collect());
  const first = await rows();
  await wrapped(t, async ctx => { await ctx.db.patch(source.linked, { confirmedLandedCost: 120 }); });
  expect((await rows())[0].tradeMinor).toBeGreaterThan(first[0].tradeMinor);
  const repriced = await rows();
  await wrapped(t, async ctx => { await ctx.db.patch(source.linked, { inStock: false }); });
  expect(await rows()).toEqual(repriced);
  await wrapped(t, async ctx => { await ctx.db.patch(source.productId, { draft: { ...source.draft, usdRate: 0 } }); });
  expect(await rows()).toEqual([]);
  await wrapped(t, async ctx => { await ctx.db.patch(source.productId, { draft: source.draft }); });
  expect(await rows()).toHaveLength(1);
  await wrapped(t, async ctx => { await ctx.db.delete(source.listingId); });
  expect(await rows()).toEqual([]);
});

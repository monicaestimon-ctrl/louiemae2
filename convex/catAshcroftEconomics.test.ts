import { retailDetail } from './retailStorefront';
import { catalogItem } from './holmCatalogRead';
import { computeEstimate as estimate } from './dlvEngine';
import { approvedAshcroftOffer } from './catAshcroftOffer';
// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';
import { CONFIG_SEED } from '../lib/config/seed';
import { ensureAshcroftIdentity } from './catAshcroft';
import { computeScenarios, qualifyApprovedPrice } from './catEconomics';
import { recordScenarios } from './catPricing';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const NOW = Date.UTC(2026, 10, 23);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: NOW }); process.env.CJ_ADMIN_EMAILS = 'owner@example.com'; });
afterEach(() => { vi.useRealTimers(); delete process.env.CJ_ADMIN_EMAILS; delete process.env.DELIVERY_ADMIN_ROLES; delete process.env.CATALOG_PUBLICATION_V2_ENABLED; delete process.env.TRADE_CHECKOUT_V2_ENABLED; delete process.env.DELIVERY_AUTOMATION_ENABLED; delete process.env.RETAIL_ZUO_CHECKOUT_ENABLED; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const revision = { createdAt: NOW - 1000, createdBy: 'fixture', effectiveFrom: NOW - 1000, source: 'fixture' };
    for (const seed of CONFIG_SEED) await ctx.db.insert('sysConfig', { kind: seed.kind, key: seed.key, version: seed.version,
      status: 'approved', value: seed.key === 'trade-discount' ? { general: { maxBps: 2500, requiresSchedule: true }, suppliers: { ashcroft: { defaultBps: 2500, projectStacking: true } } } : seed.value,
      note: 'Fixture only', approvedAt: NOW - 1000, approvedBy: 'fixture', ...revision });
    const assumptionId = await ctx.db.insert('sysConfig', { kind: 'pricingAssumptions', key: 'ashcroft-pricing-assumptions', version: 1, status: 'approved',
      value: { supplierCode: 'ashcroft', wholesaleUnitBasis: 'selling_unit', supplierPaymentReserveBps: 300, processingBps: 300, returnsBps: 200, overheadBps: 500,
        handlingPerSellingUnitMinor: 0, fixedProcessingPerSellingUnitMinor: 30, fundedTradeDiscountBps: 0 }, note: 'Fixture only', ...revision });
    await ctx.db.insert('sysConfig', { kind: 'marginPolicy', key: 'ashcroft-fixture', version: 1, status: 'approved', value: { targetBps: 2000 }, note: 'Fixture only', ...revision });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:fixture', draft: { ...blankCommerceDraft(), name: 'Fixture bench', category: 'bench' }, revision: 1, updatedAt: NOW });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'retail', published: true, revision: 1, updatedAt: NOW,
      snapshot: { name: 'Fixture bench', category: 'bench', description: '', images: [], facts: '', variants: [{ id: 'legacy', name: 'Default Title', price: 60000, minimum: 1, increment: 1 }] },
      fulfillment: [{ id: 'legacy', name: 'Bench', sku: 'BEN-FIXTURE', cost: 300, retail: 60000, commercial: 0, minimum: 1, increment: 1 }] });
    const cv = await ensureAshcroftIdentity(ctx, { productId, variantId: 'legacy', sku: 'BEN-FIXTURE', name: 'Fixture bench', minimum: 1, increment: 1 }, 'fixture');
    const metaId = await ctx.db.insert('catProductMeta', { productId, supplierId: cv.supplierId, commissionCategory: 'furniture', navCategory: 'bench', louieMaeName: 'Fixture bench',
      slug: 'fixture', slugHistory: [], supplierName: 'Fixture bench', holds: [], stage: 'evidence_review', createdAt: NOW, updatedAt: NOW });
    const costId = await ctx.db.insert('catCostRevisions', { variantId: cv._id, wholesaleMinor: 30000, wholesalePrecise: '300', wholesaleUnitBasis: 'selling_unit', currency: 'USD',
      dutiesMinor: null, dutiesConfirmedZero: true, inboundFreightMinor: null, inboundConfirmedZero: true, supplierFeesMinor: null, feesConfirmedZero: true,
      mapMinor: null, mapUnitBasis: 'pack', mapSource: 'none', mapApplicability: 'not_applicable', costSource: 'Fixture only', verifiedAt: NOW - 1000, observationIds: [], ...revision });
    await ctx.db.patch(cv._id, { currentCostRevisionId: costId, marginPolicyKey: 'ashcroft-fixture', referralEligible: true });
    return { variantId: cv._id, costId, listingId, metaId, assumptionId };
  });
  const admin = t.withIdentity({ subject: 'owner', email: 'owner@example.com' });
  const compute = (reserveRetailCommission = true) => t.run(async ctx => computeScenarios(ctx, (await ctx.db.get(ids.variantId))!, { now: NOW, reserveRetailCommission }));
  const qualify = (channel: 'retail' | 'trade') => t.run(async ctx => qualifyApprovedPrice(ctx, (await ctx.db.get(ids.variantId))!, channel, NOW));
  return { t, admin, ...ids, compute, qualify };
}


async function publicationSetup() {
    const s = await setup();
    process.env.CATALOG_PUBLICATION_V2_ENABLED = 'true';
    process.env.RETAIL_ZUO_CHECKOUT_ENABLED = 'true';
    process.env.DELIVERY_AUTOMATION_ENABLED = 'true';
    process.env.TRADE_CHECKOUT_V2_ENABLED = 'true';
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'retail', packPriceMinor: 80000, reason: 'Fixture funded retail offer' });
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'trade', packPriceMinor: 60000, reason: 'Fixture funded trade offer' });
    const original = (await s.t.run(ctx => ctx.db.get(s.listingId)))!;
    const cv = (await s.t.run(ctx => ctx.db.get(s.variantId)))!;
    const source = await s.t.run(async ctx => {
      const service = (await ctx.db.query('sysConfig').withIndex('by_kind_key_version', q => q.eq('kind', 'serviceLevel').eq('key', 'delivery-curbside')).first())!;
      await ctx.db.patch(service._id, { value: { ...service.value, modes: { ...service.value.modes, per_item: { label: 'Fixture Ashcroft delivery', details: ['Fixture curbside service only'], evidenceRef: 'Fixture approved service scope' } } } });
      await ctx.db.patch(cv._id, { holds: [] });
      await ctx.db.patch(s.metaId, { stage: 'ready', holds: [] });
      const storageId = await ctx.storage.store(new Blob(['fixture image']));
      await ctx.db.insert('catMediaAssets', { productId: cv.productId, role: 'hero', storageId, derivatives: [], contentHash: 'fixture',
        mime: 'image/jpeg', width: 1200, height: 1200, bytes: 13, sourceUrl: 'https://example.com/fixture.jpg',
        rights: { basis: 'Fixture media permission', attributionRequired: false, privateOriginal: false },
        altText: 'Fixture bench', verifiedAgainst: { sku: cv.supplierSku, pack: cv.packId }, status: 'verified', createdAt: NOW });
      return ctx.db.insert('ashcroftInventoryFeeds', { source: 'Fixture selling-unit inventory', sha256: 'a'.repeat(64),
        observedAt: NOW - 1000, validUntil: NOW + 3600000, importedAt: NOW, rows: [{ sku: cv.supplierSku, quantity: 10 }] });
    });
    return { s, cv, source, original };
}

describe('Ashcroft supplier-specific qualification', () => {
  it('publishes final Ashcroft prices once, preserves legacy IDs and funds independent retail/trade delivery', async () => {
    const { s, cv, source, original } = await publicationSetup();
    await s.admin.mutation(api.catPublication.verifyCanonicalIdentity, { productId: cv.productId, variantIds: [cv._id] });
    await s.admin.mutation(api.catPublication.publish, { productIds: [cv.productId], channels: ['retail', 'house'] });
    const retail = await s.t.run(ctx => retailDetail(ctx, cv.productId));
    expect(retail).toMatchObject({ price: 800, deliveryFee: 29, checkoutMode: 'v2', inStock: true });
    expect(retail!.variants[0].id).toBe('legacy');
    const house = (await s.t.run(ctx => ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', cv.productId).eq('channel', 'house')).unique()))!;
    const trade = await s.t.run(ctx => catalogItem(ctx, house, true, NOW));
    expect(trade).toMatchObject({ checkoutMode: 'v2', variants: [{ id: 'legacy', retail: 80000, trade: 60000 }] });
    await s.t.run(ctx => ctx.db.patch(s.costId, { feesConfirmedZero: false }));
    expect((await s.t.run(ctx => retailDetail(ctx, cv.productId)))?.inStock).toBe(false);
    expect(await s.t.run(ctx => catalogItem(ctx, house, true, NOW))).toBeNull();
    await s.t.run(ctx => ctx.db.patch(s.costId, { feesConfirmedZero: true }));
    delete process.env.DELIVERY_AUTOMATION_ENABLED;
    expect((await s.t.run(ctx => retailDetail(ctx, cv.productId)))?.inStock).toBe(false);
    process.env.DELIVERY_AUTOMATION_ENABLED = 'true';
    delete process.env.RETAIL_ZUO_CHECKOUT_ENABLED;
    expect((await s.t.run(ctx => retailDetail(ctx, cv.productId)))?.inStock).toBe(false);
    process.env.RETAIL_ZUO_CHECKOUT_ENABLED = 'true';
    expect(await s.t.query(api.dlvEstimates.productProfile, { productId: String(cv.productId), variantId: 'legacy', channel: 'retail' })).toEqual({ piecesPerPack: 1, minimumPacks: 1, incrementPacks: 1 });
    const tradeUser = await s.t.run(async ctx => {
      const userId = await ctx.db.insert('users', { email: 'trade@example.com' });
      await ctx.db.insert('holmProfiles', { userId, displayName: 'Fixture studio', tradeStatus: 'approved', createdAt: NOW, updatedAt: NOW });
      return userId;
    });
    const tradeClient = s.t.withIdentity({ subject: `${tradeUser}|s`, email: 'trade@example.com' });
    const profileArgs = { productId: String(cv.productId), variantId: 'legacy', channel: 'trade' as const };
    expect(await tradeClient.query(api.dlvEstimates.productProfile, profileArgs)).toEqual({ piecesPerPack: 1, minimumPacks: 1, incrementPacks: 1 });
    delete process.env.DELIVERY_AUTOMATION_ENABLED;
    await expect(tradeClient.query(api.dlvEstimates.productProfile, profileArgs)).rejects.toThrow();
    process.env.DELIVERY_AUTOMATION_ENABLED = 'true';
    const lines = [{ productId: String(cv.productId), variantId: 'legacy', packs: 1 }];
    const retailEstimate = await s.t.run(ctx => estimate(ctx, { lines, channel: 'retail', destination: { zip: '95206' }, service: 'curbside' }, NOW));
    expect(retailEstimate.reasons).toEqual([]);
    expect(retailEstimate).toMatchObject({ status: 'ok', merchandiseMinor: 80000, deliveryMinor: 2900 });
    expect(retailEstimate.groups[0]).toMatchObject({ supplierCode: 'ashcroft', freightMinor: 11900, chargeMinor: 2900 });
    expect(retailEstimate.lines[0].costRevisionId).toBe(s.costId);
    const tradeEstimate = await s.t.run(ctx => estimate(ctx, { lines, channel: 'trade', destination: { zip: '95206' }, service: 'curbside', adminSimulation: true }, NOW));
    expect(tradeEstimate).toMatchObject({ status: 'ok', merchandiseMinor: 60000, deliveryMinor: 2900 });
    expect(tradeEstimate.lines[0].ashcroftEconomics?.commissionBps).toBe(0);
    await expect(s.t.run(ctx => estimate(ctx, { lines, channel: 'trade', destination: { zip: '95206' }, service: 'curbside' }, NOW))).rejects.toThrow(/TRADE_APPROVAL_REQUIRED/);
    const credits = await s.t.run(ctx => estimate(ctx, { lines, channel: 'retail', destination: { zip: '95206' }, service: 'curbside', creditMinor: 40000 }, NOW));
    expect(credits.status).toBe('quote_required');
    await expect(s.t.mutation((await import('./_generated/api')).internal.retailLaunch.createSnapshot, { items: [{ productId: String(cv.productId), variantId: 'legacy', quantity: 1 }] })).rejects.toThrow(/current checkout/);
    await s.t.run(ctx => ctx.db.patch(source, { rows: [{ sku: cv.supplierSku, quantity: 0 }] }));
    expect((await s.t.run(ctx => retailDetail(ctx, cv.productId)))?.inStock).toBe(false);
    await expect(s.t.run(async ctx => approvedAshcroftOffer(ctx, (await ctx.db.get(s.listingId))!, 'legacy', 'retail', NOW))).rejects.toThrow();
    await s.admin.mutation(api.catPublication.rollback, { productId: cv.productId, channel: 'retail', reason: 'Fixture rollback verification' });
    const restored = (await s.t.run(ctx => ctx.db.get(s.listingId)))!;
    expect(restored.snapshot).toEqual(original.snapshot);
    expect(restored.pricingMode).toBeUndefined();
  });

  it('can approve and republish a variant omitted from a prior two-channel publication', async () => {
    const { s, cv, source } = await publicationSetup();
    const second = await s.t.run(async ctx => {
      const listing = (await ctx.db.get(s.listingId))!;
      await ctx.db.patch(listing._id, { snapshot: { ...listing.snapshot, variants: [...listing.snapshot.variants, { ...listing.snapshot.variants[0], id: 'second' }] },
        fulfillment: [...listing.fulfillment!, { ...listing.fulfillment![0], id: 'second', sku: 'BEN-SECOND' }] });
      const next = await ensureAshcroftIdentity(ctx, { productId: cv.productId, variantId: 'second', sku: 'BEN-SECOND', name: 'Second bench', minimum: 1, increment: 1 }, 'fixture');
      const { _id: costId, _creationTime: costTime, ...cost } = (await ctx.db.get(s.costId))!;
      void costId; void costTime;
      const nextCost = await ctx.db.insert('catCostRevisions', { ...cost, variantId: next._id });
      await ctx.db.patch(next._id, { holds: [], currentCostRevisionId: nextCost, marginPolicyKey: 'ashcroft-fixture', referralEligible: true });
      const media = (await ctx.db.query('catMediaAssets').first())!;
      const { _id: imageId, _creationTime: imageTime, ...image } = media;
      void imageId; void imageTime;
      await ctx.db.insert('catMediaAssets', { ...image, verifiedAgainst: { sku: 'BEN-SECOND', pack: '1' } });
      await ctx.db.patch(source, { rows: [{ sku: cv.supplierSku, quantity: 10 }, { sku: 'BEN-SECOND', quantity: 10 }] });
      return next;
    });
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: second._id, channel: 'retail', packPriceMinor: 80000, reason: 'Fixture retail price' });
    const request = { productIds: [cv.productId], channels: ['retail', 'house'] as ('retail' | 'house')[] };
    expect((await s.admin.mutation(api.catPublication.publish, request))[0].variants).toBe(1);
    expect((await s.t.run(ctx => ctx.db.get(s.listingId)))!.snapshot.variants.map(v => v.id)).toEqual(['legacy']);
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: second._id, channel: 'trade', packPriceMinor: 60000, reason: 'Fixture later trade price' });
    expect((await s.admin.mutation(api.catPublication.publish, request))[0].variants).toBe(2);
    expect((await s.t.run(ctx => ctx.db.get(s.listingId)))!.snapshot.variants.map(v => v.id)).toContain('second');
  });

  it('rejects mismatched channel delivery and an inconsistent single-channel rollback atomically', async () => {
    const { s, cv } = await publicationSetup();
    await s.admin.mutation(api.catPublication.publish, { productIds: [cv.productId], channels: ['retail', 'house'] });
    const house = (await s.t.run(ctx => ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', cv.productId).eq('channel', 'house')).unique()))!;
    await s.t.run(ctx => ctx.db.patch(house._id, { snapshot: { ...house.snapshot, category: 'sofa', name: 'Fixture sofa' } }));
    await expect(s.t.run(async ctx => approvedAshcroftOffer(ctx, (await ctx.db.get(house._id))!, 'legacy', 'trade', NOW))).rejects.toThrow(/delivery/);
    const before = await s.t.run(ctx => ctx.db.get(s.listingId));
    await expect(s.admin.mutation(api.catPublication.rollback, { productId: cv.productId, channel: 'retail', reason: 'Fixture inconsistent rollback' })).rejects.toThrow(/delivery models differ/);
    expect(await s.t.run(ctx => ctx.db.get(s.listingId))).toEqual(before);
  });

  it('does not let inventory observations hide a conflicting cost source', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const cv = (await ctx.db.get(s.variantId))!;
      const base = { supplierId: cv.supplierId, variantId: cv._id, contentHash: 'fixture', verifier: 'fixture', createdAt: NOW };
      await ctx.db.insert('catSourceObservations', { ...base, field: 'wholesale', extractedValue: '300', observedAt: NOW - 1000, confidence: 'conflict' });
      for (let i = 0; i < 205; i++) await ctx.db.insert('catSourceObservations', { ...base, field: 'stock', extractedValue: 'in_stock', observedAt: NOW - 500 + i, confidence: 'confirmed' });
    });
    await expect(s.compute()).rejects.toThrow(/COST_CONFLICT/);
  });
  it('requires review instead of silently truncating excessive cost history', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const cv = (await ctx.db.get(s.variantId))!;
      for (let i = 0; i < 201; i++) await ctx.db.insert('catSourceObservations', { supplierId: cv.supplierId, variantId: cv._id,
        contentHash: `fixture-${i}`, verifier: 'fixture', createdAt: NOW, field: 'wholesale', extractedValue: '300', observedAt: NOW, confidence: 'confirmed' });
    });
    await expect(s.compute()).rejects.toThrow(/history/);
  });
  it('accepts a proven latest cost observation with strictly older history', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const cv = (await ctx.db.get(s.variantId))!;
      for (let i = 0; i < 205; i++) await ctx.db.insert('catSourceObservations', { supplierId: cv.supplierId, variantId: cv._id,
        contentHash: `fixture-${i}`, verifier: 'fixture', createdAt: NOW, field: 'wholesale', extractedValue: '300', observedAt: NOW - i, confidence: 'confirmed' });
    });
    expect((await s.compute()).minimumRetailMinor).toBe(76956);
  });
  it('keeps candidates unapproved, uses selling-unit costs and persists the correct engine version', async () => {
    const s = await setup();
    const before = await s.t.run(ctx => ctx.db.get(s.listingId));
    expect(await s.compute()).toMatchObject({ minimumRetailMinor: 76956, minimumTradeMinor: 57168, retailApproved: false, tradeApproved: false, referralQualified: false, engineVersion: 'ashcroft-selling-unit-1' });
    await expect(s.qualify('retail')).rejects.toThrow(/approved retail/);
    await s.t.run(ctx => recordScenarios(ctx, s.variantId, 'fixture'));
    expect((await s.t.run(ctx => ctx.db.query('catScenarioResults').first()))?.engineVersion).toBe('ashcroft-selling-unit-1');
    expect(await s.t.run(ctx => ctx.db.get(s.listingId))).toEqual(before);
  });
  it('approves independent channel prices without rewriting legacy listings or applying commission to trade', async () => {
    const s = await setup();
    const before = await s.t.run(ctx => ctx.db.get(s.listingId));
    const retailId = await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'retail', packPriceMinor: 80000, reason: 'Fixture funded price' });
    await expect(s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'trade', packPriceMinor: 59000, reason: 'Fixture exceeds permitted base discount' })).rejects.toThrow(/minimum/);
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'trade', packPriceMinor: 60000, reason: 'Fixture funded trade price' });
    expect((await s.t.run(ctx => ctx.db.get(retailId)))?.informationUnitBasis).toBe('selling_unit');
    expect((await s.qualify('retail')).referralQualified).toBe(true);
    expect((await s.qualify('trade')).scenarios.find(r => r.name === 'trade_approved')).toMatchObject({ contributionMinor: 13983, passes: true });
    expect(await s.t.run(ctx => ctx.db.get(s.listingId))).toEqual(before);
    await s.t.run(ctx => ctx.db.patch(s.costId, { wholesaleMinor: 50000, wholesalePrecise: '500' }));
    await expect(s.qualify('trade')).rejects.toThrow(/does not fund/);
  });
  it.each(['basis', 'unknown-fee', 'stale', 'map', 'map-basis', 'category', 'identity', 'option-key', 'pack-id', 'zuo-policy', 'proposed-settings'])('rejects %s evidence or policy', async state => {
    const s = await setup();
    await s.t.run(async ctx => {
      if (state === 'basis') await ctx.db.patch(s.costId, { wholesaleUnitBasis: undefined });
      if (state === 'unknown-fee') await ctx.db.patch(s.costId, { feesConfirmedZero: false });
      if (state === 'stale') await ctx.db.patch(s.costId, { effectiveTo: NOW });
      if (state === 'map') await ctx.db.patch(s.costId, { mapApplicability: 'unknown' });
      if (state === 'map-basis') await ctx.db.patch(s.costId, { mapApplicability: 'applies', mapMinor: 50000, mapSource: 'explicit_sku', mapUnitBasis: 'piece' });
      if (state === 'category') await ctx.db.patch(s.metaId, { commissionCategory: 'review_required' });
      if (state === 'identity') await ctx.db.patch(s.variantId, { supplierSku: 'OTHER' });
      if (state === 'option-key') await ctx.db.patch(s.variantId, { optionKey: 'OTHER' });
      if (state === 'pack-id') await ctx.db.patch(s.variantId, { packId: '2' });
      if (state === 'zuo-policy') await ctx.db.patch(s.variantId, { marginPolicyKey: 'zuo-standard-20' });
      if (state === 'proposed-settings') await ctx.db.patch(s.assumptionId, { status: 'proposed' });
    });
    await expect(s.compute()).rejects.toThrow();
  });
  it('requires the reviewed lighting correction before qualifying decor pricing', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const listing = (await ctx.db.get(s.listingId))!;
      await ctx.db.patch(s.listingId, { snapshot: { ...listing.snapshot, category: 'lighting', name: 'Fixture floor lamp' } });
    });
    await expect(s.compute()).rejects.toThrow(/audited category correction/);
    await s.t.run(async ctx => {
      const meta = (await ctx.db.get(s.metaId))!;
      await ctx.db.patch(meta._id, { commissionCategory: 'decor' });
      await ctx.db.insert('sysAuditEvents', { actor: 'fixture', action: 'category.commit', entityTable: 'commerceProducts', entityId: meta.productId,
        before: 'furniture', after: 'decor', at: NOW });
    });
    const result = await s.compute();
    expect(result.category).toBe('decor');
    expect(result.minimumRetailMinor).toBeLessThan(76956);
    expect(result.retailApproved).toBe(false);
  });
});

describe('reviewed SKU approvals', () => {
  it('binds approvals to current evidence, supports stable reads, and separates finance from approval', async () => {
    const s = await setup();
    const args = { variantId: s.variantId };
    await expect(s.t.query(api.catPricing.review, args)).rejects.toThrow();
    const review = await s.admin.query(api.catPricing.review, args);
    expect(review.canApprove).toBe(true);
    expect(review.commission).toMatchObject({ ok: true, rates: [{ tierKey: 'base', rateBps: 1000 }, { tierKey: 'active', rateBps: 1200 }, { tierKey: 'top', rateBps: 1500 }, { tierKey: 'elite', rateBps: 1800 }] });
    vi.setSystemTime(NOW + 1000);
    expect((await s.admin.query(api.catPricing.review, args)).reviewHash).toBe(review.reviewHash);
    const approval = { ...args, expectedReviewHash: review.reviewHash, channel: 'retail' as const, packPriceMinor: 85000, reason: 'Reviewed funded final price' };
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ 'owner@example.com': ['finance'] });
    expect((await s.admin.query(api.catPricing.review, args)).canApprove).toBe(false);
    await expect(s.admin.mutation(api.catPricing.approvePrice, approval)).rejects.toThrow(/staff role/);
    await expect(s.admin.mutation(api.prgLinks.setReferralEligibility, { ...args, eligible: false, reason: 'Finance cannot change eligibility' })).rejects.toThrow(/staff role/);
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ 'owner@example.com': ['support'] });
    await expect(s.admin.query(api.catPricing.review, args)).rejects.toThrow();
    delete process.env.DELIVERY_ADMIN_ROLES;
    await s.t.run(ctx => ctx.db.patch(s.costId, { wholesaleMinor: 31000, wholesalePrecise: '310' }));
    await expect(s.admin.mutation(api.catPricing.approvePrice, approval)).rejects.toThrow(/changed/);
    await expect(s.admin.mutation(api.catPricing.assignPolicy, { ...args, policyKey: 'ashcroft-fixture', reason: 'Reviewed policy', expectedReviewHash: review.reviewHash })).rejects.toThrow(/changed/);
    expect((await s.t.run(ctx => ctx.db.get(s.variantId)))!.retailPriceRevisionId).toBeUndefined();
    const latest = await s.admin.query(api.catPricing.review, args);
    const id = await s.admin.mutation(api.catPricing.approvePrice, { ...approval, expectedReviewHash: latest.reviewHash });
    expect((await s.admin.query(api.catPricing.review, args)).prices.retail?._id).toBe(id);
    expect((await s.t.run(ctx => ctx.db.get(s.listingId)))!.snapshot.variants[0].price).toBe(60000);
  });

  it('requires full funded Ashcroft economics before enabling referrals and preserves failed activation atomically', async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      const cv = (await ctx.db.get(s.variantId))!;
      await ctx.db.patch(cv._id, { referralEligible: false, holds: [] });
      await ctx.db.insert('ashcroftInventoryFeeds', { source: 'Fixture current source', sha256: 'a'.repeat(64), observedAt: NOW - 1000, validUntil: NOW + 3600000, importedAt: NOW, rows: [{ sku: cv.supplierSku, quantity: 10 }] });
    });
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'retail', packPriceMinor: 60000, reason: 'Fixture direct sale only' });
    const before = await s.t.run(ctx => ctx.db.query('sysAuditEvents').collect());
    const review = await s.admin.query(api.catPricing.review, { variantId: s.variantId });
    await expect(s.admin.mutation(api.prgLinks.setReferralEligibility, { variantId: s.variantId, eligible: true, reason: 'Attempt unfunded full schedule', expectedReviewHash: review.reviewHash })).rejects.toThrow(/does not fund/);
    expect((await s.t.run(ctx => ctx.db.get(s.variantId)))!.referralEligible).toBe(false);
    expect(await s.t.run(ctx => ctx.db.query('sysAuditEvents').collect())).toEqual(before);
    await s.admin.mutation(api.catPricing.approvePrice, { variantId: s.variantId, channel: 'retail', packPriceMinor: 85000, reason: 'Fixture fully funded rate' });
    await s.admin.mutation(api.prgLinks.setReferralEligibility, { variantId: s.variantId, eligible: true, reason: 'Full advertised schedule funded' });
    expect((await s.t.run(ctx => ctx.db.get(s.variantId)))!.referralEligible).toBe(true);
  });

  it('binds product-wide exceptions to a matching current review and keeps all four rates explicit', async () => {
    const s = await setup();
    const cv = (await s.t.run(ctx => ctx.db.get(s.variantId)))!;
    const review = await s.admin.query(api.catPricing.review, { variantId: cv._id });
    const args = { productId: cv.productId, reviewVariantId: cv._id, expectedReviewHash: review.reviewHash,
      rates: (['base','active','top','elite'] as const).map(tierKey => ({ tierKey, rateBps: 500 })), visibleNote: 'Visible fixture exception' };
    await s.admin.mutation(api.prgLinks.createException, args);
    await expect(s.admin.mutation(api.prgLinks.createException, args)).rejects.toThrow(/changed/);
    const after = await s.admin.query(api.catPricing.review, { variantId: cv._id });
    expect(after.exceptions).toHaveLength(1);
    expect(after.commission).toMatchObject({ ok: true, rates: args.rates });
    await expect(s.admin.mutation(api.prgLinks.createException, { ...args, expectedReviewHash: after.reviewHash, rates: args.rates.slice(0, 3) })).rejects.toThrow(/four tiers/);
  });
});

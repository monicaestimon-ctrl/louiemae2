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
afterEach(() => { vi.useRealTimers(); delete process.env.CJ_ADMIN_EMAILS; });

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

describe('Ashcroft supplier-specific qualification', () => {
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

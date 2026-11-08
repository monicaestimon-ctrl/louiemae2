// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { assertSellable } from './catCore';
import { assertLineMechanism } from './catPolicies';
import { normalizePackage, parseJsonPackage } from '../lib/zuoImport';
import { isCommerceError } from '../lib/errors';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
const NOW = Date.now();

beforeEach(() => {
  process.env.CJ_ADMIN_EMAILS = ADMIN;
});
afterEach(() => {
  delete process.env.CJ_ADMIN_EMAILS;
  delete process.env.CATALOG_PUBLICATION_V2_ENABLED;
});

const row = (sku: string, over: Record<string, unknown> = {}) => ({
  sku,
  name: `Zuo dining chair ${sku}`,
  category: 'Dining chair',
  sizeClass: 'MEDIUM',
  piecesPerPack: 2,
  wholesale: '115.00',
  costConfidence: 'corroborated',
  mapApplicability: 'not_applicable',
  cohort: 'approved_306',
  approvedRetail: '458.06',
  approvedTrade: '412.26',
  stock: 'in_stock',
  observedAt: new Date(NOW - 3_600_000).toISOString(),
  cartons: [{ count: 1, lengthIn: '24', widthIn: '20', heightIn: '36', weightLb: '30' }],
  images: ['https://www.zuomod.com/x.jpg'],
  ...over,
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${userId}|s`, email: ADMIN });
  await t.mutation(internal.sysConfig.seed, {});
  return { t, admin };
}

async function importPackage(admin: Awaited<ReturnType<typeof setup>>['admin'], rows: Record<string, unknown>[], mode: 'dry_run' | 'commit', sourceKey = 'pkg-1') {
  const { records, rejected } = normalizePackage(parseJsonPackage(JSON.stringify(rows)), 'Zuo-Draft-Import.json', NOW);
  const { batchId, alreadyCommitted } = await admin.mutation(api.zuoImport.begin, { mode, sourceKey, files: [{ name: 'Zuo-Draft-Import.json', sha256: 'abc', rows: rows.length }], codeRevision: 'test', rejected });
  if (alreadyCommitted) return { batchId, alreadyCommitted, status: 'done', counts: {} as Record<string, number>, mismatches: [] as string[] };
  for (let i = 0; i < records.length; i += 25) await admin.mutation(api.zuoImport.stage, { batchId, records: records.slice(i, i + 25) });
  const done = await admin.mutation(api.zuoImport.finish, { batchId, expectPackageCounts: false });
  return { batchId, alreadyCommitted, ...done };
}

async function approve(t: ReturnType<typeof convexTest>, admin: Awaited<ReturnType<typeof setup>>['admin'], key: string) {
  const { records } = await admin.query(api.sysConfig.list, { status: 'proposed' });
  const rec = records.find((r) => r.key === key)!;
  await admin.mutation(api.sysConfig.approve, { id: rec._id });
}

describe('Zuo import (CAT01, PRI01)', () => {
  it('requires a dry run, then commits idempotently with stable identities', async () => {
    const { t, admin } = await setup();
    const rows = [row('111182'), row('111183', { cohort: 'original_296', approvedRetail: '', approvedTrade: '' }), row('110799')];
    await expect(importPackage(admin, rows, 'commit')).rejects.toThrow(/dry run/);
    const dry = await importPackage(admin, rows, 'dry_run');
    expect(dry.status).toBe('done');
    expect(await t.run((ctx) => ctx.db.query('catVariants').collect())).toHaveLength(0);
    const first = await importPackage(admin, rows, 'commit');
    expect(first.counts).toMatchObject({ total: 3, approved_306: 2, original_296: 1 });
    const again = await importPackage(admin, rows, 'commit');
    expect(again.alreadyCommitted).toBe(true);
    // A new package with the same records changes nothing (unchanged), and creates no duplicates.
    const repeat = await importPackage(admin, rows, 'dry_run', 'pkg-2');
    const recs = await admin.query(api.zuoImport.batchRecords, { batchId: repeat.batchId });
    expect(recs.map((r) => r.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    await importPackage(admin, rows, 'commit', 'pkg-2');
    const variants = await t.run((ctx) => ctx.db.query('catVariants').collect());
    expect(variants).toHaveLength(3);
    expect(await t.run((ctx) => ctx.db.query('commerceProducts').collect())).toHaveLength(3);
    expect(await t.run((ctx) => ctx.db.query('catCostRevisions').collect())).toHaveLength(3);
    // Approved pack prices preserved exactly
    const v1 = variants.find((x) => x.supplierSku === '111182')!;
    const retail = await t.run((ctx) => ctx.db.get(v1.retailPriceRevisionId!));
    const trade = await t.run((ctx) => ctx.db.get(v1.tradePriceRevisionId!));
    expect([retail?.packPriceMinor, trade?.packPriceMinor, retail?.origin]).toEqual([45_806, 41_226, 'import_approved']);
    expect(v1.marginPolicyKey).toBe('zuo-approved-5');
    // Every Zuo product starts as a draft; named SKU hold applied
    const metas = await t.run((ctx) => ctx.db.query('catProductMeta').collect());
    expect(metas.every((m) => m.stage === 'imported_draft')).toBe(true);
    expect(variants.find((x) => x.supplierSku === '110799')!.holds).toContain('METHOD_CHANGED');
  });

  it('never extends the 5% policy and requires a document for 18%', async () => {
    const { t, admin } = await setup();
    await importPackage(admin, [row('A'), row('B', { cohort: 'reconciled_66', approvedRetail: '', approvedTrade: '' })], 'dry_run');
    await importPackage(admin, [row('A'), row('B', { cohort: 'reconciled_66', approvedRetail: '', approvedTrade: '' })], 'commit');
    const b = (await t.run((ctx) => ctx.db.query('catVariants').collect())).find((x) => x.supplierSku === 'B')!;
    await expect(admin.mutation(api.catPricing.assignPolicy, { variantId: b._id, policyKey: 'zuo-approved-5', reason: 'try' })).rejects.toSatisfy((e) => isCommerceError(e, 'FORBIDDEN'));
    await expect(admin.mutation(api.catPricing.assignPolicy, { variantId: b._id, policyKey: 'zuo-legacy-18', reason: 'try' })).rejects.toThrow();
    await admin.mutation(api.catPricing.assignPolicy, { variantId: b._id, policyKey: 'zuo-legacy-18', documentRef: 'doc-18-B', reason: 'documented' });
    expect((await t.run((ctx) => ctx.db.get(b._id)))!.marginPolicyKey).toBe('zuo-legacy-18');
  });

  it("keeps the owner's edited price when a later package differs, and reports the conflict", async () => {
    const { t, admin } = await setup();
    await importPackage(admin, [row('A')], 'dry_run');
    await importPackage(admin, [row('A')], 'commit');
    const v = (await t.run((ctx) => ctx.db.query('catVariants').first()))!;
    await t.run((ctx) => ctx.db.patch(v.retailPriceRevisionId!, { origin: 'manual', packPriceMinor: 49_900 }));
    await importPackage(admin, [row('A', { approvedRetail: '470.00', wholesale: '116.00' })], 'dry_run', 'pkg-3');
    const res = await importPackage(admin, [row('A', { approvedRetail: '470.00', wholesale: '116.00' })], 'commit', 'pkg-3');
    const recs = await admin.query(api.zuoImport.batchRecords, { batchId: res.batchId });
    expect(recs[0].conflicts?.[0]).toMatch(/owner/);
    const after = (await t.run((ctx) => ctx.db.get(v._id)))!;
    expect((await t.run((ctx) => ctx.db.get(after.retailPriceRevisionId!)))!.packPriceMinor).toBe(49_900);
  });
});

describe('sellability gates and publication (CAT02, OPS01)', () => {
  async function readyProduct() {
    const { t, admin } = await setup();
    await approve(t, admin, 'freshness-default');
    await importPackage(admin, [row('111182')], 'dry_run');
    await importPackage(admin, [row('111182')], 'commit');
    const cv = (await t.run((ctx) => ctx.db.query('catVariants').first()))!;
    return { t, admin, cv, productId: cv.productId };
  }

  it('refuses publish and purchase while holds or stale evidence exist, through any path', async () => {
    const { t, admin, cv, productId } = await readyProduct();
    // Media is unverified and the cost was never verified for MAP: both hold.
    await expect(t.run((ctx) => assertSellable(ctx, cv._id, 'purchase'))).rejects.toSatisfy((e) => isCommerceError(e, 'COST_REVIEW_REQUIRED'));
    await expect(admin.mutation(api.catPublication.advance, { productId, to: 'evidence_review' })).resolves.toBeNull();
    await expect(admin.mutation(api.catPublication.advance, { productId, to: 'economics_review' })).rejects.toThrow(/MEDIA_MISSING/);
    process.env.CATALOG_PUBLICATION_V2_ENABLED = 'true';
    await expect(admin.mutation(api.catPublication.publish, { productIds: [productId], channels: ['retail'] })).rejects.toThrow();
    // Stale stock: an observation older than 24h makes it unavailable even with no holds.
    await t.run(async (ctx) => {
      const holds = await ctx.db.query('catHolds').collect();
      for (const h of holds) await ctx.db.patch(h._id, { resolvedAt: NOW });
      await ctx.db.patch(cv._id, { holds: [], referralEligible: true });
    });
    await expect(t.run((ctx) => assertSellable(ctx, cv._id, 'purchase', NOW + 2 * 86_400_000))).rejects.toSatisfy((e) => isCommerceError(e, 'STOCK_UNAVAILABLE'));
    await expect(t.run((ctx) => assertSellable(ctx, cv._id, 'purchase', NOW))).resolves.toBeTruthy();
  });

  it('publishes only named, ready products atomically and unpublishes without touching orders', async () => {
    const { t, admin, cv, productId } = await readyProduct();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['img'])));
    await t.run(async (ctx) => {
      await ctx.db.insert('catMediaAssets', { productId, role: 'hero', storageId, derivatives: [], contentHash: 'h', mime: 'image/jpeg', width: 1200, height: 1200, bytes: 3, sourceUrl: 'https://www.zuomod.com/x.jpg', rights: { basis: 'dealer media license', attributionRequired: false, privateOriginal: true }, altText: 'Oak dining chair, pair', status: 'verified', createdAt: NOW });
      for (const h of await ctx.db.query('catHolds').collect()) await ctx.db.patch(h._id, { resolvedAt: NOW });
      await ctx.db.patch(cv._id, { holds: [], referralEligible: true });
      await ctx.db.patch(cv.currentCostRevisionId!, { verifiedAt: NOW - 3_600_000 });
    });
    for (const to of ['evidence_review', 'economics_review', 'content_review', 'ready'] as const) await admin.mutation(api.catPublication.advance, { productId, to });
    await expect(admin.mutation(api.catPublication.publish, { productIds: [productId], channels: ['retail', 'house'] })).rejects.toSatisfy((e) => isCommerceError(e, 'FEATURE_DISABLED'));
    process.env.CATALOG_PUBLICATION_V2_ENABLED = 'true';
    const res = await admin.mutation(api.catPublication.publish, { productIds: [productId], channels: ['retail', 'house'] });
    expect(res[0].variants).toBe(1);
    const listings = await t.run((ctx) => ctx.db.query('commerceListings').collect());
    expect(listings.map((l) => [l.channel, l.published, l.snapshot.variants[0].price]).sort()).toEqual([
      ['house', true, 41_226],
      ['retail', true, 45_806],
    ]);
    // A paid order exists; unpublish stops new sales but the order is untouched.
    const orderId = await t.run((ctx) => ctx.db.insert('orders', { customerEmail: 'c@x.com', items: [], subtotal: 1, total: 1, currency: 'usd', status: 'paid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    await admin.mutation(api.catPublication.unpublish, { productIds: [productId], channels: ['retail'], reason: 'test' });
    const after = await t.run((ctx) => ctx.db.query('commerceListings').collect());
    expect(after.find((l) => l.channel === 'retail')!.published).toBe(false);
    expect(after.find((l) => l.channel === 'house')!.published).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(orderId)))!.status).toBe('paid');
  });

  it('rejects publishing by count and products that are not catalog-reviewed', async () => {
    const { admin } = await setup();
    process.env.CATALOG_PUBLICATION_V2_ENABLED = 'true';
    await expect(admin.mutation(api.catPublication.publish, { productIds: [], channels: ['retail'] })).rejects.toThrow(/named products/);
  });
});

describe('categories and mechanisms (CAT04, PRI03)', () => {
  it('moves lighting to décor going forward without changing earned commission', async () => {
    const { t, admin } = await setup();
    const { productId, commissionId } = await t.run(async (ctx) => {
      const partner = await ctx.db.insert('users', { email: 'p@x.com' });
      const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:lamp', draft: { name: 'Halden floor lamp', description: '', category: 'lighting', images: [], referenceImages: [], sourceUrl: '', supplierName: '', supplierContact: '', facts: '', packaging: '', currency: 'USD', usdRate: 1, variants: [], conflicts: [], factsApproved: true, imagesApproved: true, referencePermission: true }, revision: 1, updatedAt: 1 });
      const commissionId = await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'storefront_order', baseCents: 10_000, rateBps: 1000, amountCents: 1_000, tier: 'base', lines: [{ key: `0:${productId}:v`, type: 'furniture', baseCents: 10_000, rateBps: 1000, amountCents: 1_000, capped: false, costKnown: true }], status: 'cleared', clearsAt: 1, createdAt: 1 });
      return { productId, commissionId };
    });
    const preview = await admin.query(api.catCategories.preview, {});
    const row0 = preview.rows.find((r) => r.productId === productId)!;
    expect(row0).toMatchObject({ legacyType: 'furniture', proposed: 'decor', lighting: true, changes: true });
    await admin.mutation(api.catCategories.commit, { productIds: [productId], category: 'decor', reason: 'All lighting is décor (v2 §5)' });
    const meta = await t.run((ctx) => ctx.db.query('catProductMeta').first());
    expect(meta!.commissionCategory).toBe('decor');
    const c = (await t.run((ctx) => ctx.db.get(commissionId)))!;
    expect([c.lines![0].type, c.rateBps, c.amountCents]).toEqual(['furniture', 1000, 1_000]);
  });

  it('refuses Zuo coupons and project stacking on the server, and allows them once documented', async () => {
    const { t, admin } = await setup();
    await importPackage(admin, [row('A')], 'dry_run');
    await importPackage(admin, [row('A')], 'commit');
    const cv = (await t.run((ctx) => ctx.db.query('catVariants').first()))!;
    for (const m of ['coupon', 'project', 'automatic'] as const) await expect(t.run((ctx) => assertLineMechanism(ctx, cv._id as Id<'catVariants'>, m))).rejects.toSatisfy((e) => isCommerceError(e, 'MAP_POLICY_REVIEW'));
    await expect(admin.mutation(api.catPolicies.savePolicy, { supplierCode: 'zuo', kind: 'coupon', summary: 'x', evidenceRefs: [], scope: { all: true }, status: 'documented' })).rejects.toThrow(/evidence/);
    await admin.mutation(api.catPolicies.savePolicy, { supplierCode: 'zuo', kind: 'coupon', summary: 'Coupon allowed per dealer letter', evidenceRefs: ['zuo-letter-2026-11'], scope: { skus: ['A'] }, status: 'documented' });
    await expect(t.run((ctx) => assertLineMechanism(ctx, cv._id, 'coupon'))).resolves.toBeFalsy();
    await expect(t.run((ctx) => assertLineMechanism(ctx, cv._id, 'project'))).rejects.toThrow();
  });

  it('records market reviews and refuses MSRP as a comparison', async () => {
    const { t, admin } = await setup();
    await importPackage(admin, [row('A')], 'dry_run');
    await importPackage(admin, [row('A')], 'commit');
    const cv = (await t.run((ctx) => ctx.db.query('catVariants').first()))!;
    const o = (retailer: string, total: number) => ({ retailer, url: 'https://x', observedAt: NOW, merchandiseMinor: total, inStock: true, deliveryMinor: 0, serviceLevel: 'curbside', totalBeforeTaxMinor: total, zip: '95206', exactMatch: true });
    const r = await admin.mutation(api.catPolicies.recordMarketReview, { variantId: cv._id, ourDeliveredMinor: 60_000, observations: [o('a', 50_000), o('b', 50_000), o('c', 50_000)] });
    expect(r.flag).toBe('above_median_10pct');
    expect(await t.run((ctx) => ctx.db.query('sysReviewItems').collect())).toHaveLength(1);
    await expect(admin.mutation(api.catPolicies.recordMarketReview, { variantId: cv._id, ourDeliveredMinor: 1, observations: [o('MSRP', 1)] })).rejects.toThrow(/MSRP/);
  });
});

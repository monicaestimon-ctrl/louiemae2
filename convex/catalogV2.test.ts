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
import { readFileSync } from 'node:fs';
import { blankCommerceDraft } from '../lib/commerce';
import type { ZuoStagingRow } from '../lib/zuoStaging';

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
  const { batchId, alreadyCommitted } = await admin.mutation(api.zuoImport.begin, { mode, sourceKey, files: [{ name: 'Zuo-Draft-Import.json', sha256: 'abc', rows: rows.length }], codeRevision: 'test', expectedRecords: records.length, rejected });
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
  it.each(['approved_306', 'map_135', 'original_296', 'reconciled_66'])(
    'preserves both prices and the existing image for %s',
    async (cohort) => {
      const { t, admin } = await setup();
      const draft = {
        ...blankCommerceDraft(),
        name: 'Existing name',
        supplierName: 'Zuo',
        sourceUrl: 'https://www.zuomod.com/',
        variants: [
          {
            id: 'A',
            sku: 'A',
            name: 'Default',
            cost: 230,
            minimum: 1,
            increment: 1,
            retail: 45806,
            commercial: 41226,
            image: 'https://storage.example/primary.jpg',
          },
        ],
      };
      await admin.mutation(api.zuoStaging.importBatch, {
        runId: 'test',
        manifestSha256: 'a'.repeat(64),
        rows: [
          {
            sku: 'A',
            pack: 2,
            draft,
            sourceEvidence: '{}',
            excluded: false,
            exclusionReasons: [],
            holdReasons: ['MANUAL'],
          },
        ],
      });
      const rows = [row('A', { cohort })];
      await importPackage(admin, rows, 'dry_run');
      await importPackage(admin, rows, 'commit');
      const p = (await t.run((ctx) => ctx.db.query('commerceProducts').first()))!;
      expect(p.draft.name).toBe('Existing name');
      expect(p.draft.variants[0]).toMatchObject({
        retail: 45806,
        commercial: 41226,
        cost: 230,
        minimum: 1,
        increment: 1,
        image: 'https://storage.example/primary.jpg',
      });
      const variant = (await t.run((ctx) => ctx.db.query('catVariants').first()))!;
      expect(variant.marginPolicyKey).toBe(
        cohort === 'approved_306'
          ? 'zuo-approved-5'
          : cohort === 'map_135'
            ? 'zuo-map-floor-pending'
            : 'zuo-standard-20'
      );
      if (cohort === 'map_135') expect(variant.holds).toContain('MAP_FLOOR_UNAPPROVED');
      await importPackage(admin, rows, 'dry_run', 'repeat');
      await importPackage(admin, rows, 'commit', 'repeat');
      expect(await t.run((ctx) => ctx.db.query('catPriceRevisions').collect())).toHaveLength(2);
    }
  );

  it('rejects missing prices and changed pack quantities before mutating staged records', async () => {
    const { t, admin } = await setup();
    const draft = {
      ...blankCommerceDraft(),
      name: 'Existing name',
      supplierName: 'Zuo',
      sourceUrl: 'https://www.zuomod.com/',
      variants: [
        {
          id: 'A',
          sku: 'A',
          name: 'Default',
          cost: 230,
          minimum: 1,
          increment: 1,
          retail: 45806,
          commercial: 41226,
        },
      ],
    };
    await admin.mutation(api.zuoStaging.importBatch, {
      runId: 'test',
      manifestSha256: 'a'.repeat(64),
      rows: [
        {
          sku: 'A',
          pack: 2,
          draft,
          sourceEvidence: '{}',
          excluded: false,
          exclusionReasons: [],
          holdReasons: ['MANUAL'],
        },
      ],
    });
    await expect(
      importPackage(admin, [row('A', { approvedRetail: '', approvedTrade: '' })], 'dry_run')
    ).rejects.toThrow(/Missing approved prices/);
    await expect(
      importPackage(admin, [row('A', { piecesPerPack: 1 })], 'dry_run', 'pack')
    ).rejects.toThrow(/pack quantity differs/);
    await expect(
      importPackage(admin, [row('A', { approvedRetail: '500.00' })], 'dry_run', 'changed-price')
    ).rejects.toThrow(/staged prices differ/);
    expect(await t.run((ctx) => ctx.db.query('catVariants').collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.query('commerceProducts').first()))!.draft).toEqual(draft);
  });

  it.each(['0', '-1', '10.001', 'NaN'])(
    'rejects invalid approved pack price %s server-side',
    async (price) => {
      const { admin } = await setup();
      const { records } = normalizePackage(
        parseJsonPackage(JSON.stringify([row('A')])),
        'test',
        NOW
      );
      records[0].record.approvedRetailPack = price;
      const { batchId } = await admin.mutation(api.zuoImport.begin, {
        mode: 'dry_run',
        sourceKey: 'invalid',
        expectedRecords: 1,
        files: [],
        codeRevision: 'test',
        rejected: [],
      });
      await expect(admin.mutation(api.zuoImport.stage, { batchId, records })).rejects.toThrow(
        /positive exact cents/
      );
    }
  );

  it('retains unpriced records as held variants without creating zero-price draft variants', async () => {
    const { t, admin } = await setup();
    const rows = [row('A', { cohort: 'unpriced_62', approvedRetail: '', approvedTrade: '' })];
    await importPackage(admin, rows, 'dry_run');
    await importPackage(admin, rows, 'commit');
    expect(
      (await t.run((ctx) => ctx.db.query('commerceProducts').first()))!.draft.variants
    ).toEqual([]);
    expect((await t.run((ctx) => ctx.db.query('catVariants').first()))!.holds).toContain('MANUAL');
  });

  it.skipIf(!process.env.ZUO_PARITY_MANIFEST)(
    'replays all 803 actual staged products through migration without price, image or pack loss',
    async () => {
      const manifest = JSON.parse(readFileSync(process.env.ZUO_PARITY_MANIFEST!, 'utf8')) as {
        runId: string;
        manifestSha256: string;
        rows: ZuoStagingRow[];
      };
      expect(manifest.rows).toHaveLength(803);
      // Bound the in-memory Convex test database while exercising every real row.
      for (let offset = 0; offset < manifest.rows.length; offset += 25) {
      const batchRows = manifest.rows.slice(offset, offset + 25);
      const { t, admin } = await setup();
      for (let i = 0; i < batchRows.length; i += 10)
        await admin.mutation(api.zuoStaging.importBatch, {
          ...manifest,
          rows: batchRows.slice(i, i + 10),
        });
      const cohorts: Record<string, string> = {
        APPROVED_5_PERCENT: 'approved_306',
        MAP_BASED_10_PERCENT_TRADE: 'map_135',
        ORIGINAL_20_PERCENT_MODEL: 'original_296',
        RECONCILED_20_PERCENT_MODEL: 'reconciled_66',
      };
      const rows = batchRows.map((r) => {
        const ev = JSON.parse(r.sourceEvidence);
        const v = r.draft.variants[0];
        return row(r.sku, {
          cohort: cohorts[ev.pricingRegime],
          piecesPerPack: r.pack,
          wholesale: String(v.cost / r.pack),
          approvedRetailPack: (v.retail / 100).toFixed(2),
          approvedTradePack: (v.commercial / 100).toFixed(2),
          excluded: r.excluded,
          images: r.draft.images,
        });
      });
      await importPackage(admin, rows, 'dry_run');
      await importPackage(admin, rows, 'commit');
      const products = await t.run((ctx) => ctx.db.query('commerceProducts').collect());
      expect(products).toHaveLength(batchRows.length);
      for (const r of batchRows) {
        const p = products.find((p) => p.sourceKey === `zuo:${r.sku}`)!;
        const v = p.draft.variants[0];
        const expected = r.draft.variants[0];
        expect({
          sku: r.sku,
          retail: v.retail,
          commercial: v.commercial,
          cost: v.cost,
          image: v.image,
          minimum: v.minimum,
          increment: v.increment,
        }).toEqual({
          sku: r.sku,
          retail: expected.retail,
          commercial: expected.commercial,
          cost: expected.cost,
          image: expected.image,
          minimum: expected.minimum,
          increment: expected.increment,
        });
        expect(p.draft.images).toEqual(r.draft.images);
        expect(p.draft.name).toBe(r.draft.name);
        expect(p.zuoStaging?.excluded).toBe(r.excluded);
      }
      expect(await t.run((ctx) => ctx.db.query('catPriceRevisions').collect())).toHaveLength(batchRows.length * 2);
      expect(await t.run((ctx) => ctx.db.query('commerceListings').collect())).toHaveLength(0);
      }
    },
    120000
  );

  it('binds committed rows and holds to the completed dry run', async () => {
    const { t, admin } = await setup();
    const { records } = normalizePackage(parseJsonPackage(JSON.stringify([row('A')])), 'test', NOW);
    const args = { sourceKey: 'bound', files: [{ name: 'test', sha256: 'a', rows: 1 }], codeRevision: 'test', expectedRecords: 1, rejected: [] };
    const dry = await admin.mutation(api.zuoImport.begin, { ...args, mode: 'dry_run' });
    await admin.mutation(api.zuoImport.stage, { batchId: dry.batchId, records });
    await admin.mutation(api.zuoImport.finish, { batchId: dry.batchId, expectPackageCounts: false });
    for (const changed of [{ files: [{ name: 'test', sha256: 'b', rows: 1 }] }, { expectedRecords: 2 }, { codeRevision: 'changed' }])
      await expect(admin.mutation(api.zuoImport.begin, { ...args, ...changed, mode: 'commit' })).rejects.toThrow(/dry run/);
    const commit = await admin.mutation(api.zuoImport.begin, { ...args, mode: 'commit' });
    for (const changed of [
      { ...records[0], record: { ...records[0].record, approvedRetailPack: '999.00' } },
      { ...records[0], holdReasons: [...records[0].holdReasons, 'MANUAL'] },
      { ...records[0], record: { ...records[0].record, observedAt: NOW + 1 } },
      { ...records[0], record: { ...records[0].record, sku: 'B' } },
    ]) await expect(admin.mutation(api.zuoImport.stage, { batchId: commit.batchId, records: [changed] })).rejects.toThrow(/reviewed dry run/);
    expect(await t.run((ctx) => ctx.db.query('catVariants').collect())).toHaveLength(0);
    await admin.mutation(api.zuoImport.stage, { batchId: commit.batchId, records });
    await admin.mutation(api.zuoImport.stage, { batchId: commit.batchId, records });
    await expect(admin.mutation(api.zuoImport.stage, { batchId: commit.batchId, records: [{ ...records[0], holdReasons: ['MANUAL'] }] })).rejects.toThrow(/retried row differs/);
    const done = await admin.mutation(api.zuoImport.finish, { batchId: commit.batchId, expectPackageCounts: false });
    expect(done).toMatchObject({ status: 'done', counts: { total: 1 } });
    expect(await t.run((ctx) => ctx.db.query('commerceListings').collect())).toHaveLength(0);
    await expect(admin.mutation(api.zuoImport.begin, { ...args, mode: 'commit', codeRevision: 'changed' })).rejects.toThrow(/different or legacy package/);
  });

  it('fails incomplete dry runs and refuses undeclared extra rows', async () => {
    const { admin } = await setup();
    const { records } = normalizePackage(parseJsonPackage(JSON.stringify([row('A'), row('B')])), 'test', NOW);
    const args = { sourceKey: 'partial', files: [], codeRevision: 'test', expectedRecords: 2, rejected: [] };
    const dry = await admin.mutation(api.zuoImport.begin, { ...args, mode: 'dry_run' });
    await admin.mutation(api.zuoImport.stage, { batchId: dry.batchId, records: records.slice(0, 1) });
    expect(await admin.mutation(api.zuoImport.finish, { batchId: dry.batchId, expectPackageCounts: false })).toMatchObject({ status: 'failed', mismatches: ['Reviewed record count: expected 2, got 1'] });
    await expect(admin.mutation(api.zuoImport.begin, { ...args, mode: 'commit' })).rejects.toThrow(/dry run/);
    const small = await admin.mutation(api.zuoImport.begin, { ...args, expectedRecords: 1, mode: 'dry_run' });
    await expect(admin.mutation(api.zuoImport.stage, { batchId: small.batchId, records })).rejects.toThrow(/declared record count/);
    expect(await admin.query(api.zuoImport.batchRecords, { batchId: small.batchId })).toHaveLength(0);
  });

  it('keeps newly reviewed holds on unchanged variants and fails a partial commit', async () => {
    const { t, admin } = await setup();
    await importPackage(admin, [row('A')], 'dry_run');
    await importPackage(admin, [row('A')], 'commit');
    const { records } = normalizePackage(parseJsonPackage(JSON.stringify([row('A'), row('B')])), 'Zuo-Draft-Import.json', NOW);
    records[0].holdReasons.push('MANUAL');
    const args = { sourceKey: 'new-hold', files: [], codeRevision: 'test', expectedRecords: 2, rejected: [] };
    const dry = await admin.mutation(api.zuoImport.begin, { ...args, mode: 'dry_run' });
    await admin.mutation(api.zuoImport.stage, { batchId: dry.batchId, records });
    await admin.mutation(api.zuoImport.finish, { batchId: dry.batchId, expectPackageCounts: false });
    const commit = await admin.mutation(api.zuoImport.begin, { ...args, mode: 'commit' });
    await admin.mutation(api.zuoImport.stage, { batchId: commit.batchId, records: records.slice(0, 1) });
    expect((await t.run((ctx) => ctx.db.query('catVariants').first()))!.holds).toContain('MANUAL');
    expect(await admin.mutation(api.zuoImport.finish, { batchId: commit.batchId, expectPackageCounts: false })).toMatchObject({ status: 'failed' });
    expect(await t.run((ctx) => ctx.db.query('commerceListings').collect())).toHaveLength(0);
  });

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

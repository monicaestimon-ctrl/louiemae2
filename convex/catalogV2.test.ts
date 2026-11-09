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
  delete process.env.DELIVERY_ADMIN_ROLES;
  delete process.env.CATALOG_PUBLICATION_V2_ENABLED;
});

describe('cost evidence authoring', () => {
  async function fixture() {
    const { t, admin } = await setup();
    await importPackage(admin, [row('EVIDENCE')], 'dry_run');
    await importPackage(admin, [row('EVIDENCE')], 'commit');
    const variant = (await t.run(ctx => ctx.db.query('catVariants').first()))!;
    const args = {
      variantId: variant._id, expectedRevisionId: variant.currentCostRevisionId ?? null,
      requestKey: 'cost-evidence-fixture', wholesaleUsd: '115.125', verified: true,
      observedAt: NOW - 3600000, evidence: 'Supplier fixture revision / SKU EVIDENCE', note: 'Reviewed source; duties included in supplier price.',
      duties: { state: 'confirmed_zero' as const }, inbound: { state: 'unknown' as const }, fees: { state: 'amount' as const, minor: 125 },
      map: { state: 'explicit_sku' as const, minor: 30000, basis: 'pack' as const },
    };
    return { t, admin, variant, args };
  }
  it('appends evidence, preserves prices/history and retains unknown versus documented zero', async () => {
    const { t, admin, variant, args } = await fixture();
    const old = await admin.query(api.catEvidence.detail, { variantId: variant._id });
    const id = await admin.mutation(api.catEvidence.recordCost, args);
    expect(await admin.mutation(api.catEvidence.recordCost, args)).toBe(id);
    const updated = await admin.query(api.catEvidence.detail, { variantId: variant._id });
    expect(updated.history).toHaveLength(2);
    expect(updated.current).toMatchObject({ wholesalePrecise: '115.125', wholesaleMinor: 11513, verifiedAt: args.observedAt, dutiesMinor: null, dutiesConfirmedZero: true, inboundFreightMinor: null, inboundConfirmedZero: false, supplierFeesMinor: 125, feesConfirmedZero: false, mapMinor: 30000, mapUnitBasis: 'pack' });
    expect(updated.variant).toMatchObject({ retailPriceRevisionId: variant.retailPriceRevisionId, tradePriceRevisionId: variant.tradePriceRevisionId });
    expect(updated.variant.holds).toEqual(expect.arrayContaining([...variant.holds, 'MANUAL']));
    expect(updated.history.find(r => r._id === old.current!._id)).toMatchObject({ wholesaleMinor: old.current!.wholesaleMinor, effectiveTo: expect.any(Number) });
    expect(await t.run(ctx => ctx.db.query('sysAuditEvents').filter(q => q.eq(q.field('action'), 'cost.evidence')).collect())).toHaveLength(1);
    await expect(admin.mutation(api.catEvidence.recordCost, { ...args, note: 'Changed retry' })).rejects.toThrow(/Retry differs/);
    await expect(admin.mutation(api.catEvidence.recordCost, { ...args, requestKey: 'new-request-stale' })).rejects.toThrow(/Reload/);
  });
  it('rejects invalid source dates, ambiguous zeros and unauthorized exemptions', async () => {
    const { t, admin, args } = await fixture();
    for (const over of [
      { observedAt: Date.now() + 100000 }, { evidence: ' ' }, { wholesaleUsd: null },
      { fees: { state: 'amount' as const, minor: 0 } },
      { map: { state: 'explicit_sku' as const, minor: 0, basis: 'piece' as const } },
    ]) await expect(admin.mutation(api.catEvidence.recordCost, { ...args, ...over })).rejects.toThrow();
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['finance'] });
    await expect(admin.mutation(api.catEvidence.recordCost, { ...args, map: { state: 'not_applicable' } })).rejects.toThrow(/approver/);
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['support'] });
    await expect(admin.query(api.catEvidence.detail, { variantId: args.variantId })).rejects.toThrow();
    await expect(admin.mutation(api.catEvidence.recordCost, args)).rejects.toThrow();
    delete process.env.DELIVERY_ADMIN_ROLES;
    const id = await admin.mutation(api.catEvidence.recordCost, { ...args, wholesaleUsd: null, verified: false, map: { state: 'unknown' } });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ wholesaleMinor: null, mapApplicability: 'unknown' });
    expect((await t.run(ctx => ctx.db.get(id)))!.verifiedAt).toBeUndefined();
  });
});

describe('shipping evidence authoring', () => {
  async function fixture() {
    const { t, admin } = await setup();
    await importPackage(admin, [row('SHIP')], 'dry_run');
    await importPackage(admin, [row('SHIP')], 'commit');
    const variant = (await t.run(ctx => ctx.db.query('catVariants').first()))!;
    const warehouseArgs = { supplierId: variant.supplierId, warehouseId: null, expectedUpdatedAt: null, requestKey: 'warehouse-test-create', code: 'stockton', originZip: '95206', state: 'CA', active: true, evidence: 'Supplier fixture warehouse source', observedAt: NOW - 1000, validUntil: NOW + 86400000, timezone: 'America/Los_Angeles', cutoffLocal: '14:00', services: ['ground' as const, 'ltl' as const] };
    return { t, admin, variant, warehouseArgs };
  }
  it('preserves prices and source history while replacing current cartons, with safe retries', async () => {
    const { t, admin, variant, warehouseArgs } = await fixture();
    const warehouseId = await admin.mutation(api.catShipping.saveWarehouse, warehouseArgs);
    expect(await admin.mutation(api.catShipping.saveWarehouse, warehouseArgs)).toBe(warehouseId);
    const before = await admin.query(api.catShipping.detail, { variantId: variant._id });
    const args = { variantId: variant._id, expectedFingerprint: before.fingerprint, requestKey: 'shipping-test-create', warehouseId, cartons: [{ count: 1, length: '24', width: '20', height: '36', weight: '30', dimensionsUnit: 'in' as const, weightUnit: 'lb' as const, supplierMethod: 'ltl' as const }], evidence: 'Supplier fixture shipping sheet', observedAt: NOW - 1000, note: 'Verified packaged dimensions and required LTL' };
    const id = await admin.mutation(api.catShipping.saveCartons, args);
    expect(await admin.mutation(api.catShipping.saveCartons, args)).toBe(id);
    const after = await admin.query(api.catShipping.detail, { variantId: variant._id });
    expect(after.history).toHaveLength(1);
    expect(after.history[0].extractedValue).toContain('carton-evidence-v1-ceil-mm-g');
    expect(after.variant).not.toHaveProperty('currentCostRevisionId');
    expect(after.cartons).toHaveLength(1);
    expect(after.cartons[0]).toMatchObject({ lengthMm: 915, widthMm: 610, heightMm: 508, grossWeightG: 13608, supplierMethod: 'ltl', sourceObservationId: id });
    const current = (await t.run(ctx => ctx.db.query('catVariants').first()))!;
    expect(current).toMatchObject({ retailPriceRevisionId: variant.retailPriceRevisionId, tradePriceRevisionId: variant.tradePriceRevisionId, warehouseId });
    expect(current.holds).toEqual(expect.arrayContaining(['MANUAL', 'METHOD_CHANGED']));
    const audit = (await t.run(ctx => ctx.db.query('sysAuditEvents').filter(q => q.eq(q.field('action'), 'shipping.evidence')).collect()))[0];
    expect(audit.before).toMatchObject({ cartons: before.cartons });
    await expect(admin.mutation(api.catShipping.saveCartons, { ...args, note: 'Changed retry' })).rejects.toThrow(/Retry differs/);
    await expect(admin.mutation(api.catShipping.saveCartons, { ...args, requestKey: 'shipping-new-request' })).rejects.toThrow(/Reload/);
  });
  it('enforces approver/operations separation and warehouse concurrency', async () => {
    const { t, admin, variant, warehouseArgs } = await fixture();
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['operations'] });
    expect((await admin.query(api.catShipping.detail, { variantId: variant._id })).canApprove).toBe(false);
    await expect(admin.mutation(api.catShipping.saveWarehouse, warehouseArgs)).rejects.toThrow();
    process.env.DELIVERY_ADMIN_ROLES = JSON.stringify({ [ADMIN]: ['support'] });
    await expect(admin.query(api.catShipping.detail, { variantId: variant._id })).rejects.toThrow();
    delete process.env.DELIVERY_ADMIN_ROLES;
    const id = await admin.mutation(api.catShipping.saveWarehouse, warehouseArgs);
    const w = (await t.run(ctx => ctx.db.get(id)))!;
    const update = { ...warehouseArgs, warehouseId: id, expectedUpdatedAt: w.updatedAt!, requestKey: 'warehouse-test-edit', cutoffLocal: '15:00' };
    await admin.mutation(api.catShipping.saveWarehouse, update);
    await expect(admin.mutation(api.catShipping.saveWarehouse, { ...update, requestKey: 'warehouse-stale-edit' })).rejects.toThrow(/Reload/);
    await expect(admin.mutation(api.catShipping.saveWarehouse, { ...warehouseArgs, requestKey: 'warehouse-duplicate' })).rejects.toThrow(/already exists/);
    await expect(admin.mutation(api.catShipping.saveWarehouse, { ...warehouseArgs, validUntil: NOW - 1, requestKey: 'warehouse-expired' })).rejects.toThrow();
  });
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
      for (const mode of ['dry_run', 'commit'] as const) {
        const migration = await t.mutation(internal.zuoImport.beginStagedMigration, {
          mode, runId: manifest.runId, manifestSha256: manifest.manifestSha256,
          expectedRecords: batchRows.length, observedAt: NOW - 3_600_000,
        });
        for (let i = 0; i < batchRows.length; i += 10) {
          const skus = batchRows.slice(i, i + 10).map(r => r.sku);
          await t.mutation(internal.zuoImport.stageStoredMigration, { batchId: migration.batchId, skus });
          // A lost response must not change prices or fail after draft variant IDs migrate.
          await t.mutation(internal.zuoImport.stageStoredMigration, { batchId: migration.batchId, skus });
        }
        expect(await t.mutation(internal.zuoImport.finishStagedMigration, { batchId: migration.batchId })).toMatchObject({ status: 'done' });
      }
      const products = await t.run((ctx) => ctx.db.query('commerceProducts').collect());
      expect(products).toHaveLength(batchRows.length);
      for (const r of batchRows) {
        const p = products.find((p) => p.sourceKey === `zuo:${r.sku}`)!;
        const v = p.draft.variants[0];
        const expected = r.draft.variants[0];
        expect({
          sku: r.sku,
          name: v.name,
          retail: v.retail,
          commercial: v.commercial,
          cost: v.cost,
          image: v.image,
          minimum: v.minimum,
          increment: v.increment,
        }).toEqual({
          sku: r.sku,
          name: expected.name,
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

  it('refreshes method-only carton changes, precise costs and revised verification evidence', async () => {
    const { t, admin } = await setup();
    const first = [row('A', { method: 'Ground', wholesale: '115.001' })];
    await importPackage(admin, first, 'dry_run');
    await importPackage(admin, first, 'commit');
    const changed = [row('A', { method: 'LTL', wholesale: '115.002' })];
    await importPackage(admin, changed, 'dry_run', 'method');
    await importPackage(admin, changed, 'commit', 'method');
    expect((await t.run(ctx => ctx.db.query('catCartons').first()))!.supplierMethod).toBe('ltl');
    const variant = (await t.run(ctx => ctx.db.query('catVariants').first()))!;
    expect((await t.run(ctx => ctx.db.get(variant.currentCostRevisionId!)))!.wholesalePrecise).toBe('115.002');
    const newer = [row('A', { method: 'LTL', wholesale: '115.002', observedAt: new Date(NOW - 1000).toISOString() })];
    const dry = await importPackage(admin, newer, 'dry_run', 'fresh-evidence');
    expect(dry.counts.total).toBe(1);
    expect((await admin.query(api.zuoImport.batchRecords, { batchId: dry.batchId }))[0].action).toBe('update');
    await importPackage(admin, newer, 'commit', 'fresh-evidence');
    const latest = (await t.run(ctx => ctx.db.query('catVariants').first()))!;
    expect((await t.run(ctx => ctx.db.get(latest.currentCostRevisionId!)))!.verifiedAt).toBe(NOW - 1000);
    expect(await t.run(ctx => ctx.db.query('catCostRevisions').collect())).toHaveLength(3);
  });

  it('migrates stored evidence only after a matching dry run and rejects source changes', async () => {
    const { t, admin } = await setup();
    const packet = { runId: 'stored-fixture', manifestSha256: 'b'.repeat(64) };
    const staged = {
      sku: 'A', pack: 2, excluded: false, exclusionReasons: [], holdReasons: ['Original hold'],
      draft: { ...blankCommerceDraft(), name: 'Willow', supplierName: 'Zuo', sourceUrl: 'https://www.zuomod.com/fixture',
        packaging: JSON.stringify({ unitsPerSellUnit: 2, shippingMethod: 'Ground', cartons: [{ dimensionOrder: 'W,L,H', dims: [20, 24, 36], weight: 30 }] }),
        variants: [{ id: 'A', sku: 'A', name: 'Default', cost: 230, minimum: 1, increment: 1, retail: 45806, commercial: 41226 }],
      },
      sourceEvidence: JSON.stringify({ pricingRegime: 'APPROVED_5_PERCENT', originalSupplierName: 'Original chair', deliveryAllowanceEach: 60,
        freshObservation: { currentInstallRow: 2, currentPack: 2, currentCostEach: 115, currentMapEach: 180, currentAvailability: 'IN_STOCK', currentShip: 'Ground' } }),
    };
    await admin.mutation(api.zuoStaging.importBatch, { ...packet, rows: [staged] });
    const args = { ...packet, expectedRecords: 1, observedAt: NOW - 1000 };
    await expect(t.mutation(internal.zuoImport.beginStagedMigration, { ...args, mode: 'commit' })).rejects.toThrow(/dry run/);
    const before = await t.query(internal.zuoImport.stagedSnapshot, { ...packet, skus: ['A'] });
    expect(before[0].catalog).toEqual([]);
    await expect(t.query(internal.zuoImport.stagedSnapshot, { ...packet, manifestSha256: 'c'.repeat(64), skus: ['A'] })).rejects.toThrow(/identity differs/);
    const dry = await t.mutation(internal.zuoImport.beginStagedMigration, { ...args, mode: 'dry_run' });
    await t.mutation(internal.zuoImport.stageStoredMigration, { batchId: dry.batchId, skus: ['A'] });
    await t.mutation(internal.zuoImport.finishStagedMigration, { batchId: dry.batchId });
    const commit = await t.mutation(internal.zuoImport.beginStagedMigration, { ...args, mode: 'commit' });
    const product = (await t.run(ctx => ctx.db.get(before[0].productId as Id<'commerceProducts'>)))!;
    await t.run(ctx => ctx.db.patch(product._id, { zuoStaging: { ...product.zuoStaging!, sourceEvidence: staged.sourceEvidence.replace('60', '70') } }));
    await expect(t.mutation(internal.zuoImport.stageStoredMigration, { batchId: commit.batchId, skus: ['A'] })).rejects.toThrow(/reviewed dry run/);
    expect(await t.run(ctx => ctx.db.query('catVariants').collect())).toHaveLength(0);
    await t.run(ctx => ctx.db.patch(product._id, { zuoStaging: product.zuoStaging }));
    await t.mutation(internal.zuoImport.stageStoredMigration, { batchId: commit.batchId, skus: ['A'] });
    await t.mutation(internal.zuoImport.stageStoredMigration, { batchId: commit.batchId, skus: ['A'] });
    expect(await t.mutation(internal.zuoImport.finishStagedMigration, { batchId: commit.batchId })).toMatchObject({ status: 'done', counts: { total: 1 } });
    const after = await t.query(internal.zuoImport.stagedSnapshot, { ...packet, skus: ['A'] });
    expect(after[0].catalog[0].retail?.packPriceMinor).toBe(45806);
    expect(after[0].catalog[0].trade?.packPriceMinor).toBe(41226);
    expect(after[0].catalog[0].variant.holds).toEqual(expect.arrayContaining(['MANUAL', 'MEDIA_RIGHTS']));
    expect(after[0].catalog[0].cost).toMatchObject({ dutiesMinor: null, inboundFreightMinor: null, supplierFeesMinor: null });
    expect(after[0].row.sourceEvidence).toBe(staged.sourceEvidence);
    expect(after[0].row.draft.variants[0].name).toBe('Default');
    expect(await t.run(ctx => ctx.db.query('commerceListings').collect())).toHaveLength(0);
    const meta = (await t.run(ctx => ctx.db.query('catProductMeta').first()))!;
    await t.run(ctx => ctx.db.patch(meta._id, { stage: 'evidence_review' }));
    await expect(t.query(internal.zuoImport.stagedSnapshot, { ...packet, skus: ['A'] })).rejects.toThrow(/advanced beyond/);
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

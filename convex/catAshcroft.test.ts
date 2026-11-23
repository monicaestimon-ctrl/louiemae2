// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal, api } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';
import { ensureAshcroftIdentity } from './catAshcroft';
import { ensureSupplier } from './catCore';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
afterEach(() => { delete process.env.CJ_ADMIN_EMAILS; });
async function setup() {
  const t = convexTest(schema, modules);
  process.env.CJ_ADMIN_EMAILS = ADMIN;
  const admin = t.withIdentity({ subject: 'owner', email: ADMIN });
  const ids = await t.run(async ctx => {
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:set',
      draft: blankCommerceDraft(), revision: 1, updatedAt: 1 });
    const listingId = await ctx.db.insert('commerceListings', { productId, channel: 'retail', published: true,
      revision: 1, updatedAt: 1, snapshot: { name: 'Pair of chairs', description: '', category: 'dining chair', images: [], facts: '',
        variants: [{ id: 'set-one', name: 'Default Title', minimum: 1, increment: 1, price: 90000 }] },
      fulfillment: [{ id: 'set-one', name: 'Pair', sku: 'SET-2', cost: 115, minimum: 1, increment: 1, retail: 90000, commercial: 80000 }] });
    return { productId, listingId };
  });
  return { t, admin, ...ids };
}
async function reviewed(s: Awaited<ReturnType<typeof setup>>) {
  const page = await s.t.query(internal.catAshcroft.preview, { cursor: null });
  const row = page.rows[0];
  if (!('fingerprint' in row) || !row.fingerprint) throw Error('Fixture not ready');
  return { productId: row.productId, variantId: row.variantId, fingerprint: row.fingerprint };
}

describe('Ashcroft identity preparation', () => {
  it('previews without writes, commits idempotently and leaves listings/evidence unapproved', async () => {
    const s = await setup();
    const before = await s.t.run(ctx => ctx.db.get(s.listingId));
    const row = await reviewed(s);
    expect(await s.t.run(ctx => ctx.db.query('catSuppliers').collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('catVariants').collect())).toHaveLength(0);
    const first = await s.t.mutation(internal.catAshcroft.commit, { rows: [row] });
    expect(await s.t.mutation(internal.catAshcroft.commit, { rows: [row] })).toEqual(first);
    const cv = await s.t.run(ctx => ctx.db.get(first[0].variantRecordId));
    expect(cv).toMatchObject({ productId: s.productId, legacyVariantId: 'set-one', supplierSku: 'SET-2',
      availability: 'unknown', piecesPerPack: 1, holds: ['COST_MISSING', 'MANUAL'] });
    expect(cv?.currentCostRevisionId).toBeUndefined();
    expect(cv?.tradePriceRevisionId).toBeUndefined();
    expect(await s.t.run(ctx => ctx.db.get(s.listingId))).toEqual(before);
    expect((await s.t.run(ctx => ctx.db.query('sysAuditEvents').collect())).filter(e => e.action === 'ashcroft.identity')).toHaveLength(1);
  });

  it('rejects stale previews and duplicate commit rows atomically', async () => {
    const s = await setup();
    const row = await reviewed(s);
    await expect(s.t.mutation(internal.catAshcroft.commit, { rows: [row, row] })).rejects.toThrow(/distinct/);
    await s.t.run(ctx => ctx.db.patch(s.listingId, { revision: 2 }));
    await expect(s.t.mutation(internal.catAshcroft.commit, { rows: [row] })).rejects.toThrow(/Source changed/);
    expect(await s.t.run(ctx => ctx.db.query('catVariants').collect())).toHaveLength(0);
  });

  it('rejects SKU reuse by a different product and changed legacy variant ownership', async () => {
    const s = await setup();
    const row = await reviewed(s);
    const [created] = await s.t.mutation(internal.catAshcroft.commit, { rows: [row] });
    await s.t.run(async ctx => {
      const foreign = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:foreign', draft: blankCommerceDraft(), revision: 1, updatedAt: 1 });
      await expect(ensureAshcroftIdentity(ctx, { productId: foreign, variantId: 'foreign', sku: 'SET-2', name: 'Foreign', minimum: 1, increment: 1 }, 'fixture')).rejects.toThrow(/different product/);
      await ctx.db.patch(created.variantRecordId, { supplierSku: 'CHANGED' });
    });
    await expect(s.t.mutation(internal.catAshcroft.commit, { rows: [row] })).rejects.toThrow(/different product/);
  });

  it('reports channel conflicts and refuses altered selling-unit quantity rules', async () => {
    const s = await setup();
    const row = await reviewed(s);
    const [created] = await s.t.mutation(internal.catAshcroft.commit, { rows: [row] });
    await s.t.run(ctx => ctx.db.patch(created.variantRecordId, { piecesPerPack: 2 }));
    await expect(s.t.mutation(internal.catAshcroft.commit, { rows: [row] })).rejects.toThrow(/quantity basis/);
    await s.t.run(async ctx => {
      const retail = (await ctx.db.get(s.listingId))!;
      await ctx.db.insert('commerceListings', { productId: s.productId, channel: 'house', published: true, revision: 1, updatedAt: 1,
        snapshot: retail.snapshot, fulfillment: retail.fulfillment!.map(v => ({ ...v, sku: 'OTHER-SKU' })) });
    });
    const page = await s.t.query(internal.catAshcroft.preview, { cursor: null });
    expect(page.rows[0]).toMatchObject({ status: 'review_required', detail: expect.stringContaining('conflicts between channels') });
    await expect(s.t.mutation(internal.catAshcroft.commit, { rows: [row] })).rejects.toThrow(/conflicts between channels/);
  });

  it('requires explicit Ashcroft selling-unit costs and keeps their source basis', async () => {
    const s = await setup();
    const [created] = await s.t.mutation(internal.catAshcroft.commit, { rows: [await reviewed(s)] });
    const args = { variantId: created.variantRecordId, expectedRevisionId: null, requestKey: 'ashcroft-cost-01', wholesaleUsd: '115', verified: false,
      observedAt: Date.now() - 1000, duties: { state: 'unknown' as const }, inbound: { state: 'unknown' as const }, fees: { state: 'unknown' as const },
      map: { state: 'unknown' as const }, evidence: 'fixture:per selling unit report', note: 'Set is one selling unit; costs still unverified' };
    await expect(s.t.mutation(api.catEvidence.recordCost, args)).rejects.toThrow();
    await expect(s.admin.mutation(api.catEvidence.recordCost, args)).rejects.toThrow(/unit basis/);
    await expect(s.admin.mutation(api.catEvidence.recordCost, { ...args, wholesaleUnitBasis: 'piece' })).rejects.toThrow(/unit basis/);
    await expect(s.admin.mutation(api.catEvidence.recordCost, { ...args, wholesaleUnitBasis: 'selling_unit', map: { state: 'explicit_sku', minor: 30000, basis: 'piece' } })).rejects.toThrow(/MAP must be recorded per selling unit/);
    const id = await s.admin.mutation(api.catEvidence.recordCost, { ...args, wholesaleUnitBasis: 'selling_unit' });
    const saved = await s.t.run(ctx => ctx.db.get(id));
    expect(saved).toMatchObject({ wholesaleMinor: 11500, wholesaleUnitBasis: 'selling_unit' });
    expect(saved?.verifiedAt).toBeUndefined();
    expect((await s.t.run(ctx => ctx.db.query('catSourceObservations').collect())).find(o => o.field === 'wholesale')?.unit).toBe('USD_per_selling_unit');
    expect((await s.admin.query(api.catEvidence.detail, { variantId: created.variantRecordId })).supplierCode).toBe('ashcroft');
  });

  it('keeps Zuo legacy authoring per piece and rejects selling-unit substitutions', async () => {
    const s = await setup();
    const [created] = await s.t.mutation(internal.catAshcroft.commit, { rows: [await reviewed(s)] });
    await s.t.run(async ctx => { const supplier = await ensureSupplier(ctx, 'zuo'); await ctx.db.patch(created.variantRecordId, { supplierId: supplier._id }); });
    const args = { variantId: created.variantRecordId, expectedRevisionId: null, requestKey: 'zuo-cost-basis-01', wholesaleUsd: '115', verified: false,
      observedAt: Date.now() - 1000, duties: { state: 'unknown' as const }, inbound: { state: 'unknown' as const }, fees: { state: 'unknown' as const },
      map: { state: 'unknown' as const }, evidence: 'fixture:per piece', note: 'Legacy Zuo basis retained' };
    await expect(s.admin.mutation(api.catEvidence.recordCost, { ...args, wholesaleUnitBasis: 'selling_unit' })).rejects.toThrow(/unit basis/);
    const id = await s.admin.mutation(api.catEvidence.recordCost, args);
    expect((await s.t.run(ctx => ctx.db.get(id)))?.wholesaleUnitBasis).toBe('piece');
  });
});

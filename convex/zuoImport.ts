// Zuo import (spec S09, v2 §3, §22). The admin's browser parses the package with lib/zuoImport
// and sends it in chunks. A dry run writes only the batch and per-record report. A commit writes
// products, variants, cartons, immutable observations, cost revisions, the approved cohort's
// prices and holds. Every Zuo variant starts as an imported draft with retail, trade and
// referrals disabled; a repeated commit of the same package changes nothing.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { ensureSupplier, openHold } from './catCore';
import { audit } from './sysCore';
import { blankCommerceDraft } from '../lib/commerce';
import { CommerceError } from '../lib/errors';
import { dollarsToMinor } from '../lib/decimal';
import { proposeCategory } from '../lib/catCategory';
import { slugify } from '../lib/slug';
import { piecePriceInfo } from '../lib/catUnits';
import { countMismatches, fingerprint, identityKey, type ZuoRecord } from '../lib/zuoImport';
import { HOLD_REASONS, type HoldReason } from './v2Validators';

const CHUNK = 25;
const zuoRecord = v.any(); // validated field by field in validateRecord (the shape is lib/zuoImport ZuoRecord)

function validateRecord(r: ZuoRecord): ZuoRecord {
  const ok =
    r &&
    typeof r.sku === 'string' &&
    r.sku &&
    typeof r.packId === 'string' &&
    Number.isInteger(r.piecesPerPack) &&
    r.piecesPerPack >= 1 &&
    Array.isArray(r.cartons) &&
    Array.isArray(r.images) &&
    (r.wholesalePiece === null || /^\d+(\.\d+)?$/.test(r.wholesalePiece));
  if (!ok) throw new CommerceError('INVALID_INPUT', `Malformed record ${String(r?.sku)}`);
  return r;
}

export const begin = mutation({
  args: {
    mode: v.union(v.literal('dry_run'), v.literal('commit')),
    sourceKey: v.string(),
    files: v.array(v.object({ name: v.string(), sha256: v.string(), rows: v.number() })),
    codeRevision: v.string(),
    rejected: v.array(v.object({ row: v.number(), sku: v.string(), reasons: v.array(v.string()) })),
  },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (a.mode === 'commit') {
      const done = await ctx.db
        .query('catImportBatches')
        .withIndex('by_source_mode', (q) => q.eq('sourceKey', a.sourceKey).eq('mode', 'commit'))
        .filter((q) => q.eq(q.field('status'), 'done'))
        .first();
      if (done) return { batchId: done._id, alreadyCommitted: true };
      const dry = await ctx.db
        .query('catImportBatches')
        .withIndex('by_source_mode', (q) => q.eq('sourceKey', a.sourceKey).eq('mode', 'dry_run'))
        .filter((q) => q.eq(q.field('status'), 'done'))
        .first();
      if (!dry) throw new CommerceError('INVALID_INPUT', 'Run and review a dry run of this exact package before committing it.');
    }
    const supplier = await ensureSupplier(ctx, 'zuo');
    const batchId = await ctx.db.insert('catImportBatches', {
      supplierId: supplier._id,
      sourceKey: a.sourceKey,
      files: a.files,
      mode: a.mode,
      status: 'running',
      summary: { create: 0, update: 0, unchanged: 0, reject: a.rejected.length, hold: 0, conflicts: 0, cohorts: {} },
      codeRevision: a.codeRevision,
      schemaVersion: 'v2',
      configVersions: {},
      startedBy: admin.email,
      startedAt: Date.now(),
    });
    for (const r of a.rejected)
      await ctx.db.insert('catImportRecords', { batchId, sourceRowKey: `${r.sku || 'row'}:${r.row}`, action: 'reject', reasons: r.reasons });
    return { batchId, alreadyCommitted: false };
  },
});

type StagedRecord = { record: ZuoRecord; holdReasons: string[] };

async function productFor(ctx: MutationCtx, r: ZuoRecord, by: string) {
  const sourceKey = `zuo:${r.sku}`;
  const existing = await ctx.db.query('commerceProducts').withIndex('by_source', (q) => q.eq('sourceKey', sourceKey)).first();
  if (existing) return existing._id;
  const draft = blankCommerceDraft();
  const name = r.louieMaeName || r.supplierName;
  const productId = await ctx.db.insert('commerceProducts', {
    provider: 'zuo',
    sourceKey,
    draft: { ...draft, name, category: r.navCategory, supplierName: 'Zuo', variants: [] },
    revision: 1,
    updatedAt: Date.now(),
  });
  const cat = proposeCategory(`${r.navCategory} ${r.supplierName}`);
  const supplier = await ensureSupplier(ctx, 'zuo');
  await ctx.db.insert('catProductMeta', {
    productId,
    supplierId: supplier._id,
    commissionCategory: cat.category,
    navCategory: r.navCategory,
    louieMaeName: name,
    slug: `${slugify(name) || 'zuo'}-${r.sku.toLowerCase()}`,
    slugHistory: [],
    supplierName: r.supplierName,
    supplierProductRef: r.sku,
    holds: cat.category === 'review_required' ? ['CATEGORY_REVIEW'] : [],
    stage: 'imported_draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await audit(ctx, { actor: by, action: 'zuo.product.create', entityTable: 'commerceProducts', entityId: productId });
  return productId;
}

async function observe(ctx: MutationCtx, a: { supplierId: Id<'catSuppliers'>; variantId: Id<'catVariants'>; sku: string; field: string; value: string; r: ZuoRecord; confidence: Doc<'catSourceObservations'>['confidence']; batchId: Id<'catImportBatches'> }) {
  const contentHash = `${a.sku}|${a.field}|${a.value}|${a.r.sourceFile}|${a.r.observedAt}`;
  const seen = await ctx.db.query('catSourceObservations').withIndex('by_hash', (q) => q.eq('contentHash', contentHash)).first();
  if (seen) return seen._id;
  return ctx.db.insert('catSourceObservations', {
    supplierId: a.supplierId,
    variantId: a.variantId,
    supplierSku: a.sku,
    field: a.field,
    extractedValue: a.value,
    sourceFile: a.r.sourceFile,
    observedAt: a.r.observedAt,
    contentHash,
    verifier: 'zuo-import',
    confidence: a.confidence,
    importBatchId: a.batchId,
    createdAt: Date.now(),
  });
}

/** Writes one record (commit mode). Returns the action taken and any conflicts. */
async function commitRecord(ctx: MutationCtx, s: StagedRecord, batch: Doc<'catImportBatches'>, by: string) {
  const r = s.record;
  const supplierId = batch.supplierId;
  const fp = fingerprint(r);
  const existing = await ctx.db
    .query('catVariants')
    .withIndex('by_identity', (q) => q.eq('supplierId', supplierId).eq('supplierSku', r.sku).eq('packId', r.packId))
    .first();
  if (existing && existing.importFingerprint === fp) return { action: 'unchanged' as const, variantId: existing._id, conflicts: [] };
  const productId = existing?.productId ?? (await productFor(ctx, r, by));
  const now = Date.now();
  const conflicts: string[] = [];
  const base = {
    supplierVariantName: [r.material, r.color, r.size].filter(Boolean).join(' / ') || r.supplierName,
    material: r.material,
    color: r.color,
    size: r.size,
    sizeClass: r.sizeClass,
    piecesPerPack: r.piecesPerPack,
    orderMinimumPacks: r.minimumPacks,
    orderIncrementPacks: r.incrementPacks,
    cohort: r.cohort,
    importFingerprint: fp,
    updatedAt: now,
  };
  let variantId: Id<'catVariants'>;
  if (existing) {
    variantId = existing._id;
    // Owner-renamed variants keep their Louie Mae name; supplier names and SKUs never change.
    await ctx.db.patch(variantId, base);
  } else {
    variantId = await ctx.db.insert('catVariants', {
      productId,
      supplierId,
      supplierSku: r.sku,
      packId: r.packId,
      optionKey: [r.material, r.color, r.size].filter(Boolean).join('|').toLowerCase() || 'default',
      louieMaeVariantName: base.supplierVariantName,
      availability: 'unknown',
      fulfillmentRoute: 'manual_dealer_zuo',
      holds: [],
      ...(r.policyKey ? { marginPolicyKey: r.policyKey } : r.cohort === 'approved_306' ? { marginPolicyKey: 'zuo-approved-5' } : r.cohort === 'map_135' ? { marginPolicyKey: 'zuo-map-floor-pending' } : {}),
      createdAt: now,
      ...base,
    });
  }
  // Immutable evidence for every field the package carries.
  const obsIds: Id<'catSourceObservations'>[] = [];
  const conf = r.costConfidence === 'confirmed' ? 'confirmed' : r.costConfidence === 'corroborated' ? 'corroborated' : 'unverified';
  if (r.wholesalePiece !== null) obsIds.push(await observe(ctx, { supplierId, variantId, sku: r.sku, field: 'wholesale', value: r.wholesalePiece, r, confidence: conf, batchId: batch._id }));
  if (r.mapPack !== null) obsIds.push(await observe(ctx, { supplierId, variantId, sku: r.sku, field: 'map', value: r.mapPack, r, confidence: r.mapSource === 'policy_derived' ? 'policy_derived' : 'confirmed', batchId: batch._id }));
  await observe(ctx, { supplierId, variantId, sku: r.sku, field: 'stock', value: r.stock, r, confidence: r.stock === 'unknown' ? 'unverified' : 'confirmed', batchId: batch._id });
  for (const url of r.images) await observe(ctx, { supplierId, variantId, sku: r.sku, field: 'image', value: url, r, confidence: 'unverified', batchId: batch._id });
  // Cartons: replaced only when the package's carton set changes.
  const oldCartons = await ctx.db.query('catCartons').withIndex('by_variant', (q) => q.eq('variantId', variantId)).collect();
  const cartonKey = (c: { cartonsPerPack: number; lengthMm: number; widthMm: number; heightMm: number; grossWeightG: number }) => [c.cartonsPerPack, c.lengthMm, c.widthMm, c.heightMm, c.grossWeightG].join('x');
  if (oldCartons.map(cartonKey).join(',') !== r.cartons.map(cartonKey).join(',')) {
    for (const c of oldCartons) await ctx.db.delete(c._id);
    for (const [index, c] of r.cartons.entries()) {
      const obs = await observe(ctx, { supplierId, variantId, sku: r.sku, field: 'carton', value: cartonKey(c), r, confidence: 'confirmed', batchId: batch._id });
      await ctx.db.insert('catCartons', { variantId, index, cartonsPerPack: c.cartonsPerPack, lengthMm: c.lengthMm, widthMm: c.widthMm, heightMm: c.heightMm, grossWeightG: c.grossWeightG, ...(c.netWeightG ? { netWeightG: c.netWeightG } : {}), supplierMethod: c.method, sourceObservationId: obs, createdAt: now });
    }
  }
  // Cost revision: a new one only when the cost facts change.
  const wholesaleMinor = r.wholesalePiece === null ? null : dollarsToMinor(r.wholesalePiece, 'half_up');
  const mapMinor = r.mapPack === null ? null : dollarsToMinor(r.mapPack, 'half_up');
  const cur = existing?.currentCostRevisionId ? await ctx.db.get(existing.currentCostRevisionId) : null;
  if (!cur || cur.wholesaleMinor !== wholesaleMinor || cur.mapMinor !== mapMinor || cur.mapSource !== r.mapSource || cur.mapApplicability !== r.mapApplicability) {
    if (cur) await ctx.db.patch(cur._id, { effectiveTo: now });
    const costId = await ctx.db.insert('catCostRevisions', {
      variantId,
      wholesaleMinor,
      ...(r.wholesalePiece ? { wholesalePrecise: r.wholesalePiece } : {}),
      currency: 'USD',
      // Duties, inbound freight and fees are unknown until verified (never assumed zero).
      dutiesMinor: null,
      dutiesConfirmedZero: false,
      inboundFreightMinor: null,
      inboundConfirmedZero: false,
      supplierFeesMinor: null,
      feesConfirmedZero: false,
      mapMinor,
      mapUnitBasis: 'pack',
      mapSource: r.mapSource,
      mapApplicability: r.mapApplicability,
      costSource: `zuo package ${r.sourceFile}`,
      ...(r.costConfidence !== 'unverified' && wholesaleMinor !== null ? { verifiedAt: r.observedAt } : {}),
      observationIds: obsIds,
      createdAt: now,
      createdBy: by,
      effectiveFrom: now,
      source: `catImportBatches:${batch._id}`,
    });
    await ctx.db.patch(variantId, { currentCostRevisionId: costId });
  }
  // The approved cohort's exact pack prices, preserved as imported (PRI01).
  if (r.cohort === 'approved_306' && r.approvedRetailPack) {
    for (const [channel, value] of [['retail', r.approvedRetailPack], ['trade', r.approvedTradePack]] as const) {
      if (!value) continue;
      const packPriceMinor = dollarsToMinor(value, 'ceil');
      const field = channel === 'retail' ? 'retailPriceRevisionId' : 'tradePriceRevisionId';
      const v2 = (await ctx.db.get(variantId))!;
      const current = v2[field] ? await ctx.db.get(v2[field]!) : null;
      if (current?.status === 'approved' && current.packPriceMinor === packPriceMinor) continue;
      if (current?.status === 'approved' && current.origin === 'manual') {
        conflicts.push(`${channel} price edited by owner (${current.packPriceMinor}) differs from package (${packPriceMinor}); kept the owner's price`);
        continue;
      }
      if (current) await ctx.db.patch(current._id, { status: 'superseded', effectiveTo: now });
      const priceId = await ctx.db.insert('catPriceRevisions', {
        variantId,
        channel,
        packPriceMinor,
        piecePriceMinorInfo: piecePriceInfo(packPriceMinor, r.piecesPerPack),
        marginPolicyKey: 'zuo-approved-5',
        marginPolicyVersion: 1,
        roundingPolicyVersion: 1,
        approvedBy: 'owner (approved 306-product cohort, v2 §1)',
        approvedAt: now,
        status: 'approved',
        origin: 'import_approved',
        createdAt: now,
        createdBy: by,
        effectiveFrom: now,
        source: `catImportBatches:${batch._id}`,
      });
      await ctx.db.patch(variantId, { [field]: priceId });
    }
  }
  if (r.stock !== 'unknown' || r.excluded) await ctx.db.patch(variantId, { availability: r.stock === 'unknown' ? 'out_of_stock' : r.stock, availabilityObservedAt: r.observedAt });
  for (const h of s.holdReasons) if ((HOLD_REASONS as readonly string[]).includes(h)) await openHold(ctx, variantId, h as HoldReason, `Zuo import: ${h}`, by);
  if (r.excluded) await openHold(ctx, variantId, 'MANUAL', 'Excluded in the reconciled package: keep history, do not activate.', by);
  await projectDraftVariants(ctx, productId);
  return { action: existing ? ('update' as const) : ('create' as const), variantId, conflicts };
}

/** Regenerates the product draft's variants from catVariants (Zuo drafts are projections). */
export async function projectDraftVariants(ctx: MutationCtx, productId: Id<'commerceProducts'>) {
  const product = await ctx.db.get(productId);
  if (!product || product.provider !== 'zuo') return;
  const variants = await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
  const draftVariants = [];
  for (const cv of variants) {
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
    const trade = cv.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
    draftVariants.push({
      id: cv._id,
      name: cv.louieMaeVariantName,
      sku: cv.supplierSku,
      cost: cost?.wholesaleMinor ? (cost.wholesaleMinor * cv.piecesPerPack) / 100 : 0,
      minimum: cv.orderMinimumPacks,
      increment: cv.orderIncrementPacks,
      retail: retail?.status === 'approved' ? retail.packPriceMinor : 0,
      commercial: trade?.status === 'approved' ? trade.packPriceMinor : 0,
    });
  }
  await ctx.db.patch(productId, { draft: { ...product.draft, variants: draftVariants }, revision: product.revision + 1, updatedAt: Date.now() });
}

async function diffRecord(ctx: MutationCtx, s: StagedRecord, supplierId: Id<'catSuppliers'>) {
  const existing = await ctx.db
    .query('catVariants')
    .withIndex('by_identity', (q) => q.eq('supplierId', supplierId).eq('supplierSku', s.record.sku).eq('packId', s.record.packId))
    .first();
  if (!existing) return { action: 'create' as const };
  return { action: existing.importFingerprint === fingerprint(s.record) ? ('unchanged' as const) : ('update' as const), variantId: existing._id };
}

/** Stages a chunk of normalized records: a dry run reports, a commit writes. */
export const stage = mutation({
  args: { batchId: v.id('catImportBatches'), records: v.array(v.object({ record: zuoRecord, holdReasons: v.array(v.string()) })) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (a.records.length > CHUNK) throw new CommerceError('INVALID_INPUT', `Send at most ${CHUNK} records per chunk`);
    const batch = await ctx.db.get(a.batchId);
    if (!batch || batch.status !== 'running') throw new CommerceError('INVALID_INPUT', 'Batch is not running');
    const summary = { ...batch.summary, cohorts: { ...(batch.summary.cohorts ?? {}) } };
    for (const s of a.records) {
      const record = validateRecord(s.record as ZuoRecord);
      const key = identityKey(record);
      const already = await ctx.db.query('catImportRecords').withIndex('by_batch', (q) => q.eq('batchId', batch._id).eq('sourceRowKey', key)).first();
      if (already) continue; // a retried chunk
      const staged = { record, holdReasons: s.holdReasons };
      const res = batch.mode === 'commit' ? await commitRecord(ctx, staged, batch, admin.email) : await diffRecord(ctx, staged, batch.supplierId);
      const action = res.action;
      summary[action] = (summary[action] ?? 0) + 1;
      if (s.holdReasons.length) summary.hold = (summary.hold ?? 0) + 1;
      const conflicts = 'conflicts' in res ? res.conflicts : [];
      if (conflicts.length) summary.conflicts = (summary.conflicts ?? 0) + 1;
      summary.cohorts[record.cohort] = (summary.cohorts[record.cohort] ?? 0) + 1;
      if (record.excluded) summary.cohorts.excluded = (summary.cohorts.excluded ?? 0) + 1;
      await ctx.db.insert('catImportRecords', {
        batchId: batch._id,
        sourceRowKey: key,
        action,
        reasons: s.holdReasons,
        cohort: record.cohort,
        diff: { fingerprint: fingerprint(record) },
        ...('variantId' in res && res.variantId ? { variantId: res.variantId } : {}),
        ...(conflicts.length ? { conflicts } : {}),
      });
    }
    await ctx.db.patch(batch._id, { summary });
    return summary;
  },
});

/**
 * Closes the batch. With `expectPackageCounts`, the cohort counts must equal the reconciled
 * package's counts exactly (865/803/306/135/296/66/62/226/639) or the batch fails.
 */
export const finish = mutation({
  args: { batchId: v.id('catImportBatches'), expectPackageCounts: v.boolean(), metadataCorrections: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const batch = await ctx.db.get(a.batchId);
    if (!batch || batch.status !== 'running') throw new CommerceError('INVALID_INPUT', 'Batch is not running');
    const c = batch.summary.cohorts ?? {};
    const staged = (batch.summary.create ?? 0) + (batch.summary.update ?? 0) + (batch.summary.unchanged ?? 0);
    const counts = { ...c, total: staged, modeledPrices: staged - (c.unpriced_62 ?? 0), excluded: c.excluded ?? 0, nonexcludedDrafts: staged - (c.excluded ?? 0) };
    const mismatches = a.expectPackageCounts ? countMismatches(counts) : [];
    await ctx.db.patch(batch._id, {
      status: mismatches.length ? 'failed' : 'done',
      summary: { ...batch.summary, counts, mismatches },
      finishedAt: Date.now(),
      ...(mismatches.length ? { error: mismatches.join('; ') } : {}),
      ...(a.metadataCorrections ? { metadataCorrections: a.metadataCorrections } : {}),
    });
    await audit(ctx, { actor: admin.email, action: `zuo.import.${batch.mode}`, entityTable: 'catImportBatches', entityId: batch._id, after: { counts, mismatches } });
    return { status: mismatches.length ? 'failed' : 'done', counts, mismatches };
  },
});

export const batches = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('catImportBatches').order('desc').take(20);
  },
});

export const batchRecords = query({
  args: { batchId: v.id('catImportBatches'), action: v.optional(v.union(v.literal('create'), v.literal('update'), v.literal('unchanged'), v.literal('reject'), v.literal('hold'))) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const q = a.action
      ? ctx.db.query('catImportRecords').withIndex('by_batch_action', (x) => x.eq('batchId', a.batchId).eq('action', a.action!))
      : ctx.db.query('catImportRecords').withIndex('by_batch', (x) => x.eq('batchId', a.batchId));
    return q.take(1000);
  },
});

export { KNOWN_METADATA_CORRECTIONS } from '../lib/zuoImportNotes';

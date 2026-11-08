import { v } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { ZuoStagingRow } from '../lib/zuoStaging';
import { mutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { draft } from './commerceTables';
import { stagingPayload, validateZuoStagingRow } from '../lib/zuoStaging';

/** Phase C uses the same supplier and product identity. Metadata stays explicitly held. */
async function ensureCatalogMeta(ctx: MutationCtx, productId: Id<'commerceProducts'>, row: ZuoStagingRow) {
  const old = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', productId)).unique();
  if (old) return; // Never overwrite a later catalog review or publication stage.
  const supplier = await ctx.db.query('catSuppliers').withIndex('by_code', q => q.eq('code', 'zuo')).unique();
  const supplierId = supplier?._id ?? await ctx.db.insert('catSuppliers', {
    code: 'zuo', name: 'Zuo', publicAttributionAllowed: false,
    fulfillmentRoute: 'manual_dealer_zuo', freshnessKey: 'freshness-default', createdAt: Date.now(),
  });
  let supplierProductName = '';
  let commissionCategory: 'furniture' | 'decor' | 'clothing' | 'review_required' = 'review_required';
  try {
    const facts = JSON.parse(row.draft.facts);
    if (typeof facts.supplierName === 'string' && facts.supplierName.trim() && facts.supplierName.length <= 1000) supplierProductName = facts.supplierName.trim();
    const explicit = facts.commissionCategory;
    if (explicit === 'furniture' || explicit === 'decor' || explicit === 'clothing') commissionCategory = explicit;
  } catch { /* Non-JSON evidence requires explicit category review. */ }
  if (!supplierProductName) {
    try {
      const original = JSON.parse(row.sourceEvidence).originalSupplierName;
      if (typeof original === 'string' && original.trim() && original.length <= 1000) supplierProductName = original.trim();
    } catch { /* Preserve missing original name as supplier SKU, never invent a name. */ }
  }
  await ctx.db.insert('catProductMeta', {
    productId, supplierId, commissionCategory, navCategory: row.draft.category,
    louieMaeName: row.draft.name, slug: `zuo-${row.sku.toLowerCase()}`, slugHistory: [],
    supplierName: supplierProductName || row.sku, supplierProductRef: row.sku,
    holds: commissionCategory === 'review_required' ? ['CATEGORY_REVIEW', 'MANUAL'] : ['MANUAL'], stage: 'imported_draft', createdAt: Date.now(), updatedAt: Date.now(),
  });
}

/** Authenticated, insert-only staging. No listing creation and no publication capability. */
export const importBatch = mutation({
  args: {
    runId: v.string(), manifestSha256: v.string(),
    rows: v.array(v.object({
      sku: v.string(), pack: v.number(), draft, sourceEvidence: v.string(),
      excluded: v.boolean(), exclusionReasons: v.array(v.string()), holdReasons: v.array(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    if (!/^[\w-]{1,100}$/.test(args.runId) || !/^[a-f0-9]{64}$/.test(args.manifestSha256))
      throw new Error('Run identity and SHA-256 manifest digest required.');
    if (!args.rows.length || args.rows.length > 20 || JSON.stringify(args).length > 500000)
      throw new Error('Use batches of 1-20 rows within 500KB.');
    if (new Set(args.rows.map(r => r.sku)).size !== args.rows.length) throw new Error('Duplicate SKU in batch.');
    for (const row of args.rows) validateZuoStagingRow(row);
    const results = [];
    for (const row of args.rows) {
      const sourceKey = `zuo:${row.sku}`;
      const legacy = await ctx.db.query('commerceProducts').withIndex('by_source', q => q.eq('sourceKey', `zuo:sku:${row.sku}`)).unique();
      if (legacy) throw new Error(`Legacy staging identity for ${row.sku} requires migration before import.`);
      const payload = stagingPayload(row);
      const existing = await ctx.db.query('commerceProducts').withIndex('by_source', q => q.eq('sourceKey', sourceKey)).unique();
      if (existing) {
        if (existing.provider !== 'zuo' || existing.zuoStaging?.payload !== payload || stagingPayload(existing.draft) !== stagingPayload(row.draft))
          throw new Error(`Existing Zuo SKU ${row.sku} differs; explicit revision review required.`);
        await ensureCatalogMeta(ctx, existing._id, row);
        results.push({ sku: row.sku, id: existing._id, existing: true, excluded: row.excluded });
        continue;
      }
      const now = Date.now();
      const id = await ctx.db.insert('commerceProducts', {
        provider: 'zuo', sourceKey, draft: row.draft, revision: 1, updatedAt: now,
        zuoStaging: { sku: row.sku, pack: row.pack, unitsPerSellUnit: row.pack, runId: args.runId, manifestSha256: args.manifestSha256,
          sourceEvidence: row.sourceEvidence, excluded: row.excluded, exclusionReasons: row.exclusionReasons,
          holdReasons: row.holdReasons, payload, status: 'staged_not_orderable' },
      });
      await ensureCatalogMeta(ctx, id, row);
      await ctx.db.insert('commerceAudit', { entityId: id, actor: actor.email, action: `zuo_stage:${args.runId}`, revision: 1, createdAt: now });
      results.push({ sku: row.sku, id, existing: false, excluded: row.excluded });
    }
    return { results, status: 'staged_not_orderable' as const };
  },
});

/** Upload permission does not assert supplier image rights or publish a product. */
export const generateUploadUrls = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    await requireCjAdminIdentity(ctx);
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Request 1-20 uploads.');
    return Promise.all(Array.from({ length: count }, () => ctx.storage.generateUploadUrl()));
  },
});

export const resolveUploadedMedia = query({
  args: { storageIds: v.array(v.id('_storage')) },
  handler: async (ctx, { storageIds }) => {
    await requireCjAdminIdentity(ctx);
    if (!storageIds.length || storageIds.length > 20 || new Set(storageIds).size !== storageIds.length)
      throw new Error('Resolve 1-20 distinct uploaded images.');
    return Promise.all(storageIds.map(async storageId => {
      const metadata = await ctx.db.system.get(storageId);
      if (!metadata || !['image/jpeg', 'image/png', 'image/webp'].includes(metadata.contentType ?? '') || metadata.size <= 0 || metadata.size > 20 * 1024 * 1024)
        throw new Error('Uploaded image must be JPEG, PNG or WebP and at most 20MB.');
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error('Uploaded image is unavailable.');
      return { storageId, url, contentType: metadata.contentType, size: metadata.size };
    }));
  },
});

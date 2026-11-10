// Names, slugs and the media pipeline (spec S14, v2 §5). Supplier images are fetched from
// allowlisted hosts only, validated from their bytes, deduplicated by hash and stored privately;
// a person verifies each against SKU, colour and pack and writes the alt text before it can be
// used. A failed or unverified image keeps the listing in draft.
import { v, type Infer } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { openHold, resolveHold } from './catCore';
import { CommerceError } from '../lib/errors';
import { safeFetch, sniffImage } from '../lib/safeFetch';
import { nameProblems, slugify } from '../lib/slug';

const MIN_EDGE = 800;

export const stagedPrimary = internalQuery({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const cv = await ctx.db.get(a.variantId);
    const product = cv ? await ctx.db.get(cv.productId) : null;
    const staging = product?.zuoStaging;
    if (!cv || cv.availability === 'discontinued' || !product || product.provider !== 'zuo' || !staging || staging.excluded
      || staging.sku !== cv.supplierSku || staging.pack !== cv.piecesPerPack)
      throw new CommerceError('INVALID_INPUT', 'No matching included staged SKU and pack');
    let evidence;
    try { evidence = JSON.parse(staging.sourceEvidence); } catch { throw new CommerceError('INVALID_INPUT', 'Source evidence is invalid'); }
    const primary = evidence?.primaryMedia;
    if (!primary || typeof primary.storageId !== 'string' || typeof primary.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(primary.sha256) || typeof primary.sourceURL !== 'string'
      || !Array.isArray(evidence.sourceImageUrls) || !evidence.sourceImageUrls.includes(primary.sourceURL))
      throw new CommerceError('INVALID_INPUT', 'No uploaded primary image with source hash and URL evidence');
    const storageId = ctx.db.system.normalizeId('_storage', primary.storageId);
    const url = storageId ? await ctx.storage.getUrl(storageId) : null;
    if (!storageId || !url || url !== primary.url || !product.draft.images.includes(url))
      throw new CommerceError('INVALID_INPUT', 'Uploaded image is not mapped to this staged product');
    const existing = (await ctx.db.query('catMediaAssets').withIndex('by_product', q => q.eq('productId', cv.productId).eq('role', 'hero')).collect())
      .find(m => m.variantId === cv._id && m.storageId === storageId && m.contentHash === primary.sha256
        && m.sourceUrl === primary.sourceURL && m.derivatives.length > 0);
    return { productId: cv.productId, storageId, sha256: primary.sha256 as string,
      sourceUrl: primary.sourceURL as string, evidenceRef: `Staging manifest ${staging.manifestSha256}; SKU ${cv.supplierSku}`,
      prepared: existing ? { assetId: existing._id, widths: existing.derivatives.map(d => d.width) } : null };
  },
});

export const attachDerivatives = internalMutation({
  args: { assetId: v.id('catMediaAssets'), sourceStorageId: v.id('_storage'), contentHash: v.string(),
    derivatives: v.array(v.object({ width: v.number(), storageId: v.id('_storage'), format: v.string() })) },
  handler: async (ctx, a) => {
    const asset = await ctx.db.get(a.assetId);
    if (!asset || asset.storageId !== a.sourceStorageId || asset.contentHash !== a.contentHash)
      throw new CommerceError('INVALID_INPUT', 'Image source changed');
    if (!a.derivatives.length || a.derivatives.length > 3 || new Set(a.derivatives.map(d => d.width)).size !== a.derivatives.length)
      throw new CommerceError('INVALID_INPUT', 'Invalid derivative set');
    for (const d of a.derivatives) {
      const metadata = await ctx.db.system.get(d.storageId);
      if (!Number.isInteger(d.width) || d.width < 1 || d.width > 2048 || d.format !== 'webp'
        || d.storageId === asset.storageId || !metadata?.size
        || (metadata.contentType !== undefined && metadata.contentType !== 'image/webp'))
        throw new CommerceError('INVALID_INPUT', 'Invalid stored WebP derivative');
    }
    if (asset.derivatives.length) return false;
    await ctx.db.patch(asset._id, { derivatives: a.derivatives });
    return true;
  },
});

export const reviewQueue = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25) throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('catVariants').paginate(a.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(async cv => {
      const product = await ctx.db.get(cv.productId);
      const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', cv.productId)).unique();
      const assets = await ctx.db.query('catMediaAssets').withIndex('by_product', q => q.eq('productId', cv.productId)).collect();
      return { variantId: cv._id, productId: cv.productId, sku: cv.supplierSku, packId: cv.packId,
        piecesPerPack: cv.piecesPerPack, color: cv.color ?? null, name: product?.draft.name ?? cv.louieMaeVariantName,
        supplierName: meta?.supplierName ?? cv.supplierVariantName, supplierVariantName: cv.supplierVariantName,
        variantName: cv.louieMaeVariantName,
        hasStagedSource: !!product?.zuoStaging && !product.zuoStaging.excluded && cv.availability !== 'discontinued',
        mediaHold: cv.holds.includes('MEDIA_MISSING'), rightsHold: cv.holds.includes('MEDIA_RIGHTS'),
        assets: await Promise.all(assets.filter(m => m.variantId === cv._id || (!m.variantId && m.verifiedAgainst?.sku === cv.supplierSku)).map(async m => ({
          id: m._id, role: m.role, status: m.status, altText: m.altText, rejectReason: m.rejectReason ?? null,
          widths: m.derivatives.map(d => d.width), rights: m.rights,
          url: m.derivatives[0]?.storageId || m.storageId ? await ctx.storage.getUrl(m.derivatives[0]?.storageId ?? m.storageId!) : null,
        }))),
      };
    })) };
  },
});

export function verifiedImageMatches(asset: Doc<'catMediaAssets'>, cv: Doc<'catVariants'>) {
  return asset.productId === cv.productId && (!asset.variantId || asset.variantId === cv._id)
    && asset.status === 'verified' && !!asset.storageId
    && (asset.role === 'hero' || asset.role === 'gallery')
    && !!asset.rights.basis.trim() && asset.altText.trim().length >= 8
    && asset.verifiedAgainst?.sku.trim() === cv.supplierSku
    && asset.verifiedAgainst?.pack?.trim() === cv.packId
    && (!cv.color || asset.verifiedAgainst?.color?.trim().toLowerCase() === cv.color.trim().toLowerCase());
}

export const record = internalMutation({
  args: {
    productId: v.id('commerceProducts'),
    variantId: v.optional(v.id('catVariants')),
    role: v.union(v.literal('hero'), v.literal('gallery'), v.literal('assembly'), v.literal('swatch')),
    storageId: v.optional(v.id('_storage')),
    contentHash: v.string(),
    mime: v.string(),
    width: v.number(),
    height: v.number(),
    bytes: v.number(),
    sourceUrl: v.string(),
    rights: v.object({ basis: v.string(), evidenceRef: v.optional(v.string()), attributionRequired: v.boolean(), privateOriginal: v.boolean() }),
    status: v.union(v.literal('pending'), v.literal('rejected')),
    rejectReason: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (!await ctx.db.get(a.productId)) throw new CommerceError('INVALID_INPUT', 'Product not found');
    if (a.variantId && (await ctx.db.get(a.variantId))?.productId !== a.productId)
      throw new CommerceError('INVALID_INPUT', 'Image variant does not belong to this product');
    // Content identity is not merchandising identity. The same photo can have distinct
    // roles and SKU associations; retries must also preserve their rights evidence.
    const matches = await ctx.db.query('catMediaAssets').withIndex('by_product', q => q.eq('productId', a.productId).eq('role', a.role)).collect();
    const dup = matches.find(m => m.contentHash === a.contentHash && m.variantId === a.variantId
      && m.sourceUrl === a.sourceUrl && m.rights.basis === a.rights.basis
      && m.rights.evidenceRef === a.rights.evidenceRef
      && m.rights.attributionRequired === a.rights.attributionRequired
      && m.rights.privateOriginal === a.rights.privateOriginal);
    if (dup) return { id: dup._id, duplicate: true };
    const id = await ctx.db.insert('catMediaAssets', { ...a, derivatives: [], altText: '', createdAt: Date.now() });
    return { id, duplicate: false };
  },
});

/** Fetches and stores one supplier image for review. Never publishes it. */
export const ingest = action({
  args: {
    productId: v.id('commerceProducts'),
    variantId: v.optional(v.id('catVariants')),
    url: v.string(),
    role: v.union(v.literal('hero'), v.literal('gallery'), v.literal('assembly'), v.literal('swatch')),
    rights: v.object({ basis: v.string(), evidenceRef: v.optional(v.string()), attributionRequired: v.boolean(), privateOriginal: v.boolean() }),
  },
  handler: async (ctx, a): Promise<{ id: Id<'catMediaAssets'>; duplicate: boolean; status: string; reason?: string }> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const base = { productId: a.productId, ...(a.variantId ? { variantId: a.variantId } : {}), role: a.role, sourceUrl: a.url, rights: a.rights };
    const res = await safeFetch(a.url);
    if (res.ok === false) {
      const failure = res.reason;
      const r = await ctx.runMutation(internal.catMedia.record, { ...base, contentHash: `failed:${a.url}`, mime: '', width: 0, height: 0, bytes: 0, status: 'rejected', rejectReason: failure });
      return { ...r, status: 'rejected', reason: failure };
    }
    const info = sniffImage(res.bytes);
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', res.bytes);
    const contentHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join('');
    const reason = !info ? 'not an image (bytes did not match a supported format)' : Math.min(info.width, info.height) < (a.role === 'swatch' ? 100 : MIN_EDGE) ? `too small (${info.width}×${info.height})` : undefined;
    let storageId: Id<'_storage'> | undefined;
    if (!reason && info) storageId = await ctx.storage.store(new Blob([res.bytes], { type: info.mime }));
    const r = await ctx.runMutation(internal.catMedia.record, {
      ...base,
      ...(storageId ? { storageId } : {}),
      contentHash,
      mime: info?.mime ?? res.contentType,
      width: info?.width ?? 0,
      height: info?.height ?? 0,
      bytes: res.bytes.byteLength,
      status: reason ? 'rejected' : 'pending',
      ...(reason ? { rejectReason: reason } : {}),
    });
    // This action created this blob. An idempotent record retry must not orphan it.
    if (r.duplicate && storageId) await ctx.storage.delete(storageId);
    return { ...r, status: reason ? 'rejected' : 'pending', ...(reason ? { reason } : {}) };
  },
});

/** A person confirms an image shows this SKU, colour and pack, and writes its alt text. */
const verifyArgs = { assetId: v.id('catMediaAssets'), altText: v.string(), sku: v.string(), color: v.optional(v.string()), pack: v.optional(v.string()), approve: v.boolean(), reason: v.optional(v.string()) };

async function verifyAsset(ctx: MutationCtx, a: Infer<typeof verifyValidator>, admin: { email: string }) {
    const asset = await ctx.db.get(a.assetId);
    if (!asset || !asset.storageId) throw new CommerceError('INVALID_INPUT', 'Image not found or not stored');
    if (a.approve) {
      if (a.altText.trim().length < 8) throw new CommerceError('INVALID_INPUT', 'Write accurate alt text (8 characters or more).');
      if (!asset.rights.basis.trim()) throw new CommerceError('INVALID_INPUT', 'Record the rights basis for this image.');
    }
    const variants = await ctx.db.query('catVariants').withIndex('by_product', q => q.eq('productId', asset.productId)).collect();
    const matching = variants.filter(cv => (!asset.variantId || cv._id === asset.variantId)
      && cv.supplierSku === a.sku.trim() && cv.packId === a.pack?.trim()
      && (!cv.color || cv.color.trim().toLowerCase() === a.color?.trim().toLowerCase()));
    if (a.approve && matching.length !== 1)
      throw new CommerceError('INVALID_INPUT', 'Verify the exact SKU, pack ID and color for one matching variant.');
    if (a.approve && asset.verifiedAgainst && (
      asset.verifiedAgainst.sku.trim() !== a.sku.trim()
      || asset.verifiedAgainst.pack?.trim() !== a.pack?.trim()
      || asset.verifiedAgainst.color?.trim().toLowerCase() !== a.color?.trim().toLowerCase()
    )) throw new CommerceError('INVALID_INPUT', 'Create a separate media association to review a different SKU, pack or color.');
    if (a.approve && !await ctx.storage.getUrl(asset.storageId))
      throw new CommerceError('INVALID_INPUT', 'Stored image is unavailable');
    await ctx.db.patch(asset._id, a.approve ? { status: 'verified', altText: a.altText.trim(), verifiedAgainst: { sku: a.sku, ...(a.color ? { color: a.color } : {}), ...(a.pack ? { pack: a.pack } : {}) } } : { status: 'rejected', rejectReason: a.reason ?? 'Rejected in review' });
    // A verified image clears the import's media hold for the variants it was verified against.
    if (a.approve) {
      // An assembly sheet or swatch cannot substitute for a product photograph.
      if (asset.role === 'hero' || asset.role === 'gallery')
        await resolveHold(ctx, matching[0]._id, 'MEDIA_MISSING', admin.email, 'Verified exact SKU and pack image');
    } else if (asset.status === 'verified') {
      // Withdrawal must immediately stop new sales until another image is reviewed.
      // Historical paid snapshots are intentionally left intact.
      for (const cv of variants) if (asset.variantId ? cv._id === asset.variantId
        : cv.supplierSku === asset.verifiedAgainst?.sku && cv.packId === asset.verifiedAgainst?.pack)
        await openHold(ctx, cv._id, 'MEDIA_MISSING', 'Previously verified image rejected; review replacement media', admin.email);
    }
    await audit(ctx, { actor: admin.email, action: a.approve ? 'media.verify' : 'media.reject', entityTable: 'catMediaAssets', entityId: asset._id, reason: a.reason });
}
const verifyValidator = v.object(verifyArgs);
export const verify = mutation({
  args: verifyValidator,
  handler: async (ctx, a) => verifyAsset(ctx, a, await requireCjAdminIdentity(ctx)),
});

/** Admin-CLI application of an externally reviewed, hash-bound supplier photo manifest.
 * Does not grant media rights, change prices, or publish products. */
export const applyReviewedZuoPhotos = internalMutation({
  args: { dryRun: v.boolean(), reviewSha256: v.string(), sourceSha256: v.string(),
    rows: v.array(v.object({ variantId: v.id('catVariants'), sku: v.string(),
      piecesPerPack: v.number(), contentHash: v.string(), sourceUrl: v.string(),
      altText: v.string(), reviewNote: v.string() })) },
  handler: async (ctx, a) => {
    if (!/^[a-f0-9]{64}$/.test(a.reviewSha256) || !/^[a-f0-9]{64}$/.test(a.sourceSha256)
      || a.rows.length < 1 || a.rows.length > 20 || new Set(a.rows.map(r => r.variantId)).size !== a.rows.length)
      throw new CommerceError('INVALID_INPUT', 'Invalid reviewed manifest');
    const results = [];
    for (const row of a.rows) {
      const cv = await ctx.db.get(row.variantId);
      const product = cv ? await ctx.db.get(cv.productId) : null;
      if (!cv || !product || product.provider !== 'zuo' || cv.supplierSku !== row.sku
        || cv.piecesPerPack !== row.piecesPerPack || cv.availability === 'discontinued'
        || !/^[a-f0-9]{64}$/.test(row.contentHash) || row.altText.trim().length < 8
        || row.reviewNote.trim().length < 20)
        throw new CommerceError('INVALID_INPUT', 'Reviewed SKU or pack mismatch');
      const assets = (await ctx.db.query('catMediaAssets').withIndex('by_product', q => q.eq('productId', cv.productId).eq('role', 'hero')).collect())
        .filter(m => m.variantId === cv._id && m.contentHash === row.contentHash && m.sourceUrl === row.sourceUrl);
      if (assets.length !== 1) throw new CommerceError('INVALID_INPUT', 'Reviewed image association is not unique');
      const asset = assets[0];
      if (asset.status === 'rejected' || !asset.storageId || !asset.rights.basis.trim()
        || !await ctx.storage.getUrl(asset.storageId))
        throw new CommerceError('INVALID_INPUT', 'Reviewed image is unavailable or rejected');
      const already = verifiedImageMatches(asset, cv) && asset.altText === row.altText.trim();
      if (!a.dryRun && !already) await verifyAsset(ctx, { assetId: asset._id, sku: cv.supplierSku,
        pack: cv.packId, color: cv.color, approve: true, altText: row.altText,
        reason: `Visual manifest ${a.reviewSha256}; supplier image workbook ${a.sourceSha256}; ${row.reviewNote}` },
        { email: 'system:reviewed-zuo-photo-manifest' });
      results.push({ variantId: cv._id, assetId: asset._id, status: already ? 'already_verified' : a.dryRun ? 'ready' : 'verified' });
    }
    return { results };
  },
});

export const productMedia = query({
  args: { productId: v.id('commerceProducts') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('catMediaAssets').withIndex('by_product', (q) => q.eq('productId', a.productId)).collect();
    return Promise.all(rows.map(async (r) => ({ ...r, url: r.storageId ? await ctx.storage.getUrl(r.storageId) : null })));
  },
});

/** Renames a product: short Louie Mae name, unique slug, and the old slug kept as a redirect. */
export const rename = mutation({
  args: { productId: v.id('commerceProducts'), name: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const problems = nameProblems(a.name);
    if (problems.length) throw new CommerceError('INVALID_INPUT', problems.join('; '), problems[0]);
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', a.productId)).first();
    if (!meta) throw new CommerceError('INVALID_INPUT', 'Product has no catalog record');
    const name = a.name.trim();
    const sameName = await ctx.db.query('catProductMeta').withIndex('by_supplier', (q) => q.eq('supplierId', meta.supplierId)).collect();
    if (sameName.some((m) => m._id !== meta._id && m.louieMaeName.toLowerCase() === name.toLowerCase())) throw new CommerceError('INVALID_INPUT', 'Another product already uses this name', 'Another product already uses this name.');
    const slug = slugify(name) || 'product';
    const clash = await ctx.db.query('catProductMeta').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
    const finalSlug = clash && clash._id !== meta._id ? `${slug}-${meta.supplierProductRef?.toLowerCase() ?? String(meta._id).slice(-6)}` : slug;
    const now = Date.now();
    await ctx.db.patch(meta._id, {
      louieMaeName: name,
      slug: finalSlug,
      slugHistory: finalSlug === meta.slug ? meta.slugHistory : [...meta.slugHistory, { slug: meta.slug, until: now }],
      holds: meta.holds.filter((h) => h !== 'NAME_COLLISION'),
      updatedAt: now,
    });
    const product = await ctx.db.get(a.productId);
    if (product) await ctx.db.patch(product._id, { draft: { ...product.draft, name }, revision: product.revision + 1, updatedAt: now });
    await audit(ctx, { actor: admin.email, action: 'product.rename', entityTable: 'commerceProducts', entityId: a.productId, before: meta.louieMaeName, after: name });
    return finalSlug;
  },
});

/** Resolves a current or former slug to the product's current slug (for storefront redirects). */
export const resolveSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const direct = await ctx.db.query('catProductMeta').withIndex('by_slug', (q) => q.eq('slug', a.slug)).first();
    if (direct) return { productId: direct.productId, slug: direct.slug, redirected: false };
    // Former slugs: bounded scan of recently renamed products.
    const recent = await ctx.db.query('catProductMeta').order('desc').take(2000);
    const old = recent.find((m) => m.slugHistory.some((h) => h.slug === a.slug));
    return old ? { productId: old.productId, slug: old.slug, redirected: true } : null;
  },
});

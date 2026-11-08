// Names, slugs and the media pipeline (spec S14, v2 §5). Supplier images are fetched from
// allowlisted hosts only, validated from their bytes, deduplicated by hash and stored privately;
// a person verifies each against SKU, colour and pack and writes the alt text before it can be
// used. A failed or unverified image keeps the listing in draft.
import { v } from 'convex/values';
import { action, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { resolveHold } from './catCore';
import { CommerceError } from '../lib/errors';
import { safeFetch, sniffImage } from '../lib/safeFetch';
import { nameProblems, slugify } from '../lib/slug';

const MIN_EDGE = 800;

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
    const dup = await ctx.db.query('catMediaAssets').withIndex('by_hash', (q) => q.eq('contentHash', a.contentHash)).first();
    if (dup && dup.productId === a.productId) return { id: dup._id, duplicate: true };
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
    return { ...r, status: reason ? 'rejected' : 'pending', ...(reason ? { reason } : {}) };
  },
});

/** A person confirms an image shows this SKU, colour and pack, and writes its alt text. */
export const verify = mutation({
  args: { assetId: v.id('catMediaAssets'), altText: v.string(), sku: v.string(), color: v.optional(v.string()), pack: v.optional(v.string()), approve: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const asset = await ctx.db.get(a.assetId);
    if (!asset || !asset.storageId) throw new CommerceError('INVALID_INPUT', 'Image not found or not stored');
    if (a.approve) {
      if (a.altText.trim().length < 8) throw new CommerceError('INVALID_INPUT', 'Write accurate alt text (8 characters or more).');
      if (!asset.rights.basis.trim()) throw new CommerceError('INVALID_INPUT', 'Record the rights basis for this image.');
    }
    await ctx.db.patch(asset._id, a.approve ? { status: 'verified', altText: a.altText.trim(), verifiedAgainst: { sku: a.sku, ...(a.color ? { color: a.color } : {}), ...(a.pack ? { pack: a.pack } : {}) } } : { status: 'rejected', rejectReason: a.reason ?? 'Rejected in review' });
    // A verified image clears the import's media hold for the variants it was verified against.
    if (a.approve) {
      const variants = await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', asset.productId)).collect();
      for (const cv of variants) if ((asset.variantId ? cv._id === asset.variantId : cv.supplierSku === a.sku) || asset.role === 'hero') await resolveHold(ctx, cv._id, 'MEDIA_MISSING', admin.email, 'Verified image');
    }
    await audit(ctx, { actor: admin.email, action: a.approve ? 'media.verify' : 'media.reject', entityTable: 'catMediaAssets', entityId: asset._id, reason: a.reason });
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

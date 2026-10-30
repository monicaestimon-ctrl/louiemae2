import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { parseDims, type DimsCm } from '../lib/holmDims';

// Asset readiness for House products: dimensions, a seamless cutout and a 3D model.
// The Studio offers products with dimensions and a cutout; 3D appears only where a model is approved.

type Ctx = QueryCtx | MutationCtx;
const MAX_MODEL_BYTES = 3 * 1024 * 1024;

export async function assetsFor(ctx: Ctx, productId: Id<'commerceProducts'>) {
  return ctx.db
    .query('holmAssets')
    .withIndex('by_product', (q) => q.eq('productId', productId).eq('variantId', undefined))
    .first();
}

/** Every product-level asset row in one read, for the catalog. */
export async function assetIndex(ctx: Ctx) {
  const rows = await ctx.db.query('holmAssets').take(2000);
  return new Map(rows.filter((r) => !r.variantId).map((r) => [r.productId, r]));
}

/** The asset fields a catalog item carries to the site. Manual dimensions win over parsed ones. */
export async function publicAssets(ctx: Ctx, a: Doc<'holmAssets'> | undefined, facts: string) {
  const parsed = parseDims(facts);
  const dims: DimsCm | null = a?.dimsCm ?? parsed;
  return {
    dimsCm: dims,
    dimsSource: a?.dimsCm ? (a.dimsSource ?? 'manual') : parsed ? 'parsed' : null,
    cutoutUrl: a?.cutoutId && a.cutoutStatus === 'approved' ? await ctx.storage.getUrl(a.cutoutId) : null,
    cutoutAspect: a?.cutoutStatus === 'approved' ? (a.cutoutAspect ?? null) : null,
    modelUrl: a?.modelId && a.modelStatus === 'approved' ? await ctx.storage.getUrl(a.modelId) : null,
    modelLowUrl: a?.modelLowId && a.modelStatus === 'approved' ? await ctx.storage.getUrl(a.modelLowId) : null,
    hangs: a?.hangs ?? null,
    mountHeightCm: a?.mountHeightCm ?? null,
  };
}

async function upsert(ctx: MutationCtx, productId: Id<'commerceProducts'>, patch: Partial<Doc<'holmAssets'>>) {
  const row = await assetsFor(ctx, productId);
  if (row) await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  else await ctx.db.insert('holmAssets', { productId, ...patch, updatedAt: Date.now() });
}

/** Every House product with a dot for each asset. */
export const readiness = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const listings = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', 'house').eq('published', true))
      .take(300);
    return Promise.all(
      listings.map(async (l) => {
        const a = await assetsFor(ctx, l.productId);
        const parsed = parseDims(l.snapshot.facts);
        return {
          productId: l.productId,
          name: l.snapshot.name,
          image: l.snapshot.images[0] ?? null,
          images: l.snapshot.images.slice(0, 8),
          facts: l.snapshot.facts,
          dimsCm: a?.dimsCm ?? parsed,
          dimsSource: a?.dimsCm ? (a.dimsSource ?? 'manual') : parsed ? 'parsed' : null,
          cutoutUrl: a?.cutoutId ? await ctx.storage.getUrl(a.cutoutId) : null,
          cutoutStatus: a?.cutoutStatus ?? null,
          modelUrl: a?.modelId ? await ctx.storage.getUrl(a.modelId) : null,
          modelBytes: a?.modelBytes ?? null,
          modelStatus: a?.modelStatus ?? 'none',
          hangs: a?.hangs ?? false,
          mountHeightCm: a?.mountHeightCm ?? null,
        };
      })
    );
  },
});

const dimsArg = v.object({ w: v.number(), d: v.number(), h: v.number(), seatH: v.optional(v.number()), armH: v.optional(v.number()) });

export const setDims = mutation({
  args: { productId: v.id('commerceProducts'), dimsCm: v.union(dimsArg, v.null()), source: v.optional(v.union(v.literal('manual'), v.literal('supplier'))) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    if (a.dimsCm && [a.dimsCm.w, a.dimsCm.d, a.dimsCm.h].some((n) => !(n > 0) || n > 2000)) throw new Error('Enter width, depth and height in centimetres.');
    await upsert(ctx, a.productId, a.dimsCm ? { dimsCm: a.dimsCm, dimsSource: a.source ?? 'manual' } : { dimsCm: undefined, dimsSource: undefined });
  },
});

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setCutout = mutation({
  args: {
    productId: v.id('commerceProducts'),
    cutoutId: v.optional(v.id('_storage')),
    aspect: v.optional(v.number()),
    status: v.union(v.literal('draft'), v.literal('approved'), v.literal('removed')),
  },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const row = await assetsFor(ctx, a.productId);
    if (a.status === 'removed') {
      if (row?.cutoutId) await ctx.storage.delete(row.cutoutId);
      await upsert(ctx, a.productId, { cutoutId: undefined, cutoutAspect: undefined, cutoutStatus: undefined });
      return;
    }
    if (a.cutoutId && row?.cutoutId && row.cutoutId !== a.cutoutId) await ctx.storage.delete(row.cutoutId);
    await upsert(ctx, a.productId, {
      ...(a.cutoutId ? { cutoutId: a.cutoutId } : {}),
      ...(a.aspect && a.aspect > 0 ? { cutoutAspect: a.aspect } : {}),
      cutoutStatus: a.status,
    });
  },
});

export const setModel = mutation({
  args: {
    productId: v.id('commerceProducts'),
    modelId: v.optional(v.id('_storage')),
    modelLowId: v.optional(v.id('_storage')),
    status: v.union(v.literal('draft'), v.literal('approved'), v.literal('rejected')),
  },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const row = await assetsFor(ctx, a.productId);
    let bytes = row?.modelBytes;
    if (a.modelId) {
      const meta = await ctx.db.system.get(a.modelId);
      bytes = meta?.size;
      if (!meta || meta.size > MAX_MODEL_BYTES) {
        await ctx.storage.delete(a.modelId);
        throw new Error('Models must be under 3 MB. Compress it (Draco or Meshopt, KTX2 textures) and upload again.');
      }
      if (row?.modelId && row.modelId !== a.modelId) await ctx.storage.delete(row.modelId);
    }
    if (a.modelLowId && row?.modelLowId && row.modelLowId !== a.modelLowId) await ctx.storage.delete(row.modelLowId);
    await upsert(ctx, a.productId, {
      ...(a.modelId ? { modelId: a.modelId, modelBytes: bytes } : {}),
      ...(a.modelLowId ? { modelLowId: a.modelLowId } : {}),
      modelStatus: a.status,
    });
  },
});

export const setMount = mutation({
  args: { productId: v.id('commerceProducts'), hangs: v.boolean(), mountHeightCm: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    await upsert(ctx, a.productId, { hangs: a.hangs, mountHeightCm: a.hangs ? a.mountHeightCm : undefined });
  },
});

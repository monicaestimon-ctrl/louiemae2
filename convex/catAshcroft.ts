// Canonical Ashcroft identities only. This does not qualify prices, costs or stock.
import { internalMutation } from './functions';
import { internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { ensureSupplier, supplierByCode, openHold } from './catCore';
import { CommerceError } from '../lib/errors';
import { digest } from './dlvSecurity';
import { audit, openReview } from './sysCore';

type Ctx = QueryCtx | MutationCtx;
type Identity = { productId: Doc<'commerceProducts'>['_id']; variantId: string; sku: string; name: string; minimum: number; increment: number };

async function existingIdentity(ctx: Ctx, identity: Identity): Promise<Doc<'catVariants'> | null> {
  const supplier = await supplierByCode(ctx, 'ashcroft');
  const byProduct = await ctx.db.query('catVariants').withIndex('by_product', q => q.eq('productId', identity.productId)).take(201);
  if (byProduct.length > 200) throw new CommerceError('COST_REVIEW_REQUIRED', 'Product identity scope requires review');
  const sameLegacy = byProduct.filter(v => v.legacyVariantId === identity.variantId);
  const matches = supplier ? await ctx.db.query('catVariants').withIndex('by_identity', q =>
    q.eq('supplierId', supplier._id).eq('supplierSku', identity.sku).eq('packId', '1')).take(2) : [];
  if (matches.length > 1 || sameLegacy.length > 1) throw new CommerceError('COST_REVIEW_REQUIRED', 'Duplicate Ashcroft identity');
  const found = matches[0];
  if ((sameLegacy[0] && sameLegacy[0]._id !== found?._id) || (found &&
    (found.productId !== identity.productId || found.legacyVariantId !== identity.variantId || found.optionKey !== identity.variantId)))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Ashcroft SKU belongs to a different product or variant');
  if (found && (found.piecesPerPack !== 1 || found.orderMinimumPacks !== identity.minimum || found.orderIncrementPacks !== identity.increment))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Ashcroft selling-unit quantity basis changed; review required');
  return found ?? null;
}

/** Shared by delivery and the migration. A selling unit is not a claim about physical set contents. */
export async function ensureAshcroftIdentity(ctx: MutationCtx, identity: Identity, actor: string): Promise<Doc<'catVariants'>> {
  const product = await ctx.db.get(identity.productId);
  if (product?.provider !== 'ashcroft' || !identity.variantId || !identity.sku.trim()
    || !Number.isSafeInteger(identity.minimum) || identity.minimum < 1
    || !Number.isSafeInteger(identity.increment) || identity.increment < 1)
    throw new CommerceError('INVALID_INPUT', 'Invalid Ashcroft selling-unit identity');
  const existing = await existingIdentity(ctx, identity);
  if (existing) return existing;
  const supplier = await ensureSupplier(ctx, 'ashcroft');
  const now = Date.now();
  const id = await ctx.db.insert('catVariants', {
    productId: identity.productId, supplierId: supplier._id, supplierSku: identity.sku,
    packId: '1', optionKey: identity.variantId, legacyVariantId: identity.variantId,
    supplierVariantName: identity.name, louieMaeVariantName: identity.name,
    piecesPerPack: 1, orderMinimumPacks: identity.minimum, orderIncrementPacks: identity.increment,
    availability: 'unknown', fulfillmentRoute: 'manual_dealer_ashcroft',
    holds: [], createdAt: now, updatedAt: now,
  });
  await openHold(ctx, id, 'COST_MISSING', 'Ashcroft selling-unit cost evidence is required', actor);
  await openHold(ctx, id, 'MANUAL', 'New identity requires supplier-specific economics and release review', actor);
  await openReview(ctx, 'cost_review_required', 'catVariants', id, 'Record Ashcroft selling-unit cost and applicable expenses before v2 qualification');
  await audit(ctx, { actor, action: 'ashcroft.identity', entityTable: 'catVariants', entityId: id,
    after: { productId: identity.productId, legacyVariantId: identity.variantId, supplierSku: identity.sku },
    reason: 'Canonical selling-unit identity only; no cost, price, stock or publication approval' });
  return (await ctx.db.get(id))!;
}

async function source(ctx: Ctx, productId: Identity['productId'], variantId: string) {
  const product = await ctx.db.get(productId);
  const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', productId).eq('channel', 'retail')).unique();
  const house = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', productId).eq('channel', 'house')).unique();
  const options = retail?.snapshot.variants.filter(v => v.id === variantId) ?? [];
  const fulfillment = retail?.fulfillment?.filter(v => v.id === variantId) ?? [];
  const houseRoute = house?.fulfillment?.filter(v => v.id === variantId) ?? [];
  if (product?.provider !== 'ashcroft' || !retail?.published || options.length !== 1 || fulfillment.length !== 1
    || !fulfillment[0].sku.trim() || houseRoute.length > 1 || (houseRoute[0] && houseRoute[0].sku !== fulfillment[0].sku))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Published Ashcroft identity is missing or conflicts between channels');
  const option = options[0];
  const identity = { productId, variantId, sku: fulfillment[0].sku, name: option.name === 'Default Title' ? retail.snapshot.name : option.name,
    minimum: option.minimum, increment: option.increment };
  if (!Number.isSafeInteger(identity.minimum) || identity.minimum < 1 || !Number.isSafeInteger(identity.increment) || identity.increment < 1)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Selling-unit quantity rules require review');
  const fingerprint = await digest({ productRevision: product.revision, retailRevision: retail.revision,
    houseRevision: house?.revision ?? null, identity, option, fulfillment: fulfillment[0], houseRoute });
  return { identity, fingerprint };
}

/** Bounded/resumable read-only preview. Empty pages may precede later Ashcroft listings. */
export const preview = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const page = await ctx.db.query('commerceListings').withIndex('by_channel_published', q => q.eq('channel', 'retail').eq('published', true))
      .paginate({ cursor: a.cursor, numItems: 1 });
    const rows = [];
    for (const listing of page.page) {
      if ((await ctx.db.get(listing.productId))?.provider !== 'ashcroft') continue;
      if (listing.snapshot.variants.length > 20) {
        rows.push({ productId: listing.productId, variantId: '', status: 'review_required' as const, detail: 'More than 20 variants requires a scoped migration' });
        continue;
      }
      for (const option of listing.snapshot.variants) {
        try {
          const { identity, fingerprint } = await source(ctx, listing.productId, option.id);
          const existing = await existingIdentity(ctx, identity);
          rows.push({ ...identity, fingerprint, status: existing ? 'existing' as const : 'ready' as const, variantRecordId: existing?._id ?? null });
        } catch (e) {
          rows.push({ productId: listing.productId, variantId: option.id, status: 'review_required' as const, detail: String((e as Error).message) });
        }
      }
    }
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const commit = internalMutation({
  args: { rows: v.array(v.object({ productId: v.id('commerceProducts'), variantId: v.string(), fingerprint: v.string() })) },
  handler: async (ctx, a) => {
    if (!a.rows.length || a.rows.length > 20 || new Set(a.rows.map(r => `${r.productId}:${r.variantId}`)).size !== a.rows.length)
      throw new CommerceError('INVALID_INPUT', 'Commit 1–20 distinct reviewed identities');
    const result = [];
    for (const row of a.rows) {
      const current = await source(ctx, row.productId, row.variantId);
      if (current.fingerprint !== row.fingerprint) throw new CommerceError('INVALID_INPUT', 'Source changed; preview and review again');
      const variant = await ensureAshcroftIdentity(ctx, current.identity, 'deployment-admin:ashcroft-identities');
      result.push({ productId: row.productId, variantId: row.variantId, variantRecordId: variant._id });
    }
    return result;
  },
});

import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import {
  PRODUCT_NAME_NORMALIZATION_VERSION,
  normalizeProductName,
  validateProductDisplayName,
} from '../lib/productNames';

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;
type ClaimSource = 'ai' | 'manual' | 'migration';

export type ProductNameErrorCode =
  | 'NAME_INVALID'
  | 'NAME_ALREADY_USED'
  | 'NAME_CLAIM_INVALID'
  | 'NAME_CLAIM_OWNER_MISMATCH';

function fail(code: ProductNameErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

export async function findNameClaim(ctx: ReadCtx, normalizedName: string) {
  return ctx.db
    .query('productNameClaims')
    .withIndex('by_normalized_name', (q) => q.eq('normalizedName', normalizedName))
    .unique();
}

async function findProductNameConflict(ctx: ReadCtx, normalizedName: string, exceptProductId?: Id<'products'>) {
  const indexed = await ctx.db
    .query('products')
    .withIndex('by_name_key', (q) => q.eq('nameKey', normalizedName))
    .first();
  if (indexed && indexed._id !== exceptProductId) return indexed;

  // Temporary compatibility guard for pre-migration documents only.
  const legacyProducts = await ctx.db
    .query('products')
    .withIndex('by_name_key', (q) => q.eq('nameKey', undefined))
    .collect();
  return legacyProducts.find(
    (product) => product._id !== exceptProductId && normalizeProductName(product.name) === normalizedName,
  );
}

async function writeNameEvent(
  ctx: MutationCtx,
  args: {
    claimId: Id<'productNameClaims'>;
    normalizedName: string;
    displayName: string;
    eventType: 'suggested' | 'activated' | 'retired';
    ownerKey: string;
    productId?: Id<'products'>;
    source: ClaimSource;
    requestId?: string;
    createdAt: number;
  },
) {
  await ctx.db.insert('productNameEvents', args);
}

export async function claimProductName(
  ctx: MutationCtx,
  args: {
    displayName: string;
    ownerKey: string;
    source: Exclude<ClaimSource, 'migration'>;
    pendingClaimId?: Id<'productNameClaims'>;
    productId?: Id<'products'>;
    requestId?: string;
  },
): Promise<{ claimId: Id<'productNameClaims'>; normalizedName: string }> {
  const displayName = args.displayName.trim();
  const normalizedName = normalizeProductName(displayName);
  const existingClaim = normalizedName ? await findNameClaim(ctx, normalizedName) : null;
  if (existingClaim?.status === 'active' && existingClaim.productId === args.productId) {
    return { claimId: existingClaim._id, normalizedName };
  }
  const validationErrors = validateProductDisplayName(displayName);
  if (validationErrors.length > 0) fail('NAME_INVALID', validationErrors.join(' '));
  if (!args.ownerKey.trim()) fail('NAME_CLAIM_INVALID', 'A name owner is required. Please reopen the editor and try again.');

  const claim = existingClaim;
  const productConflict = await findProductNameConflict(ctx, normalizedName, args.productId);
  if (productConflict) {
    fail('NAME_ALREADY_USED', 'That product name is already in the catalog or its history. Choose a different name.');
  }

  if (claim) {
    const isSameActiveProduct = claim.status === 'active' && claim.productId === args.productId;
    if (isSameActiveProduct) return { claimId: claim._id, normalizedName };
    if (!args.pendingClaimId || args.pendingClaimId !== claim._id) {
      fail('NAME_ALREADY_USED', 'That product name has already been suggested, used, or retired. Choose a different name.');
    }
    if (claim.ownerKey !== args.ownerKey) {
      fail('NAME_CLAIM_OWNER_MISMATCH', 'This name suggestion belongs to another product draft. Generate a new name.');
    }
    if (claim.status !== 'suggested' || claim.productId) {
      fail('NAME_ALREADY_USED', 'That product name is no longer available. Generate a new name.');
    }
    const now = Date.now();
    await ctx.db.patch(claim._id, {
      displayName,
      status: 'active',
      productId: args.productId,
      updatedAt: now,
    });
    if (args.productId) {
      await writeNameEvent(ctx, {
        claimId: claim._id,
        normalizedName,
        displayName,
        eventType: 'activated',
        ownerKey: args.ownerKey,
        productId: args.productId,
        source: args.source,
        requestId: args.requestId,
        createdAt: now,
      });
    }
    return { claimId: claim._id, normalizedName };
  }

  if (args.pendingClaimId) fail('NAME_CLAIM_INVALID', 'The selected name suggestion could not be verified. Generate a new name.');
  const now = Date.now();
  const claimId = await ctx.db.insert('productNameClaims', {
    normalizedName,
    displayName,
    normalizationVersion: PRODUCT_NAME_NORMALIZATION_VERSION,
    status: 'active',
    ownerKey: args.ownerKey,
    productId: args.productId,
    source: args.source,
    requestId: args.requestId,
    createdAt: now,
    updatedAt: now,
  });
  if (args.productId) {
    await writeNameEvent(ctx, {
      claimId,
      normalizedName,
      displayName,
      eventType: 'activated',
      ownerKey: args.ownerKey,
      productId: args.productId,
      source: args.source,
      requestId: args.requestId,
      createdAt: now,
    });
  }
  return { claimId, normalizedName };
}

export async function attachNameClaimToProduct(
  ctx: MutationCtx,
  claimId: Id<'productNameClaims'>,
  productId: Id<'products'>,
) {
  const claim = await ctx.db.get(claimId);
  if (!claim) fail('NAME_CLAIM_INVALID', 'The product name claim is missing.');
  if (claim.productId && claim.productId !== productId) {
    fail('NAME_CLAIM_INVALID', 'The product name claim is already attached to another product.');
  }
  if (claim.productId === productId) return;
  const now = Date.now();
  await ctx.db.patch(claimId, { productId, updatedAt: now });
  await writeNameEvent(ctx, {
    claimId,
    normalizedName: claim.normalizedName,
    displayName: claim.displayName,
    eventType: 'activated',
    ownerKey: claim.ownerKey,
    productId,
    source: claim.source,
    requestId: claim.requestId,
    createdAt: now,
  });
}

export async function retireProductName(ctx: MutationCtx, productId: Id<'products'>, claimId?: Id<'productNameClaims'>) {
  let claim = claimId
    ? await ctx.db.get(claimId)
    : await ctx.db.query('productNameClaims').withIndex('by_product', (q) => q.eq('productId', productId)).first();
  if (!claim) {
    const product = await ctx.db.get(productId);
    if (!product) return;
    const normalizedName = normalizeProductName(product.name);
    if (!normalizedName) return;
    claim = await findNameClaim(ctx, normalizedName);
    if (!claim) {
      const now = Date.now();
      const ownerKey = `product:${productId}`;
      const newClaimId = await ctx.db.insert('productNameClaims', {
        normalizedName,
        displayName: product.name.trim(),
        normalizationVersion: PRODUCT_NAME_NORMALIZATION_VERSION,
        status: 'retired',
        ownerKey,
        productId,
        source: 'migration',
        createdAt: now,
        updatedAt: now,
        retiredAt: now,
      });
      await writeNameEvent(ctx, {
        claimId: newClaimId,
        normalizedName,
        displayName: product.name.trim(),
        eventType: 'retired',
        ownerKey,
        productId,
        source: 'migration',
        createdAt: now,
      });
      return;
    }
  }
  if (claim.status === 'retired') return;
  const now = Date.now();
  await ctx.db.patch(claim._id, { status: 'retired', updatedAt: now, retiredAt: now });
  await writeNameEvent(ctx, {
    claimId: claim._id,
    normalizedName: claim.normalizedName,
    displayName: claim.displayName,
    eventType: 'retired',
    ownerKey: claim.ownerKey,
    productId,
    source: claim.source,
    requestId: claim.requestId,
    createdAt: now,
  });
}

export const reserveSuggestion = internalMutation({
  args: {
    displayName: v.string(),
    ownerKey: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const displayName = args.displayName.trim();
    if (validateProductDisplayName(displayName).length > 0 || !args.ownerKey.trim()) {
      return { reserved: false as const, reason: 'invalid' as const };
    }
    const normalizedName = normalizeProductName(displayName);
    const [existingClaim, productConflict] = await Promise.all([
      findNameClaim(ctx, normalizedName),
      findProductNameConflict(ctx, normalizedName),
    ]);
    if (existingClaim || productConflict) return { reserved: false as const, reason: 'collision' as const };

    const now = Date.now();
    const claimId = await ctx.db.insert('productNameClaims', {
      normalizedName,
      displayName,
      normalizationVersion: PRODUCT_NAME_NORMALIZATION_VERSION,
      status: 'suggested',
      ownerKey: args.ownerKey,
      source: 'ai',
      requestId: args.requestId,
      createdAt: now,
      updatedAt: now,
    });
    await writeNameEvent(ctx, {
      claimId,
      normalizedName,
      displayName,
      eventType: 'suggested',
      ownerKey: args.ownerKey,
      source: 'ai',
      requestId: args.requestId,
      createdAt: now,
    });
    return { reserved: true as const, claimId, normalizedName };
  },
});

export const listNamesForGeneration = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit || 120, 1), 240);
    const claims = await ctx.db.query('productNameClaims').withIndex('by_updated_at').order('desc').take(limit);
    const legacyProducts = await ctx.db
      .query('products')
      .withIndex('by_name_key', (q) => q.eq('nameKey', undefined))
      .take(limit);
    return [...new Set([...claims.map((claim) => claim.displayName), ...legacyProducts.map((product) => product.name)])]
      .slice(0, limit);
  },
});

export const checkAvailability = query({
  args: { displayName: v.string(), productId: v.optional(v.id('products')), pendingClaimId: v.optional(v.id('productNameClaims')), ownerKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const normalizedName = normalizeProductName(args.displayName);
    const claim = normalizedName ? await findNameClaim(ctx, normalizedName) : null;
    const ownsActiveName = claim?.productId === args.productId && claim?.status === 'active';
    if (ownsActiveName) return { available: true, code: 'AVAILABLE', message: 'This is the product’s reserved name.' };
    const validationErrors = validateProductDisplayName(args.displayName);
    if (validationErrors.length > 0) return { available: false, code: 'NAME_INVALID', message: validationErrors.join(' ') };
    const productConflict = await findProductNameConflict(ctx, normalizedName, args.productId);
    if (productConflict) return { available: false, code: 'NAME_ALREADY_USED', message: 'This name is already in the catalog.' };
    if (!claim) return { available: true, code: 'AVAILABLE', message: 'This name is available.' };
    const ownsSuggestion = claim._id === args.pendingClaimId && claim.ownerKey === args.ownerKey && claim.status === 'suggested';
    return ownsSuggestion
      ? { available: true, code: 'AVAILABLE', message: 'This name is reserved for this product.' }
      : { available: false, code: 'NAME_ALREADY_USED', message: 'This name has already been suggested, used, or retired.' };
  },
});

export const adminSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const claims = await ctx.db.query('productNameClaims').collect();
    return {
      total: claims.length,
      suggested: claims.filter((claim) => claim.status === 'suggested').length,
      active: claims.filter((claim) => claim.status === 'active').length,
      retired: claims.filter((claim) => claim.status === 'retired').length,
    };
  },
});

// Useful for admin repair tooling; normal product paths call the shared helpers directly.
export const retireForProduct = mutation({
  args: { productId: v.id('products') },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) return false;
    await retireProductName(ctx, product._id, product.activeNameClaimId);
    return true;
  },
});

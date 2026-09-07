import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { CollectionConfig } from '../types';
import { PRODUCT_NAME_NORMALIZATION_VERSION, normalizeProductName } from '../lib/productNames';
import { getEffectiveSubcategoryIds, normalizeCategoryAssignment } from '../lib/productCategories';
import {
  attachNameClaimToProduct,
  claimProductName,
  retireProductName,
} from './productNameRegistry';

function groupDuplicateNames(products: Array<{ _id: Id<'products'>; name: string }>) {
  const byKey = new Map<string, Array<{ productId: Id<'products'>; name: string }>>();
  for (const product of products) {
    const key = normalizeProductName(product.name);
    const group = byKey.get(key) || [];
    group.push({ productId: product._id, name: product.name });
    byKey.set(key, group);
  }
  return [...byKey.entries()]
    .filter(([key, group]) => Boolean(key) && group.length > 1)
    .map(([normalizedName, products]) => ({ normalizedName, products }));
}

const REPAIR_FIRST_NAMES = [
  'Ada', 'Amelie', 'Annika', 'Arden', 'Arlo', 'August', 'Beatrice', 'Birdie', 'Bria', 'Calla',
  'Celeste', 'Clara', 'Colette', 'Cora', 'Dahlia', 'Daisy', 'Edith', 'Ellis', 'Elodie', 'Elsie',
  'Esme', 'Estelle', 'Faye', 'Finn', 'Flora', 'Freya', 'Gemma', 'Hazel', 'Imogen', 'Iris',
  'Ivy', 'Jude', 'June', 'Lila', 'Linnea', 'Lottie', 'Luca', 'Lucia', 'Maeve', 'Maren',
  'Margot', 'Meadow', 'Mila', 'Miles', 'Noelle', 'Nora', 'Olive', 'Opal', 'Pearl', 'Poppy',
  'Remi', 'Romy', 'Rosalie', 'Rosie', 'Rowan', 'Rue', 'Sienna', 'Sylvie', 'Thea', 'Theo',
  'Vera', 'Willa', 'Willow', 'Wren',
];

function stableSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function repairProductType(name: string, category = ''): string {
  const context = `${category} ${name}`.toLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/outfits?\s*&?\s*sets?|\bsets?\b/, 'Set'], [/romper/, 'Romper'], [/overall/, 'Overall'],
    [/dress/, 'Dress'], [/jacket|layers?/, 'Jacket'], [/pants?|trousers?/, 'Pants'],
    [/shorts?/, 'Shorts'], [/tops?|shirts?|tees?/, 'Top'], [/cardigan|sweater/, 'Cardigan'],
    [/chair|stool/, 'Chair'], [/cabinet|sideboard/, 'Cabinet'], [/table|desk/, 'Table'],
    [/lamp|light/, 'Lamp'], [/vase|planter/, 'Vase'], [/rug|carpet/, 'Rug'],
  ];
  return matches.find(([pattern]) => pattern.test(context))?.[1] || 'Piece';
}

function repairModifier(name: string): string | undefined {
  const modifiers: Array<[RegExp, string]> = [
    [/embroider/, 'Embroidered'], [/elephant/, 'Elephant'], [/fleece/, 'Fleece'], [/floral/, 'Floral'],
    [/ruffle/, 'Ruffle'], [/stripe/, 'Stripe'], [/quilt/, 'Quilted'], [/denim/, 'Denim'],
    [/lace/, 'Lace'], [/sage/, 'Sage'], [/bow/, 'Bow'], [/knit/, 'Knit'],
  ];
  return modifiers.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1];
}

function chooseRepairName(product: { _id: Id<'products'>; name: string; category?: string }, used: Set<string>): string {
  const productType = repairProductType(product.name, product.category);
  const modifier = repairModifier(product.name);
  const seed = stableSeed(product._id);
  for (let offset = 0; offset < REPAIR_FIRST_NAMES.length * 2; offset += 1) {
    const firstName = REPAIR_FIRST_NAMES[(seed + offset) % REPAIR_FIRST_NAMES.length];
    const cycle = Math.floor(offset / REPAIR_FIRST_NAMES.length);
    const candidate = [firstName, modifier, productType, cycle > 0 ? cycle + 1 : undefined].filter(Boolean).join(' ');
    if (!used.has(normalizeProductName(candidate))) return candidate;
  }
  return `Mae ${productType} ${stableSeed(`${product._id}:${used.size}`)}`;
}

async function buildAudit(ctx: any) {
  const [products, claims, siteContent] = await Promise.all([
    ctx.db.query('products').collect(),
    ctx.db.query('productNameClaims').collect(),
    ctx.db.query('siteContent').first(),
  ]);
  const collections = (siteContent?.collections || []) as CollectionConfig[];
  const claimKeys = new Set(claims.map((claim: any) => claim.normalizedName));
  const categoryIssues = products.flatMap((product: any) => {
    const collection = collections.find((candidate) => candidate.id === product.collection);
    const ids = getEffectiveSubcategoryIds(product, collection);
    if (!collection) return [{ productId: product._id, name: product.name, collection: product.collection, category: product.category, subcategory: product.subcategory, issue: 'collection_missing' }];
    if (ids.length === 0) return [{ productId: product._id, name: product.name, collection: product.collection, category: product.category, subcategory: product.subcategory, issue: 'subcategory_unresolved' }];
    return [];
  });
  const parentIdIssues = collections.flatMap((collection) => collection.subcategories.flatMap((category) => {
    if (!category.parentCategory || category.parentCategoryId) return [];
    const parent = collection.subcategories.find((candidate) => candidate.title === category.parentCategory);
    return parent ? [] : [{ collectionId: collection.id, categoryId: category.id, parentTitle: category.parentCategory }];
  }));
  const duplicateNames = groupDuplicateNames(products);
  return {
    productCount: products.length,
    claimCount: claims.length,
    duplicateNames,
    invalidNormalizedNames: products
      .filter((product: any) => !normalizeProductName(product.name))
      .map((product: any) => ({ productId: product._id, name: product.name })),
    missingNameKeys: products.filter((product: any) => !product.nameKey).length,
    missingNameClaims: products.filter((product: any) => !claimKeys.has(normalizeProductName(product.name))).length,
    categoryIssues,
    parentIdIssues,
    readyForNameBackfill: duplicateNames.length === 0,
  };
}

export const audit = internalQuery({
  args: {},
  handler: buildAudit,
});

export const backfillCategoryParentIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const siteContent = await ctx.db.query('siteContent').first();
    if (!siteContent) return { updated: false, categoriesUpdated: 0 };
    let categoriesUpdated = 0;
    const collections = (siteContent.collections as CollectionConfig[]).map((collection) => ({
      ...collection,
      subcategories: collection.subcategories.map((category) => {
        if (category.parentCategoryId || !category.parentCategory) return category;
        const parent = collection.subcategories.find((candidate) => candidate.title === category.parentCategory);
        if (!parent) return category;
        categoriesUpdated += 1;
        return { ...category, parentCategoryId: parent.id };
      }),
    }));
    if (categoriesUpdated > 0) await ctx.db.patch(siteContent._id, { collections });
    return { updated: categoriesUpdated > 0, categoriesUpdated };
  },
});

export const repairDuplicateNames = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const [products, claims] = await Promise.all([
      ctx.db.query('products').collect(),
      ctx.db.query('productNameClaims').collect(),
    ]);
    const groups = groupDuplicateNames(products);
    const used = new Set([
      ...products.map((product) => normalizeProductName(product.name)),
      ...claims.map((claim) => claim.normalizedName),
    ]);
    const repairs: Array<{ productId: Id<'products'>; previousName: string; nextName: string; collection: string; category: string }> = [];

    for (const group of groups) {
      const groupedProducts = group.products
        .map(({ productId }) => products.find((product) => product._id === productId))
        .filter((product): product is NonNullable<typeof product> => Boolean(product))
        .sort((left, right) => {
          const leftPublished = !left.storefrontStatus || left.storefrontStatus === 'published' ? 0 : 1;
          const rightPublished = !right.storefrontStatus || right.storefrontStatus === 'published' ? 0 : 1;
          return leftPublished - rightPublished || left._creationTime - right._creationTime;
        });
      for (const product of groupedProducts.slice(1)) {
        const nextName = chooseRepairName(product, used);
        used.add(normalizeProductName(nextName));
        repairs.push({ productId: product._id, previousName: product.name, nextName, collection: product.collection, category: product.category });
      }
    }

    if (args.dryRun) return { dryRun: true, duplicateGroups: groups.length, repairs };
    for (const repair of repairs) {
      const product = await ctx.db.get(repair.productId);
      if (!product || product.name !== repair.previousName) {
        return { dryRun: false, completed: false, reason: 'Catalog changed after repair planning. Run the dry run again.', repairs: [] };
      }
      const normalizedName = normalizeProductName(repair.nextName);
      const now = Date.now();
      const ownerKey = `product:${product._id}`;
      const claimId = await ctx.db.insert('productNameClaims', {
        normalizedName,
        displayName: repair.nextName,
        normalizationVersion: PRODUCT_NAME_NORMALIZATION_VERSION,
        status: 'active',
        ownerKey,
        productId: product._id,
        source: 'migration',
        requestId: 'duplicate-repair-v1',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('productNameEvents', {
        claimId,
        normalizedName,
        displayName: repair.nextName,
        previousDisplayName: repair.previousName,
        eventType: 'activated',
        ownerKey,
        productId: product._id,
        source: 'migration',
        requestId: 'duplicate-repair-v1',
        createdAt: now,
      });
      await ctx.db.patch(product._id, {
        name: repair.nextName,
        nameKey: normalizedName,
        activeNameClaimId: claimId,
        searchText: [repair.nextName, product.description, product.category, product.collection, product.subcategory, ...(product.subcategoryIds || [])]
          .filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8_000),
      });
    }
    return { dryRun: false, completed: true, duplicateGroups: groups.length, repaired: repairs.length, repairs };
  },
});

export const backfillProductNames = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const products = await ctx.db.query('products').collect();
    const duplicates = groupDuplicateNames(products);
    if (duplicates.length > 0) return { completed: false, updated: 0, duplicateNames: duplicates };

    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 40)));
    const remainingProducts = products.filter(
      (product) => !product.nameKey || !product.activeNameClaimId,
    );
    const batch = remainingProducts.slice(0, limit);

    let updated = 0;
    for (const product of batch) {
      const normalizedName = normalizeProductName(product.name);
      if (!normalizedName) continue;
      let claim = await ctx.db
        .query('productNameClaims')
        .withIndex('by_normalized_name', (q) => q.eq('normalizedName', normalizedName))
        .unique();
      const now = Date.now();
      if (!claim) {
        const ownerKey = `product:${product._id}`;
        const claimId = await ctx.db.insert('productNameClaims', {
          normalizedName,
          displayName: product.name.trim(),
          normalizationVersion: PRODUCT_NAME_NORMALIZATION_VERSION,
          status: 'active',
          ownerKey,
          productId: product._id,
          source: 'migration',
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert('productNameEvents', {
          claimId,
          normalizedName,
          displayName: product.name.trim(),
          eventType: 'activated',
          ownerKey,
          productId: product._id,
          source: 'migration',
          createdAt: now,
        });
        claim = await ctx.db.get(claimId);
      }
      if (!claim || (claim.productId && claim.productId !== product._id)) {
        return { completed: false, updated, conflict: { productId: product._id, normalizedName } };
      }
      if (claim.status !== 'active' || claim.productId !== product._id) {
        await ctx.db.patch(claim._id, { status: 'active', productId: product._id, updatedAt: now });
      }
      if (product.nameKey !== normalizedName || product.activeNameClaimId !== claim._id) {
        await ctx.db.patch(product._id, { nameKey: normalizedName, activeNameClaimId: claim._id });
        updated += 1;
      }
    }
    const hasMore = remainingProducts.length > batch.length;
    return {
      completed: !hasMore,
      updated,
      processed: batch.length,
      remaining: Math.max(0, remainingProducts.length - batch.length),
      hasMore,
      duplicateNames: [],
    };
  },
});

export const backfillProductCategories = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const [products, siteContent] = await Promise.all([
      ctx.db.query('products').collect(),
      ctx.db.query('siteContent').first(),
    ]);
    const collections = (siteContent?.collections || []) as CollectionConfig[];
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 40)));
    const remainingProducts = products.filter(
      (product) => !product.subcategoryIds?.length || !product.primarySubcategoryId,
    );
    const batch = remainingProducts.slice(0, limit);
    let updated = 0;
    const skipped: Array<{ productId: Id<'products'>; name: string; reason: string }> = [];
    for (const product of batch) {
      const collection = collections.find((candidate) => candidate.id === product.collection);
      const ids = getEffectiveSubcategoryIds(product, collection);
      if (!collection || ids.length === 0) {
        skipped.push({ productId: product._id, name: product.name, reason: !collection ? 'collection_missing' : 'subcategory_unresolved' });
        continue;
      }
      const assignment = normalizeCategoryAssignment({ subcategoryIds: ids, primarySubcategoryId: ids[0] }, collection);
      if (assignment.errors.length > 0) {
        skipped.push({ productId: product._id, name: product.name, reason: assignment.errors.join(' ') });
        continue;
      }
      await ctx.db.patch(product._id, {
        subcategoryIds: assignment.subcategoryIds,
        primarySubcategoryId: assignment.primarySubcategoryId,
        category: assignment.category,
        subcategory: assignment.subcategory,
      });
      updated += 1;
    }
    const remaining = Math.max(0, remainingProducts.length - batch.length) + skipped.length;
    const hasMore = remaining > 0;
    return { completed: !hasMore, updated, processed: batch.length, remaining, hasMore, skipped };
  },
});

export const assignLegacyCategories = internalMutation({
  args: {
    assignments: v.array(v.object({
      productId: v.id('products'),
      subcategoryIds: v.array(v.string()),
      primarySubcategoryId: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const siteContent = await ctx.db.query('siteContent').first();
    const collections = (siteContent?.collections || []) as CollectionConfig[];
    const updated: Array<{ productId: Id<'products'>; category: string; subcategoryIds: string[] }> = [];
    for (const requested of args.assignments) {
      const product = await ctx.db.get(requested.productId);
      if (!product) throw new Error(`Product ${requested.productId} was not found.`);
      const collection = collections.find((candidate) => candidate.id === product.collection);
      if (!collection) throw new Error(`Collection ${product.collection} was not found.`);
      const assignment = normalizeCategoryAssignment(requested, collection, { requireOne: true });
      if (assignment.errors.length > 0) throw new Error(`${product.name}: ${assignment.errors.join(' ')}`);
      await ctx.db.patch(product._id, {
        category: assignment.category,
        subcategory: assignment.subcategory,
        subcategoryIds: assignment.subcategoryIds,
        primarySubcategoryId: assignment.primarySubcategoryId,
      });
      updated.push({ productId: product._id, category: assignment.category, subcategoryIds: assignment.subcategoryIds });
    }
    return { updated };
  },
});

export const readiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const audit = await buildAudit(ctx);
    return {
      ready: audit.duplicateNames.length === 0
        && audit.invalidNormalizedNames.length === 0
        && audit.missingNameKeys === 0
        && audit.missingNameClaims === 0
        && audit.categoryIssues.length === 0
        && audit.parentIdIssues.length === 0,
      ...audit,
    };
  },
});

export const runInvariantSmokeTest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const siteContent = await ctx.db.query('siteContent').first();
    const collections = (siteContent?.collections || []) as CollectionConfig[];
    const kids = collections.find((collection) => collection.id === 'kids');
    const girlsPants = kids?.subcategories.find((category) => category.id === 'girls-pants');
    const boysPants = kids?.subcategories.find((category) => category.id === 'boys-pants');
    if (!kids || !girlsPants || !boysPants) {
      return { passed: false, reason: 'Required Girls Pants and Boys Pants categories are missing.' };
    }

    const nonce = `${Date.now()}`;
    const name = `Mae Verification Pants ${nonce}`;
    const ownerKey = `smoke:${nonce}`;
    const assignment = normalizeCategoryAssignment({
      subcategoryIds: [girlsPants.id, boysPants.id],
      primarySubcategoryId: girlsPants.id,
    }, kids, { requireOne: true });
    if (assignment.errors.length > 0) return { passed: false, reason: assignment.errors.join(' ') };

    const nameClaim = await claimProductName(ctx, { displayName: name, ownerKey, source: 'manual' });
    const productId = await ctx.db.insert('products', {
      name,
      nameKey: nameClaim.normalizedName,
      activeNameClaimId: nameClaim.claimId,
      price: 1,
      description: 'Temporary internal production-readiness check.',
      images: [],
      category: assignment.category,
      subcategory: assignment.subcategory,
      subcategoryIds: assignment.subcategoryIds,
      primarySubcategoryId: assignment.primarySubcategoryId,
      collection: kids.id,
      storefrontStatus: 'hidden',
      inStock: false,
      publishedAt: new Date().toISOString(),
      searchText: `${name.toLowerCase()} ${assignment.subcategoryIds.join(' ')}`,
    });
    await attachNameClaimToProduct(ctx, nameClaim.claimId, productId);
    const saved = await ctx.db.get(productId);
    const multiCategorySaved = saved?.subcategoryIds?.includes(girlsPants.id)
      && saved.subcategoryIds.includes(boysPants.id)
      && saved.primarySubcategoryId === girlsPants.id;

    await retireProductName(ctx, productId, nameClaim.claimId);
    await ctx.db.delete(productId);
    let reuseBlocked = false;
    try {
      await claimProductName(ctx, { displayName: name, ownerKey: `smoke-reuse:${nonce}`, source: 'manual' });
    } catch {
      reuseBlocked = true;
    }
    const retiredClaim = await ctx.db.get(nameClaim.claimId);
    return {
      passed: Boolean(multiCategorySaved && reuseBlocked && retiredClaim?.status === 'retired'),
      multiCategorySaved: Boolean(multiCategorySaved),
      reuseBlocked,
      productDeleted: (await ctx.db.get(productId)) === null,
      claimStatus: retiredClaim?.status,
      normalizedName: nameClaim.normalizedName,
      testedSubcategoryIds: assignment.subcategoryIds,
    };
  },
});

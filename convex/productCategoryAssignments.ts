import { ConvexError } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import type { CollectionConfig } from '../types';
import { MAX_PRODUCT_SUBCATEGORIES, normalizeCategoryAssignment } from '../lib/productCategories';

export interface ProductCategoryInput {
  collection: string;
  category?: string;
  subcategory?: string;
  subcategoryIds?: string[];
  primarySubcategoryId?: string;
  storefrontStatus?: 'published' | 'hidden' | 'next_launch';
}

export interface PersistedCategoryAssignment {
  category: string;
  subcategory?: string;
  subcategoryIds?: string[];
  primarySubcategoryId?: string;
}

export async function resolveProductCategoryAssignment(
  ctx: MutationCtx,
  input: ProductCategoryInput,
): Promise<PersistedCategoryAssignment> {
  const siteContent = await ctx.db.query('siteContent').first();
  const collections = (siteContent?.collections || []) as CollectionConfig[];
  const collection = collections.find((candidate) => candidate.id === input.collection);
  const explicitIds = input.subcategoryIds?.filter(Boolean) || [];

  let candidateIds = explicitIds;
  if (candidateIds.length === 0 && collection) {
    const legacy = input.subcategory || input.category;
    const match = collection.subcategories.find(
      (candidate) => candidate.id === legacy || candidate.title === legacy,
    );
    if (match) candidateIds = [match.id];
  }

  if (explicitIds.length > 0 && !collection) {
    throw new ConvexError({ code: 'CATEGORY_COLLECTION_INVALID', message: 'The selected collection no longer exists.' });
  }

  const normalized = normalizeCategoryAssignment(
    { subcategoryIds: candidateIds, primarySubcategoryId: input.primarySubcategoryId },
    collection,
    { requireOne: input.storefrontStatus === 'published' },
  );
  const errors = [...normalized.errors];

  if (collection && explicitIds.length > 0) {
    const parentIds = new Set(
      collection.subcategories.map((category) => category.parentCategoryId).filter(Boolean),
    );
    const parentTitles = new Set(
      collection.subcategories.map((category) => category.parentCategory).filter(Boolean),
    );
    const nonLeaf = normalized.subcategoryIds.filter((id) => {
      const category = collection.subcategories.find((candidate) => candidate.id === id);
      return parentIds.has(id) || (category ? parentTitles.has(category.title) : false);
    });
    if (nonLeaf.length > 0) errors.push('Choose specific subcategories rather than a parent category.');
  }

  if (normalized.subcategoryIds.length > MAX_PRODUCT_SUBCATEGORIES) {
    errors.push(`A product may have no more than ${MAX_PRODUCT_SUBCATEGORIES} subcategories.`);
  }
  if (errors.length > 0) {
    throw new ConvexError({ code: 'CATEGORY_ASSIGNMENT_INVALID', message: [...new Set(errors)].join(' ') });
  }

  if (normalized.subcategoryIds.length === 0) {
    return {
      category: input.category || input.subcategory || '',
      subcategory: input.subcategory || undefined,
      subcategoryIds: undefined,
      primarySubcategoryId: undefined,
    };
  }

  return {
    category: normalized.category,
    subcategory: normalized.subcategory,
    subcategoryIds: normalized.subcategoryIds,
    primarySubcategoryId: normalized.primarySubcategoryId,
  };
}

import type { Category, CollectionConfig, Product } from '../types';

export const MAX_PRODUCT_SUBCATEGORIES = 8;

export interface CategoryAssignment {
  subcategoryIds: string[];
  primarySubcategoryId?: string;
}

export interface CategoryAssignmentResult extends CategoryAssignment {
  category: string;
  subcategory?: string;
  errors: string[];
}

const cleanIds = (ids: readonly string[] | undefined): string[] =>
  [...new Set((ids || []).map((id) => id.trim()).filter(Boolean))];

export function getCategoryById(collection: CollectionConfig | undefined, id: string | undefined): Category | undefined {
  if (!collection || !id) return undefined;
  return collection.subcategories.find((category) => category.id === id);
}

export function getCategoryParentId(category: Category, collection: CollectionConfig): string | undefined {
  if (category.parentCategoryId) return category.parentCategoryId;
  if (!category.parentCategory) return undefined;
  return collection.subcategories.find((candidate) => candidate.title === category.parentCategory)?.id;
}

export function getEffectiveSubcategoryIds(
  product: Pick<Product, 'subcategoryIds' | 'primarySubcategoryId' | 'subcategory' | 'category'>,
  collection: CollectionConfig | undefined,
): string[] {
  if (!collection) return cleanIds(product.subcategoryIds);
  const validIds = new Set(collection.subcategories.map((category) => category.id));
  const explicit = cleanIds(product.subcategoryIds).filter((id) => validIds.has(id));
  if (explicit.length > 0) return explicit;

  const legacyValue = product.subcategory || product.category;
  const legacyCategory = collection.subcategories.find(
    (category) => category.id === legacyValue || category.title === legacyValue,
  );
  return legacyCategory ? [legacyCategory.id] : [];
}

export function getCategoryAndAncestorIds(categoryId: string, collection: CollectionConfig): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let current = getCategoryById(collection, categoryId);
  while (current && !visited.has(current.id)) {
    result.push(current.id);
    visited.add(current.id);
    current = getCategoryById(collection, getCategoryParentId(current, collection));
  }
  return result;
}

export function productMatchesCategory(
  product: Pick<Product, 'subcategoryIds' | 'primarySubcategoryId' | 'subcategory' | 'category'>,
  requestedCategory: string,
  collection: CollectionConfig | undefined,
): boolean {
  if (!collection) return product.category === requestedCategory || product.subcategory === requestedCategory;
  const requested = collection.subcategories.find(
    (category) => category.id === requestedCategory || category.title === requestedCategory,
  );
  if (!requested) return product.category === requestedCategory || product.subcategory === requestedCategory;
  return getEffectiveSubcategoryIds(product, collection).some((id) =>
    getCategoryAndAncestorIds(id, collection).includes(requested.id),
  );
}

export function normalizeCategoryAssignment(
  assignment: CategoryAssignment,
  collection: CollectionConfig | undefined,
  options: { requireOne?: boolean } = {},
): CategoryAssignmentResult {
  const errors: string[] = [];
  const ids = cleanIds(assignment.subcategoryIds);
  if (ids.length > MAX_PRODUCT_SUBCATEGORIES) {
    errors.push(`Select no more than ${MAX_PRODUCT_SUBCATEGORIES} subcategories.`);
  }
  const knownIds = new Set(collection?.subcategories.map((category) => category.id) || []);
  if (collection) {
    const unknownIds = ids.filter((id) => !knownIds.has(id));
    if (unknownIds.length > 0) errors.push('One or more selected subcategories no longer exist.');
  }
  if (options.requireOne && ids.length === 0) errors.push('Select at least one subcategory before publishing.');

  const primary = assignment.primarySubcategoryId || ids[0];
  if (primary && !ids.includes(primary)) errors.push('The primary subcategory must also be selected.');
  const primaryCategory = getCategoryById(collection, primary);

  return {
    subcategoryIds: ids.slice(0, MAX_PRODUCT_SUBCATEGORIES),
    primarySubcategoryId: primary,
    category: primaryCategory?.title || '',
    subcategory: primaryCategory?.title,
    errors,
  };
}

export function validateCollectionTaxonomy(collections: readonly CollectionConfig[]): string[] {
  const errors: string[] = [];
  const collectionIds = collections.map((collection) => collection.id);
  if (new Set(collectionIds).size !== collectionIds.length) errors.push('Collection IDs must be unique.');

  for (const collection of collections) {
    if (!collection.id.trim()) errors.push('Every collection requires a stable ID.');
    const ids = collection.subcategories.map((category) => category.id);
    if (ids.some((id) => !id.trim())) errors.push(`${collection.title}: every category requires a stable ID.`);
    if (new Set(ids).size !== ids.length) errors.push(`${collection.title}: category IDs must be unique.`);
    const titles = collection.subcategories.map((category) => category.title);
    if (new Set(titles).size !== titles.length) errors.push(`${collection.title}: category titles must be unique.`);

    for (const category of collection.subcategories) {
      const parentId = getCategoryParentId(category, collection);
      if ((category.parentCategoryId || category.parentCategory) && !parentId) {
        errors.push(`${collection.title}: parent for “${category.title}” does not exist.`);
        continue;
      }
      if (parentId === category.id) errors.push(`${collection.title}: “${category.title}” cannot be its own parent.`);
      const ancestors = getCategoryAndAncestorIds(category.id, collection);
      const nextParent = parentId ? getCategoryById(collection, parentId) : undefined;
      if (nextParent && ancestors.filter((id) => id === category.id).length > 1) {
        errors.push(`${collection.title}: category hierarchy contains a cycle at “${category.title}”.`);
      }
    }

    // The ancestor helper stops at cycles, so explicitly walk each chain to detect one.
    for (const category of collection.subcategories) {
      const visited = new Set<string>();
      let current: Category | undefined = category;
      while (current) {
        if (visited.has(current.id)) {
          errors.push(`${collection.title}: category hierarchy contains a cycle at “${category.title}”.`);
          break;
        }
        visited.add(current.id);
        current = getCategoryById(collection, getCategoryParentId(current, collection));
      }
    }
  }
  return [...new Set(errors)];
}

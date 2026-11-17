import { describe, expect, it } from 'vitest';
import type { CollectionConfig } from '../../types';
import { getEffectiveSubcategoryIds, normalizeCategoryAssignment, productMatchesCategory, validateCollectionTaxonomy } from '../productCategories';
import { INITIAL_SITE_CONTENT } from '../../constants';

const kids: CollectionConfig = {
  id: 'kids', title: 'Kids', subtitle: '', heroImage: '',
  subcategories: [
    { id: 'girls', title: 'Girls', image: '', isMainCategory: true },
    { id: 'boys', title: 'Boys', image: '', isMainCategory: true },
    { id: 'girls-pants', title: 'Girls Pants', image: '', parentCategoryId: 'girls' },
    { id: 'boys-pants', title: 'Boys Pants', image: '', parentCategoryId: 'boys' },
  ],
};

describe('product category assignments', () => {
  it('only saves collection IDs that the public route can serve without renaming them', () => {
    for (const id of ['Seasonal', 'a'.repeat(81), 'bad/path', '-prefix', ' spaced']) {
      expect(validateCollectionTaxonomy([{ ...kids, id }]).join(' ')).toContain('collection ID must');
    }
    for (const id of ['seasonal-pieces', 'a'.repeat(80), '1_room']) {
      const collection = { ...kids, id };
      expect(validateCollectionTaxonomy([collection])).toEqual([]);
      expect(collection.id).toBe(id);
    }
  });
  it('keeps the shipped Louie Mae taxonomy structurally valid', () => {
    expect(validateCollectionTaxonomy(INITIAL_SITE_CONTENT.collections)).toEqual([]);
  });

  it('matches every selected leaf and its ancestors', () => {
    const product = { category: 'Girls Pants', subcategoryIds: ['girls-pants', 'boys-pants'], primarySubcategoryId: 'girls-pants' };
    expect(productMatchesCategory(product, 'girls-pants', kids)).toBe(true);
    expect(productMatchesCategory(product, 'boys-pants', kids)).toBe(true);
    expect(productMatchesCategory(product, 'girls', kids)).toBe(true);
    expect(productMatchesCategory(product, 'boys', kids)).toBe(true);
  });

  it('keeps legacy products discoverable', () => {
    expect(getEffectiveSubcategoryIds({ category: 'Girls Pants' }, kids)).toEqual(['girls-pants']);
  });

  it('requires the primary selection to be selected', () => {
    const result = normalizeCategoryAssignment(
      { subcategoryIds: ['girls-pants'], primarySubcategoryId: 'boys-pants' },
      kids,
      { requireOne: true },
    );
    expect(result.errors).toContain('The primary subcategory must also be selected.');
  });

  it('rejects duplicate IDs, missing parents, and category cycles', () => {
    expect(validateCollectionTaxonomy([{
      ...kids,
      subcategories: [
        { id: 'a', title: 'A', image: '', parentCategoryId: 'b' },
        { id: 'b', title: 'B', image: '', parentCategoryId: 'a' },
        { id: 'b', title: 'Duplicate', image: '', parentCategoryId: 'missing' },
      ],
    }]).join(' ')).toMatch(/unique|cycle|does not exist/i);
  });
});

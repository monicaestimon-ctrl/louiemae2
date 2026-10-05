import { describe, expect, it } from 'vitest';
import { buildCatalogCategoryFilter, matchesCatalogCategoryFilter, productMatchesCategory } from './productCategories';
import type { CollectionConfig } from '../types';

const collection: CollectionConfig = { id: 'kids', title: 'Kids', subtitle: '', heroImage: '', subcategories: [
  { id: 'girls', title: 'Girls', image: '' },
  { id: 'dresses', title: 'Dresses', image: '', parentCategoryId: 'girls' },
  { id: 'boys', title: 'Boys', image: '' },
] };
describe('serializable catalog category filters', () => {
  it('matches hierarchical, explicit-ID and legacy behavior exactly', () => {
    for (const config of [collection, undefined]) {
      for (const requested of ['girls', 'Girls', 'Dresses', 'boys', 'Unknown']) {
        for (const product of [
          { category: 'Dresses' }, { category: 'Other', subcategory: 'Dresses' },
          { category: 'Dresses', subcategoryIds: ['boys'] },
          { category: 'Boys', subcategoryIds: [' dresses ', 'dresses', 'missing'] },
          { category: 'Dresses', subcategoryIds: ['missing'] },
          { category: 'Unknown', subcategory: 'Other' }, { category: 'Girls' },
        ]) {
          expect(matchesCatalogCategoryFilter(product, buildCatalogCategoryFilter(requested, config)))
            .toBe(productMatchesCategory(product, requested, config));
        }
      }
    }
  });
});

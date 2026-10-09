import { useEffect, useMemo } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { buildCatalogCategoryFilter } from '../lib/productCategories';
import type { CollectionConfig, Product } from '../types';

export type StoreCardProduct = Pick<Product, 'id' | 'name' | 'images' | 'price' | 'category' | 'isNew'> & { variantCount: number };
export type StoreSort = 'newest' | 'price-asc' | 'price-desc' | 'featured';

export function useStoreCatalog(config: CollectionConfig, category: string, ready: boolean, sort?: StoreSort, previewLimit?: number) {
  const categoryFilter = useMemo(() => category === 'All' ? undefined : buildCatalogCategoryFilter(category, config), [category, config]);
  const page = usePaginatedQuery(api.catalog.storefrontPage,
    ready ? { collection: config.id, categoryFilter, sort } : 'skip', { initialNumItems: previewLimit ?? 25 });
  const { status, loadMore } = page;
  const count = page.results.length;
  // Preview cards fill short filtered pages; full grids advance only on request.
  useEffect(() => {
    if (ready && previewLimit && count < previewLimit && status === 'CanLoadMore') loadMore(previewLimit - count);
  }, [ready, previewLimit, count, status, loadMore]);
  const rows = previewLimit ? page.results.slice(0, previewLimit) : page.results;
  const products: StoreCardProduct[] = ready ? rows.map(row => ({
    id: row._id, name: row.name, images: row.images, price: row.price,
    category: row.category, isNew: row.isNew, variantCount: row.variantCount,
  })) : [];
  return { products, loading: ready && (status === 'LoadingFirstPage' || Boolean(previewLimit && count < previewLimit && status !== 'Exhausted')),
    complete: ready && status === 'Exhausted', canLoadMore: ready && status === 'CanLoadMore',
    loadingMore: ready && status === 'LoadingMore', loadMore: () => loadMore(25) };
}

export function useStoreCategoryOptions(config: CollectionConfig, selected: string, ready: boolean) {
  const page = usePaginatedQuery(api.catalog.categoryOptionsPage, ready ? { collection: config.id } : 'skip', { initialNumItems: 25 });
  const categories = Array.from(new Set([...config.subcategories.map(category => category.title),
    ...(ready ? page.results : []), ...(selected === 'All' ? [] : [selected])])).filter(category => category && category !== 'All').sort();
  return { categories: ['All', ...categories], canLoadMore: ready && page.status === 'CanLoadMore',
    loading: ready && (page.status === 'LoadingFirstPage' || page.status === 'LoadingMore'), loadMore: () => page.loadMore(25) };
}

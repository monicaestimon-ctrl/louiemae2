import { useEffect, useMemo } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { buildCatalogCategoryFilter, matchesCatalogCategoryFilter } from '../lib/productCategories';
import type { CollectionConfig, Product } from '../types';

export type StoreCardProduct = Pick<Product, 'id' | 'name' | 'images' | 'price' | 'category' | 'isNew' | 'inStock'> & { variantCount: number };
export type StoreSort = 'newest' | 'price-asc' | 'price-desc' | 'featured';

export function useStoreCatalog(config: CollectionConfig, category: string, ready: boolean, sort?: StoreSort, previewLimit?: number) {
  const categoryFilter = useMemo(() => category === 'All' ? undefined : buildCatalogCategoryFilter(category, config), [category, config]);
  const page = usePaginatedQuery(api.catalog.storefrontPage,
    ready ? { collection: config.id, categoryFilter, sort } : 'skip', { initialNumItems: previewLimit ?? 25 });
  const retailEnabled = ready && ['furniture', 'decor'].includes(config.id);
  const retail = usePaginatedQuery(api.retailLaunch.storefrontPage, retailEnabled ? {} : 'skip', { initialNumItems: 100 });
  const { status: retailStatus, loadMore: loadMoreRetail } = retail;
  useEffect(() => { if (retailEnabled && retailStatus === 'CanLoadMore') loadMoreRetail(100); }, [retailEnabled, retailStatus, loadMoreRetail]);
  const { status, loadMore } = page;
  const count = page.results.length;
  // Preview cards fill short filtered pages; full grids advance only on request.
  useEffect(() => {
    if (ready && previewLimit && count < previewLimit && status === 'CanLoadMore') loadMore(previewLimit - count);
  }, [ready, previewLimit, count, status, loadMore]);
  const rows = previewLimit ? page.results.slice(0, previewLimit) : page.results;
  const legacy: StoreCardProduct[] = ready ? rows.map(row => ({
    id: row._id, name: row.name, images: row.images, price: row.price,
    category: row.category, isNew: row.isNew, variantCount: row.variantCount, inStock: false,
  })) : [];
  const eligible = retailEnabled ? retail.results.filter(p => p.collection === config.id && (!categoryFilter || matchesCatalogCategoryFilter(p, categoryFilter)))
    .map(p => ({ id: p._id, name: p.name, images: p.images, price: p.price, category: p.category, isNew: p.isNew, variantCount: p.variantCount, inStock: p.inStock })) : [];
  let products = [...eligible, ...legacy];
  if (sort === 'price-asc') products.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') products.sort((a, b) => b.price - a.price);
  if (previewLimit) products = products.slice(0, previewLimit);
  return { products, loading: ready && ((retailEnabled && retail.status === 'LoadingFirstPage') || status === 'LoadingFirstPage' || Boolean(previewLimit && count < previewLimit && status !== 'Exhausted')),
    complete: ready && status === 'Exhausted' && (!retailEnabled || retail.status === 'Exhausted'), canLoadMore: ready && status === 'CanLoadMore',
    loadingMore: ready && status === 'LoadingMore', loadMore: () => loadMore(25) };
}

export function useStoreCategoryOptions(config: CollectionConfig, selected: string, ready: boolean) {
  const page = usePaginatedQuery(api.catalog.categoryOptionsPage, ready ? { collection: config.id } : 'skip', { initialNumItems: 25 });
  const categories = Array.from(new Set([...config.subcategories.map(category => category.title),
    ...(config.id === 'furniture' ? ['Sofas', 'Sectionals', 'Benches', 'Accent Chairs', 'Dining Chairs', 'Dining Tables', 'Barstools', 'Counterstools', 'Stools', 'Ottomans'] : config.id === 'decor' ? ['Lighting'] : []),
    ...(ready ? page.results : []), ...(selected === 'All' ? [] : [selected])])).filter(category => category && category !== 'All').sort();
  return { categories: ['All', ...categories], canLoadMore: ready && page.status === 'CanLoadMore',
    loading: ready && (page.status === 'LoadingFirstPage' || page.status === 'LoadingMore'), loadMore: () => page.loadMore(25) };
}

import { useDeferredValue } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { buildCatalogCategoryFilter } from '../lib/productCategories';
import type { CjProductConnectionState } from '../lib/cjProductStatus';
import type { CollectionConfig } from '../types';

export function useAdminInventoryPage(active: boolean, filters: {
  collection: string; category: string | null; search: string;
  connection: 'all' | CjProductConnectionState; collections: CollectionConfig[];
}) {
  const readiness = useQuery(api.catalogReadiness.status, active ? {} : 'skip');
  const ready = active && readiness?.ready === true;
  const search = useDeferredValue(filters.search.trim().toLowerCase());
  const updating = search !== filters.search.trim().toLowerCase();
  const collection = filters.collection === 'all' ? undefined : filters.collection;
  const categoryFilter = filters.category
    ? buildCatalogCategoryFilter(filters.category, filters.collections.find(item => item.id === collection)) : undefined;
  const page = usePaginatedQuery(api.catalog.adminPage, ready ? {
    collection, categoryFilter, adminSearch: search || undefined,
    connectionState: filters.connection === 'all' ? undefined : filters.connection,
  } : 'skip', { initialNumItems: 25 });
  return {
    products: ready ? page.results.map(row => ({ ...row, id: row._id })) : [],
    loading: active && (readiness === undefined || (ready && page.status === 'LoadingFirstPage')),
    unavailable: active && readiness !== undefined && !ready,
    complete: ready && page.status === 'Exhausted',
    loadingMore: ready && page.status === 'LoadingMore',
    canLoadMore: ready && page.status === 'CanLoadMore',
    updating, loadMore: () => page.loadMore(25),
  };
}

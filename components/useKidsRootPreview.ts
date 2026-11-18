import { api } from '../convex/_generated/api';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import type { StoreCardProduct } from './useStoreCatalog';

/** One bounded subscription includes readiness; detail remains the purchase authority. */
export function useKidsRootPreview(enabled: boolean) {
  const request = useRecoverableQuery(api.catalog.kidsRootPreview, enabled ? {} : 'skip');
  const products: StoreCardProduct[] = enabled && request.data?.ready
    ? request.data.products.map(({ _id, ...product }) => ({ ...product, id: _id, inStock: false }))
    : [];
  return {
    products,
    loading: enabled && request.status === 'loading',
    unavailable: enabled && (request.status === 'unavailable' || request.data?.ready === false),
  };
}

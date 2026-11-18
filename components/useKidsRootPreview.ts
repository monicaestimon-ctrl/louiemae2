import { api } from '../convex/_generated/api';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { useInitialPublicValue } from '../contexts/useInitialPublicValue';
import { readPublicInitialData } from '../lib/publicInitialData';
import { CATALOG_VERSION } from '../lib/catalogVersion';
import type { KidsInitialPreview } from '../lib/kidsInitialPreview';
import type { StoreCardProduct } from './useStoreCatalog';
/** A verified initial display bridges only the first live connection, never purchase authority. */
export function useKidsRootPreview(enabled: boolean) {
  const request = useRecoverableQuery(api.catalog.kidsRootPreview, enabled ? {} : 'skip');
  const selected = useInitialPublicValue<{
    ready: boolean;
    version: number;
    products: KidsInitialPreview['products'];
  }>(
    request.status === 'unavailable' ? new Error('Preview unavailable') : request.data,
    () => readPublicInitialData()?.kids,
    enabled,
    'kids-root'
  );
  const unavailable =
    enabled &&
    (selected.unavailable ||
      (selected.value !== undefined &&
        (!selected.value.ready || selected.value.version !== CATALOG_VERSION)));
  const products: StoreCardProduct[] =
    enabled && !unavailable && selected.value?.ready
      ? selected.value.products.map(({ _id, ...product }) => ({
          ...product,
          id: _id,
          inStock: false,
        }))
      : [];
  return {
    products,
    loading: enabled && !unavailable && selected.value === undefined,
    unavailable,
  };
}

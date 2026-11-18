import { useEffect, useState } from 'react';
import { api } from '../convex/_generated/api';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { useInitialPublicValue } from '../contexts/useInitialPublicValue';
import { PUBLIC_INITIAL_ID, readPublicInitialData } from '../lib/publicInitialData';
import { CATALOG_VERSION } from '../lib/catalogVersion';
import type { KidsInitialPreview } from '../lib/kidsInitialPreview';
import type { StoreCardProduct } from './useStoreCatalog';
const claimedSnapshots = new WeakSet<Element>();
/** A verified initial display bridges only the first live connection, never purchase authority. */
export function useKidsRootPreview(enabled: boolean) {
  const [initial] = useState(() => {
    const element = document.getElementById(PUBLIC_INITIAL_ID);
    return { element, value: element && !claimedSnapshots.has(element) ? readPublicInitialData()?.kids : undefined };
  });
  const request = useRecoverableQuery(api.catalog.kidsRootPreview, enabled ? {} : 'skip');
  const selected = useInitialPublicValue<{
    ready: boolean;
    version: number;
    products: KidsInitialPreview['products'];
  }>(
    request.status === 'unavailable' ? new Error('Preview unavailable') : request.data,
    () => initial.value,
    enabled,
    'kids-root'
  );
  // Claim on commit, while this owner keeps its captured value. A later mount cannot
  // race an unmount cleanup and reuse the same document, including under StrictMode.
  useEffect(() => { if (initial.element) claimedSnapshots.add(initial.element); }, [initial]);
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

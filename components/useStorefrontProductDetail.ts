import { useMemo } from 'react';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { api } from '../convex/_generated/api';
import type { Product } from '../types';

/** Resolve only the selected product, distinguishing transport failure from confirmed absence. */
export function useStorefrontProductDetail(id?: string | null) {
  const request = useRecoverableQuery(api.products.getStorefrontDetail, id ? { id } : 'skip');
  const detail = request.data;
  const matches = Boolean(id && detail && detail._id === id);
  const product = useMemo<Product | null>(() => matches && detail ? { ...detail, id: detail._id } : null, [matches, detail]);
  return { product, loading: Boolean(id) && request.status !== 'unavailable' && (detail === undefined || (detail !== null && !matches)), unavailable: Boolean(id) && detail === null, failed: Boolean(id) && request.status === 'unavailable', retry: request.retry };
}

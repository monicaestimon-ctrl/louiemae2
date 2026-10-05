import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Product } from '../types';

export function useStorefrontProductDetail(id?: string | null) {
  const detail = useQuery(api.products.getStorefrontDetail, id ? { id } : 'skip');
  const matches = Boolean(id && detail && detail._id === id);
  const product = useMemo<Product | null>(() => matches && detail ? { ...detail, id: detail._id } : null, [matches, detail]);
  return { product, loading: Boolean(id) && (detail === undefined || (detail !== null && !matches)), unavailable: Boolean(id) && detail === null };
}

import { useEffect, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Product } from '../types';

export function useAdminProductDetail(enabled: boolean, scope: string, onLoaded: (product: Product) => void) {
  const convex = useConvex();
  const generation = useRef({ value: 0 });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => {
    generation.current.value++;
    setLoadingId(null);
    setError(null);
  };
  useEffect(() => {
    const requests = generation.current;
    setLoadingId(null);
    setError(null);
    return () => { requests.value++; };
  }, [enabled, scope]);
  const load = async (id: string) => {
    if (!enabled) return;
    const request = ++generation.current.value;
    setLoadingId(id);
    setError(null);
    try {
      const product = await convex.query(api.products.getAdmin, { id: id as Id<'products'> });
      if (request !== generation.current.value) return;
      if (!product) {
        setError('This product is no longer available. Refresh the inventory and try again.');
        return;
      }
      onLoaded({ ...product, id: product._id });
    } catch {
      if (request === generation.current.value) setError('The product could not be loaded. Please try again.');
    } finally {
      if (request === generation.current.value) setLoadingId(null);
    }
  };
  return { load, cancel, loadingId, error };
}

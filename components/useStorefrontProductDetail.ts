import { useEffect, useMemo, useState } from 'react';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { api } from '../convex/_generated/api';
import type { Product } from '../types';
import { readProductBootstrap } from '../lib/publicProductBootstrap';

/** Resolve only the selected product, distinguishing transport failure from confirmed absence. */
export function useStorefrontProductDetail(id?: string | null) {
  const request = useRecoverableQuery(api.products.getStorefrontDetail, id ? { id } : 'skip');
  const initial = useMemo(() => readProductBootstrap(id), [id]);
  const [expired, setExpired] = useState<typeof initial>(null);
  useEffect(() => {
    if (!initial || (request.status !== 'ready' && request.status !== 'unavailable')) return;
    // A later retry must never resurrect HTML that a live result superseded.
    setExpired(initial);
    const element = document.getElementById('lm-product-bootstrap');
    if (element?.dataset.productId === id) element.remove();
  }, [initial, id, request.status]);
  useEffect(() => {
    if (!initial) return;
    const timer = window.setTimeout(() => setExpired(initial), Math.max(0, initial.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [initial]);
  const detail = request.data;
  const matches = Boolean(id && detail && detail._id === id);
  // A wall-clock eligibility guard must also reject stale data when browser timers are suspended.
  // eslint-disable-next-line react-hooks/purity
  const fallback = detail === undefined && request.status === 'loading' && initial !== expired && initial && Date.now() < initial.expiresAt ? initial.product : null;
  const product = useMemo<Product | null>(() => matches && detail ? { ...detail, id: detail._id } : fallback, [matches, detail, fallback]);
  return { product, loading: Boolean(id) && !product && request.status !== 'unavailable' && (detail === undefined || (detail !== null && !matches)), unavailable: Boolean(id) && detail === null, failed: Boolean(id) && request.status === 'unavailable', retry: request.retry };
}

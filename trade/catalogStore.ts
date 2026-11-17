import { useSyncExternalStore } from 'react';
import type { HolmProduct } from './catalog';

// This bridge preserves the legacy renderer while keeping catalog changes observable.
// Viewer ownership and authorization remain in LiveShell, not this display-only store.
export let products: HolmProduct[] = [];
export let catalogGeneration = 0;
export const productsById = new Map<number, HolmProduct>();
const listeners = new Set<() => void>();
export function setProducts(list: HolmProduct[]) {
  products = [...list];
  productsById.clear();
  for (const product of products) productsById.set(product.id, product);
  catalogGeneration++;
  for (const notify of listeners) notify();
}
export function subscribeCatalog(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
export const catalogSnapshot = () => catalogGeneration;
export function useCatalogRevision() {
  return useSyncExternalStore(subscribeCatalog, catalogSnapshot, catalogSnapshot);
}

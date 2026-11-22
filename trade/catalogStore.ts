import { useSyncExternalStore } from 'react';
import type { HolmProduct } from './catalog';

// This bridge preserves the legacy renderer while keeping catalog changes observable.
// Viewer ownership and authorization remain in LiveShell, not this display-only store.
export let products: HolmProduct[] = [];
export let catalogGeneration = 0;
export const productsById = new Map<number, HolmProduct>();
const listeners = new Set<() => void>();
let baseReferences: HolmProduct[] = [];
let discoveryOwner: symbol | null = null;
let discoveryReferences: HolmProduct[] = [];
function rebuildReferences() {
  productsById.clear();
  for (const product of [...baseReferences, ...products, ...discoveryReferences]) {
    const previous = productsById.get(product.id);
    if (previous && previous.lid !== product.lid) throw new Error('Catalog product identities require review.');
    productsById.set(product.id, product);
  }
}
/** Display references for the current discovery page, independent of the home
 * selection and saved-project resolver. An old component cannot clear a new owner. */
export function setDiscoveryReferences(owner: symbol, references: HolmProduct[]) {
  if (discoveryOwner === owner && JSON.stringify(discoveryReferences) === JSON.stringify(references)) return;
  discoveryOwner = owner;
  discoveryReferences = references;
  rebuildReferences();
}
export function clearDiscoveryReferences(owner: symbol) {
  if (discoveryOwner !== owner) return;
  discoveryOwner = null; discoveryReferences = []; rebuildReferences();
}
export function setProducts(list: HolmProduct[], references: HolmProduct[] = []) {
  products = [...list];
  baseReferences = [...references];
  if (!list.length && !references.length) { discoveryOwner = null; discoveryReferences = []; }
  rebuildReferences();
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

import { liveProducts, type HolmProduct } from './catalog';
import type { SavedProductIdentity } from './projectIdentity';
import { projectItemKey } from './projectIdentity';
import { useSavedProductResolution, type SavedResolution } from './useSavedProductResolution';

/** Project data can resolve outside the current browse page without changing that page. */
export function useProjectCatalog(identities: readonly SavedProductIdentity[], catalog: ReadonlyMap<number, HolmProduct>) {
  const missing = identities.filter(identity => {
    const product = catalog.get(identity.pid);
    // A visible numeric match is not evidence of an older saved row's source.
    // The verified legacy index must rule out a hash collision first.
    return identity.lid === undefined || !product || product.lid !== identity.lid;
  });
  const resolution = useSavedProductResolution(missing);
  const products = new Map(catalog);
  const states = new Map<string, SavedResolution>();
  for (const row of resolution.rows) {
    let state = row;
    if (row.item) {
      const existing = products.get(row.identity.pid);
      if (existing && existing.lid !== row.item.id) state = { ...row, status: 'conflict', item: null };
      else {
        const [product] = liveProducts([row.item]);
        if (product) products.set(product.id, product);
        else state = { ...row, status: 'unavailable', item: null };
      }
    }
    states.set(projectItemKey({ pid: row.identity.pid, lid: row.identity.lid, vid: row.identity.vid }), state);
  }
  // Legacy rows have no source field for resolveProjectProduct to compare. Do
  // not let a copied browse row bypass a pending/failed/ambiguous identity read.
  for (const row of states.values()) {
    if (row.identity.lid === undefined && row.status !== 'resolved') products.delete(row.identity.pid);
  }
  return { products, states, pending: resolution.pending, preparing: resolution.preparing, failed: resolution.failed };
}

/** A delayed or failed lookup is never described as confirmed unavailability. */
export function projectResolutionMessage(identity: SavedProductIdentity, states: ReadonlyMap<string, SavedResolution>) {
  const row = states.get(projectItemKey({ pid: identity.pid, lid: identity.lid, vid: identity.vid }));
  const prefix = `Saved item ${identity.pid}`;
  if (row?.status === 'pending') return `${prefix} is being checked. Your saved item is preserved.`;
  if (row?.status === 'preparing') return `${prefix} cannot be verified yet. Your saved item is preserved while catalog preparation finishes.`;
  if (row?.status === 'error') return `${prefix} could not be checked. Reload to try again; your saved item is preserved.`;
  if (row?.status === 'conflict') return `${prefix} has a conflicting product identity and needs review. It has not been replaced.`;
  return `${prefix} is no longer available. Choose a replacement or remove it.`;
}

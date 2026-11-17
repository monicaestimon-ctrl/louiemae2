import { useMemo } from 'react';
import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import type { LiveItem } from './catalog';
import type { SavedProductIdentity } from './projectIdentity';
import { holmLegacyId } from '../lib/holmProductIdentity';
import { usePendingTimeout } from '../contexts/usePendingTimeout';

type SourceRows = FunctionReturnType<typeof api.holm.catalogItems>;
type LegacyRows = FunctionReturnType<typeof api.holm.catalogLegacyItems>;
type State = 'pending' | 'resolved' | 'unavailable' | 'conflict' | 'error' | 'preparing';
export type SavedResolution = { identity: SavedProductIdentity; status: State; item: LiveItem | null };
const validNumber = (value: number) => Number.isSafeInteger(value) && value > 0;
const batches = <T,>(values: T[]) => Array.from({ length: Math.ceil(values.length / 24) }, (_, index) => values.slice(index * 24, index * 24 + 24));

/** Explicit saved sources never fall back to a different product through their old numeric ID. */
export function savedIdentityRequests(identities: readonly SavedProductIdentity[], enabled: boolean) {
  const requests: Record<string, { query: typeof api.holm.catalogItems; args: { productIds: string[] } } | { query: typeof api.holm.catalogLegacyItems; args: { legacyIds: number[] } }> = {};
  if (!enabled || identities.length > 2000) return requests;
  const valid = identities.filter(identity => validNumber(identity.pid));
  const sources = [...new Set(valid.filter(identity => typeof identity.lid === 'string' && identity.lid.length > 0 && identity.lid.length <= 128).map(identity => identity.lid!))].sort();
  const legacy = [...new Set(valid.filter(identity => !identity.lid).map(identity => identity.pid))].sort((a, b) => a - b);
  batches(sources).forEach((productIds, index) => { requests[`source:${index}`] = { query: api.holm.catalogItems, args: { productIds } }; });
  batches(legacy).forEach((legacyIds, index) => { requests[`legacy:${index}`] = { query: api.holm.catalogLegacyItems, args: { legacyIds } }; });
  return requests;
}

/** Resolve only requested saved records. This does not install results into the browse catalog. */
export function useSavedProductResolution(identities: readonly SavedProductIdentity[], enabled = true) {
  const proposed = savedIdentityRequests(identities, enabled);
  // Caller arrays are rebuilt as projects change. Equal source batches must keep
  // the same descriptor identity for the real Convex subscription lifecycle.
  const requestKey = JSON.stringify(Object.entries(proposed).map(([key, request]) => [key, request.args]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const requests = useMemo(() => proposed, [requestKey]);
  const responses = useQueries(requests);
  const timedOut = usePendingTimeout(Object.keys(requests).some(key => responses[key] === undefined), requestKey);
  const sources = new Map<string, { status: State; item: LiveItem | null }>();
  const legacy = new Map<number, { status: State; item: LiveItem | null }>();
  for (const [key, request] of Object.entries(requests)) {
    const response = responses[key] as SourceRows | LegacyRows | Error | undefined;
    const initial: State = response === undefined ? (timedOut ? 'error' : 'pending') : response instanceof Error ? 'error' : 'unavailable';
    if ('productIds' in request.args) {
      for (const id of request.args.productIds) sources.set(id, { status: initial, item: null });
      if (Array.isArray(response)) for (const row of response) sources.set(row.productId, { status: row.item ? 'resolved' : 'unavailable', item: row.item });
    } else {
      for (const id of request.args.legacyIds) legacy.set(id, { status: initial, item: null });
      if (response && !(response instanceof Error) && !Array.isArray(response)) {
        if (!response.ready) for (const id of request.args.legacyIds) legacy.set(id, { status: 'preparing', item: null });
        else for (const row of response.items) legacy.set(row.legacyId, { status: row.status, item: row.item });
      }
    }
  }
  const rows: SavedResolution[] = identities.map(identity => {
    if (!enabled) return { identity, status: 'pending', item: null };
    if (identities.length > 2000) return { identity, status: 'error', item: null };
    if (!validNumber(identity.pid)) return { identity, status: 'conflict', item: null };
    const result = identity.lid ? sources.get(identity.lid) : legacy.get(identity.pid);
    if (!result) return { identity, status: 'conflict', item: null };
    if (result.item && ((identity.lid && result.item.id !== identity.lid) || holmLegacyId(result.item.id) !== identity.pid)) return { identity, status: 'conflict', item: null };
    return { identity, ...result };
  });
  // Two explicit source identities can share an old hash. Never install either under that key.
  const owners = new Map<number, Set<string>>();
  for (const row of rows) if (row.item) { const ids = owners.get(row.identity.pid) ?? new Set<string>(); ids.add(row.item.id); owners.set(row.identity.pid, ids); }
  for (const row of rows) if ((owners.get(row.identity.pid)?.size ?? 0) > 1) { row.status = 'conflict'; row.item = null; }
  return { rows, pending: rows.some(row => row.status === 'pending'), preparing: rows.some(row => row.status === 'preparing'), failed: rows.some(row => row.status === 'error'), tooMany: identities.length > 2000 };
}

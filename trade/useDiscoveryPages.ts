import { useEffect, useMemo, useState } from 'react';
import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import type { DiscoveryRequest } from '../lib/holmDiscoveryFilters';
import { discoveryPageChain } from '../lib/holmDiscoveryPages';

type Page = FunctionReturnType<typeof api.holmDiscoveryQuery.page>;
/** The caller must mount this under the viewer-owned catalog boundary. The key
 * also prevents an old filter's results from appearing during a state reset. */
export function useDiscoveryPages(request: DiscoveryRequest, viewerKey: string, enabled: boolean) {
  const requestKey = JSON.stringify(request);
  const stableRequest = useMemo(() => JSON.parse(requestKey) as DiscoveryRequest, [requestKey]);
  const key = JSON.stringify([requestKey, viewerKey, enabled]);
  // This token only invalidates query caching. The server's own clock remains
  // the sole price authority; new visitors must not reuse a long-lived token 0.
  const [state, setState] = useState(() => ({ key, cursors: [null] as (string | null)[], refresh: Date.now() }));
  const current = state.key === key ? state : { key, cursors: [null], refresh: Math.max(Date.now(), state.refresh + 1) };
  if (state.key !== key) setState(current);
  const queries = useMemo(() => Object.fromEntries(enabled ? current.cursors.map((cursor, index) => [String(index), {
    query: api.holmDiscoveryQuery.page,
    args: { request: stableRequest, cursor, pageSize: 24, refreshToken: current.refresh },
  }]) : []), [enabled, current.cursors, current.refresh, stableRequest]);
  const results = useQueries(queries);
  const chain = discoveryPageChain(current.cursors, current.cursors.map((_, index) => results[String(index)] as Page | Error | undefined));
  // Subscriptions whose upstream continuation changed must be discarded; the
  // pure chain evaluator already excludes their rows in this same render.
  if (state.key === key && !chain.pending && !chain.error && !chain.unavailable && chain.accepted < current.cursors.length) {
    setState({ ...current, cursors: current.cursors.slice(0, Math.max(1, chain.accepted)) });
  }
  useEffect(() => {
    if (!enabled || chain.pending || chain.error || chain.unavailable || !chain.accepted) return;
    const timer = window.setTimeout(() => setState(previous => previous.key !== key ? previous : { ...previous, refresh: Math.max(Date.now(), previous.refresh + 1) }), Math.max(100, Math.min(30_000, chain.refreshAfterMs)));
    return () => window.clearTimeout(timer);
  }, [enabled, key, current.refresh, chain.pending, chain.error, chain.unavailable, chain.accepted, chain.refreshAfterMs]);
  const loadMore = () => {
    if (!enabled || chain.pending || chain.error || chain.unavailable || chain.nextCursor === null) return;
    const next = chain.nextCursor;
    setState(previous => previous.key !== key ? previous : { ...previous, cursors: [...previous.cursors.slice(0, chain.accepted), next] });
  };
  const retry = () => setState(previous => ({ key, cursors: [null], refresh: Math.max(Date.now(), previous.refresh + 1) }));
  return { ...chain, loadMore, retry, enabled };
}

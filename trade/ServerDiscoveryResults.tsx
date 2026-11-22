import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DiscoveryRequest } from '../lib/holmDiscoveryFilters';
import { liveProducts, type HolmProduct } from './catalog';
import { useDiscoveryPages } from './useDiscoveryPages';
import { clearDiscoveryReferences, setDiscoveryReferences } from './catalogStore';
import { usePendingTimeout } from '../contexts/usePendingTimeout';
import { discoverySearchQuery } from '../lib/holmDiscoverySearch';

export function ServerDiscoveryResults({ request, viewerKey, searching, renderProducts, resetFilters }: {
  request: DiscoveryRequest; viewerKey: string; searching: boolean;
  renderProducts: (items: HolmProduct[], searching: boolean) => ReactNode; resetFilters: () => void;
}) {
  let validationMessage = '';
  try { discoverySearchQuery(request.query); } catch (error) { validationMessage = error instanceof Error ? error.message : 'Please shorten your search.'; }
  const [settledQuery, setSettledQuery] = useState(request.query);
  useEffect(() => {
    if (settledQuery === request.query) return;
    const timer = window.setTimeout(() => setSettledQuery(request.query), 200);
    return () => window.clearTimeout(timer);
  }, [request.query, settledQuery]);
  const typing = settledQuery !== request.query;
  const result = useDiscoveryPages(request, viewerKey, !validationMessage && !typing);
  const items = typing ? [] : liveProducts(result.items, true);
  const owner = useRef(Symbol('discovery'));
  const pending = typing || result.pending;
  const timedOut = usePendingTimeout(pending);
  const failed = Boolean(validationMessage || result.error || result.unavailable || timedOut);
  useLayoutEffect(() => { setDiscoveryReferences(owner.current, failed ? [] : items); });
  useLayoutEffect(() => { const token = owner.current; return () => clearDiscoveryReferences(token); }, []);
  if (validationMessage) return <p role="status">{validationMessage}</p>;
  if (failed) return <section role="status"><h2>Catalog temporarily unavailable</h2><p>Please retry to check current prices and availability.</p><button className="btn btn-line" onClick={result.retry}>Try again</button></section>;
  const more = result.nextCursor !== null;
  return <section aria-label="Catalog results" aria-busy={pending}>
    <p className="mono mute" role="status">{pending ? 'Checking current productsâ€¦' : `${items.length} piece${items.length === 1 ? '' : 's'} shown${more ? ' Â· More results available' : ''}`}</p>
    {items.length > 0 && renderProducts(items, searching)}
    {!pending && !items.length && !more && <div className="empty"><h3>Nothing matches all of that</h3><p>Try removing a filter or changing your search.</p><button className="btn btn-line" onClick={resetFilters}>Clear filters</button></div>}
    {!pending && !items.length && more && <p>More products remain to be checked for these filters.</p>}
    {more && <button className="btn btn-line" disabled={pending} onClick={result.loadMore}>{pending ? 'Loadingâ€¦' : 'Load more products'}</button>}
  </section>;
}

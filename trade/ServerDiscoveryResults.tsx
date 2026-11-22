import { useLayoutEffect, useRef, type ReactNode } from 'react';
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
  const result = useDiscoveryPages(request, viewerKey, !validationMessage);
  const items = liveProducts(result.items, true);
  const owner = useRef(Symbol('discovery'));
  const timedOut = usePendingTimeout(result.pending);
  const failed = Boolean(validationMessage || result.error || result.unavailable || timedOut);
  useLayoutEffect(() => { setDiscoveryReferences(owner.current, failed ? [] : items); });
  useLayoutEffect(() => { const token = owner.current; return () => clearDiscoveryReferences(token); }, []);
  if (validationMessage) return <p role="status">{validationMessage}</p>;
  if (failed) return <section role="status"><h2>Catalog temporarily unavailable</h2><p>Please retry to check current prices and availability.</p><button className="btn btn-line" onClick={result.retry}>Try again</button></section>;
  const more = result.nextCursor !== null;
  return <section aria-label="Catalog results" aria-busy={result.pending}>
    <p className="mono mute" role="status">{result.pending ? 'Checking current products…' : `${items.length} piece${items.length === 1 ? '' : 's'} shown${more ? ' · More results available' : ''}`}</p>
    {items.length > 0 && renderProducts(items, searching)}
    {!result.pending && !items.length && !more && <div className="empty"><h3>Nothing matches all of that</h3><p>Try removing a filter or changing your search.</p><button className="btn btn-line" onClick={resetFilters}>Clear filters</button></div>}
    {!result.pending && !items.length && more && <p>More products remain to be checked for these filters.</p>}
    {more && <button className="btn btn-line" disabled={result.pending} onClick={result.loadMore}>{result.pending ? 'Loading…' : 'Load more products'}</button>}
  </section>;
}

import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { usePendingTimeout } from '../contexts/usePendingTimeout';
import { liveProducts, type LiveItem } from './catalog';
import { App, setProducts } from './app';

/** Replace the decorative startup shell with an honest, navigable recovery state. */
function Recovery({ retry, empty = false }: { retry: () => void; empty?: boolean }) {
  useLayoutEffect(() => { document.getElementById('holm-shell')?.remove(); }, []);
  return <main className="holm-boot" aria-labelledby="holm-recovery-title">
    <h1 id="holm-recovery-title">House of Louie Mae</h1>
    <p role="status">{empty ? 'No products are available to browse right now. Please contact us for help.' : 'The trade catalog is temporarily unavailable. We cannot verify current account pricing or availability.'}</p>
    <button onClick={retry}>Try again</button>
    <nav aria-label="Recovery navigation"><a href="/">Louie Mae retail</a>{' · '}<a href="/#support/contact">Contact support</a></nav>
  </main>;
}

/** Keep failed account/catalog reads out of the trade UI, with explicit manual retry. */
export class TradeBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  private retry = () => this.setState({ failed: false });
  componentDidMount() { window.addEventListener('hashchange', this.retry); }
  componentWillUnmount() { window.removeEventListener('hashchange', this.retry); }
  /** Keep unverified account/catalog content behind the recovery screen after a failure. */
  render() { return this.state.failed ? <Recovery retry={this.retry} /> : this.props.children; }
}

/** Own a fresh pagination subscription for each verified viewer identity and pricing role. */
function CatalogShell({ me }: { me: FunctionReturnType<typeof api.holm.me> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.holm.catalogPage, {}, { initialNumItems: 50 });
  useEffect(() => { if (status === 'CanLoadMore') loadMore(50); }, [status, loadMore]);
  const catalog = useDeferredValue(results);
  const mapped = useMemo(() => status === 'Exhausted' && catalog === results ? liveProducts(catalog as LiveItem[]) : null, [catalog, results, status]);
  const [installed, setInstalled] = useState<typeof mapped>(null);
  // The legacy app reads a module-level catalog. Install only committed data,
  // and clear it when the viewer or subscription changes; never mutate it during render.
  useLayoutEffect(() => {
    if (mapped === null) return;
    setProducts(mapped);
    setInstalled(mapped);
    return () => setProducts([]);
  }, [mapped]);
  const ready = mapped !== null && installed === mapped;
  const timedOut = usePendingTimeout(!ready);
  const shell = document.getElementById('holm-shell');
  useLayoutEffect(() => { if (ready) shell?.remove(); }, [ready, shell]);
  if (!ready) {
    if (timedOut) return <Recovery retry={() => window.location.reload()} />;
    return shell ? null : <main className="holm-boot" aria-busy="true"><p role="status">Opening House of Louie Mae…</p></main>;
  }
  if (!catalog.length) return <Recovery empty retry={() => window.location.reload()} />;
  return <App key={me?.signedIn && me.verified ? 'trade' : 'retail'} />;
}

/** Resolve account access before starting a viewer-specific catalog subscription. */
export function LiveShell() {
  const auth = useConvexAuth();
  const me = useQuery(api.holm.me);
  const accountPending = auth.isLoading || me === undefined || auth.isAuthenticated !== me.signedIn;
  const timedOut = usePendingTimeout(accountPending);
  if (accountPending || me === undefined) {
    if (timedOut) return <Recovery retry={() => window.location.reload()} />;
    return document.getElementById('holm-shell') ? null : <main className="holm-boot" aria-busy="true"><p role="status">Verifying account access…</p></main>;
  }
  // Remounting creates a fresh Convex pagination id. A previous account's
  // cached trade rows must never be reused after logout or a role change.
  const viewerKey = me.signedIn ? `${me.email}:${me.verified ? 'trade' : 'retail'}` : 'anonymous';
  return <CatalogShell key={viewerKey} me={me} />;
}

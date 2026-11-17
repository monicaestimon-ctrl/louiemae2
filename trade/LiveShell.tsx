import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { useCatalogDemand } from './useCatalogDemand';
import { usePendingTimeout } from '../contexts/usePendingTimeout';
import { liveProducts, type LiveItem } from './catalog';
import { App, setProducts } from './app';
import { CURATED_SOURCES } from './curatedSources';
const CURATED_IDS = Object.keys(CURATED_SOURCES);
const CatalogApp = React.memo(App);
import { ModalSuspensionContext } from '../components/Modal';

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
  const { results, status, loadMore } = usePaginatedQuery(api.holm.catalogPage, {}, { initialNumItems: 24 });
  const curatedRows = useQuery(api.holm.catalogItems, { productIds: CURATED_IDS });
  const references = useMemo(() => curatedRows === undefined ? null : liveProducts(curatedRows.flatMap(row => row.item ? [row.item] : []) as LiveItem[]), [curatedRows]);
  const catalogDemand = useCatalogDemand();
  // Fill empty candidate pages to find a real first selection. Beyond that,
  // discovery/compose intent requests the full legacy dataset until server discovery replaces it.
  useEffect(() => {
    if (status === 'CanLoadMore' && (catalogDemand.requested || results.length === 0)) loadMore(24);
  }, [status, loadMore, catalogDemand.requested, results.length]);
  const [installed, setInstalled] = useState(false);
  const [visibleIds, setVisibleIds] = useState<readonly string[] | null>(null);
  // A settled page may replace every previously displayed row after a live withdrawal.
  // Admit a bounded replacement selection instead of filtering it out forever.
  const replaceSelection = status === 'CanLoadMore' && visibleIds !== null && results.length > 0
    && !results.some(row => visibleIds.includes(row.id));
  const previousInstallation = useRef('');
  const mapped = useMemo(() => {
    if (status === 'LoadingFirstPage' || (!installed && !results.length && status !== 'Exhausted')) return null;
    const visible = replaceSelection ? results.slice(0, 24)
      : visibleIds && status !== 'Exhausted' ? results.filter(row => visibleIds.includes(row.id)) : results;
    return liveProducts(visible as LiveItem[]);
  }, [results, status, installed, visibleIds, replaceSelection]);
  const [hasContent, setHasContent] = useState(false);
  const [empty, setEmpty] = useState(false);
  // The legacy app reads a module-level catalog. Install only committed data,
  // Clear on viewer teardown; refreshing the same viewer must not remount project state.
  useLayoutEffect(() => () => setProducts([]), []);
  useLayoutEffect(() => {
    if (mapped === null || references === null) return;
    const signature = JSON.stringify([mapped, references, status === 'Exhausted']);
    if (previousInstallation.current === signature) return;
    previousInstallation.current = signature;
    setProducts(mapped, references);
    if (visibleIds === null || status === 'Exhausted') setVisibleIds(results.map(row => row.id));
    else if (replaceSelection) setVisibleIds(results.slice(0, 24).map(row => row.id));
    setInstalled(true);
    setEmpty(previous => mapped.length === 0 ? status === 'Exhausted' || previous : false);
    if (mapped.length) setHasContent(true);
  }, [mapped, references, visibleIds, status, results, replaceSelection]);
  const ready = installed;
  const timedOut = usePendingTimeout(!ready);
  const shell = document.getElementById('holm-shell');
  useLayoutEffect(() => { if (ready) shell?.remove(); }, [ready, shell]);
  if (!ready) {
    if (timedOut) return <Recovery retry={() => window.location.reload()} />;
    return shell ? null : <main className="holm-boot" aria-busy="true"><p role="status">Opening House of Louie Mae…</p></main>;
  }
  return <>{empty && <Recovery empty retry={() => window.location.reload()} />}
    <div hidden={empty} inert={empty}><ModalSuspensionContext.Provider value={empty}>{hasContent && <CatalogApp key={me?.signedIn && me.verified ? 'trade' : 'retail'} catalogComplete={status === 'Exhausted'} onCatalogIntent={catalogDemand.request} />}</ModalSuspensionContext.Provider></div></>;
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

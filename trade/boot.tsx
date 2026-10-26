import React, { useDeferredValue, useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexReactClient, useQuery } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { liveProducts, type LiveItem } from './catalog';
import { App, setProducts } from './app';

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // A failure on one page shouldn't lock the whole site: moving to another page tries again.
  private retry = () => this.setState({ failed: false });
  componentDidMount() {
    window.addEventListener('hashchange', this.retry);
  }
  componentWillUnmount() {
    window.removeEventListener('hashchange', this.retry);
  }
  render() {
    return this.state.failed ? (
      <main className="holm-boot">
        <h1>We’ll be right with you.</h1>
        <p>House of Louie Mae is temporarily unavailable. Please try again shortly.</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    ) : (
      this.props.children
    );
  }
}

/** Loads the live catalog (priced for this viewer) before the site renders. */
function Shell() {
  // Deferred, so the whole site renders as a background pass in short slices instead of one
  // long task the moment the catalog arrives; the shell stays on screen meanwhile.
  const catalog = useDeferredValue(useQuery(api.holm.catalog));
  const ready = useMemo(() => {
    if (!catalog) return false;
    setProducts(liveProducts(catalog.items as LiveItem[]));
    return true;
  }, [catalog]);
  // index.html paints the hero while the catalog loads; hand over in the same frame.
  const shell = document.getElementById('holm-shell');
  useLayoutEffect(() => {
    if (ready) shell?.remove();
  }, [ready, shell]);
  if (!ready)
    return shell ? null : (
      <main className="holm-boot">
        <p>Opening House of Louie Mae…</p>
      </main>
    );
  if (!catalog?.items.length)
    return (
      <main className="holm-boot">
        <h1>House of Louie Mae</h1>
        <p>The trade floor is being restocked. Please check back shortly.</p>
      </main>
    );
  // Re-mount when pricing changes (for example after trade approval) so every price refreshes.
  return <App key={catalog.trade ? 'trade' : 'retail'} />;
}

const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <ConvexAuthProvider client={client}>
        <Shell />
      </ConvexAuthProvider>
    </Boundary>
  </React.StrictMode>
);

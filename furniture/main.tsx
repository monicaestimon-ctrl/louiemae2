import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { FurnitureCatalog } from './Catalog';
import './style.css';
const Admin = lazy(() => import('./Admin'));
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fh-shell">
        <h1>We’ll be right with you.</h1>
        <p>The furniture catalog is temporarily unavailable. Please try again shortly.</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <ConvexAuthProvider client={client}>
        <Suspense fallback={<p className="fh-shell">Opening House of Louie Mae…</p>}>
          {location.pathname.replace(/\/+$/, '').endsWith('/admin') ? (
            <Admin />
          ) : (
            <FurnitureCatalog />
          )}
        </Suspense>
      </ConvexAuthProvider>
    </Boundary>
  </React.StrictMode>
);

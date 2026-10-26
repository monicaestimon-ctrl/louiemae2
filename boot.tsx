import React, { startTransition } from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// A transition renders in short slices that give the browser back its main thread in between,
// so taps and scrolls on the already-painted hero stay responsive while the app builds.
startTransition(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ConvexAuthProvider client={convex}>
          <App />
        </ConvexAuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
});

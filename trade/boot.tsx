import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { LiveShell, TradeBoundary } from './LiveShell';

const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TradeBoundary>
      <ConvexAuthProvider client={client}>
        <LiveShell />
      </ConvexAuthProvider>
    </TradeBoundary>
  </React.StrictMode>
);

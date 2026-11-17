import React, { lazy, Suspense, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { loadModule } from '../../lib/moduleRecovery';
import { quoteAccessFromUrl } from '../../lib/delivery/quoteAccess';
const Quote = lazy(() =>
  loadModule(() => import('./DeliveryQuoteStatus')).then((module) => ({
    default: module.DeliveryQuoteAccess,
  }))
);
function LoadState({ failed = false }: { failed?: boolean }) {
  return (
    <aside className="p-6 bg-white text-earth border" aria-label="Requested delivery quote">
      <p role={failed ? 'alert' : 'status'}>
        {failed
          ? 'Your private quote could not be opened. Please reload the original private link to try again.'
          : 'Opening your private delivery quote…'}
      </p>
      {failed && (
        <button className="min-h-11 px-4 underline" onClick={() => window.location.reload()}>
          Reload page
        </button>
      )}
    </aside>
  );
}
/** Ordinary visits never load private quote controls; preserve the original fragment during loading. */
export function LazyDeliveryQuoteAccess() {
  const [request] = useState(() => quoteAccessFromUrl(new URL(window.location.href)));
  if (!request) return null;
  return (
    <ErrorBoundary fallback={<LoadState failed />}>
      <Suspense fallback={<LoadState />}>
        <Quote initialRequest={request} />
      </Suspense>
    </ErrorBoundary>
  );
}

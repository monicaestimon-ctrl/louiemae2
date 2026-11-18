import { usePrivateIndexing } from '../usePrivateIndexing';
import React, { lazy, Suspense, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { loadModule } from '../../lib/moduleRecovery';
import { quoteAccessFromUrl } from '../../lib/delivery/quoteAccess';
const Quote = lazy(() =>
  loadModule(() => import('./DeliveryQuoteStatus')).then((module) => ({
    default: module.DeliveryQuoteAccess,
  }))
);
function LoadState({ failed = false, recover }: { failed?: boolean; recover?: () => void }) {
  return (
    <aside className="p-6 bg-white text-earth border" aria-label="Requested delivery quote">
      <p role={failed ? 'alert' : 'status'}>
        {failed
          ? 'Your private quote could not be opened. Please reload the original private link to try again.'
          : 'Opening your private delivery quote…'}
      </p>
      {failed && (
        <button className="min-h-11 px-4 underline" onClick={recover}>
          Reload page
        </button>
      )}
    </aside>
  );
}
/** Ordinary visits never load private quote controls; preserve the original fragment during loading. */
export function LazyDeliveryQuoteAccess() {
  const [originalUrl] = useState(() => new URL(window.location.href));
  const [request] = useState(() => quoteAccessFromUrl(originalUrl));
  usePrivateIndexing(!!request);
  const recover = () => {
    if (window.location.href !== originalUrl.href)
      window.history.replaceState(window.history.state, '', originalUrl.href);
    window.location.reload();
  };
  if (!request) return null;
  return (
    <ErrorBoundary fallback={<LoadState failed recover={recover} />}>
      <Suspense fallback={<LoadState />}>
        <Quote initialRequest={request} />
      </Suspense>
    </ErrorBoundary>
  );
}

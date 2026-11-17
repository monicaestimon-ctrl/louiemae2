import React from 'react';
import { usePendingTimeout } from '../contexts/usePendingTimeout';

export function LoadingFeature({ label, retry }: { label: string; retry: () => void }) {
  const timedOut = usePendingTimeout(true);
  return timedOut ? <div role="alert"><p>{label} is taking longer than expected.</p><button type="button" onClick={retry}>Try loading again</button><button type="button" onClick={() => window.location.reload()}>Reload page</button></div>
    : <p role="status" aria-live="polite">Loading {label.toLowerCase()}…</p>;
}


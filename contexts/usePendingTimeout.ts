import { useEffect, useMemo, useState } from 'react';

/** Bound a pending UI episode without polling or cancelling a recoverable subscription. */
export function usePendingTimeout(pending: boolean) {
  const request = useMemo(() => ({ pending }), [pending]);
  const [expiredRequest, setExpiredRequest] = useState<typeof request | null>(null);
  useEffect(() => {
    if (!request.pending) return;
    const timer = window.setTimeout(() => setExpiredRequest(request), 10_000);
    return () => window.clearTimeout(timer);
  }, [request]);
  return pending && expiredRequest === request;
}

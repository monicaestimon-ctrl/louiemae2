import { useState } from 'react';
import { usePendingTimeout } from './usePendingTimeout';
/** Live null/empty/error wins. Once observed, an initial snapshot can never be resurrected. */
export function useInitialPublicValue<T>(
  live: T | Error | undefined,
  initial: () => T | undefined,
  enabled = true,
  requestKey = ''
) {
  const [snapshot] = useState(() => ({ key: requestKey, value: initial() }));
  const [observedLive, setObservedLive] = useState(false);
  if (!observedLive && (live !== undefined || !enabled)) setObservedLive(true);
  const timedOut = usePendingTimeout(enabled && live === undefined, requestKey);
  const unavailable = live instanceof Error || timedOut;
  const value =
    enabled && !unavailable
      ? live !== undefined
        ? (live as T)
        : !observedLive && snapshot.key === requestKey
          ? snapshot.value
          : undefined
      : undefined;
  return { value, unavailable };
}

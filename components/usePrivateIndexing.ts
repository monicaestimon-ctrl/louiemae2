import { useLayoutEffect } from 'react';
import { acquirePrivateIndexing } from '../lib/privateIndexing';
/** Each private surface owns a lease, including its loading and failure UI. */
export function usePrivateIndexing(active: boolean) {
  useLayoutEffect(() => (active ? acquirePrivateIndexing(document) : undefined), [active]);
}

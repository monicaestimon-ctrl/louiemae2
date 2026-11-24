import { useLayoutEffect, useState } from 'react';
import type { PublicContentStatus } from '../contexts/usePublicSiteContent';

export function useInitialCollectionDocument(activePage: string, status: PublicContentStatus, exists: boolean) {
  const [present, setPresent] = useState(() => document.getElementById('lm-collection-document') !== null);
  useLayoutEffect(() => {
    const initial = document.getElementById('lm-collection-document');
    const schema = document.getElementById('lm-collection-structured-data');
    const id = activePage.startsWith('#collection/') ? activePage.slice(12).split('?')[0] : null;
    if (initial && (initial.dataset.collectionId !== id || status === 'unavailable' || (status === 'ready' && !exists))) initial.remove();
    if (schema && (schema.dataset.collectionId !== id || status === 'unavailable' || (status === 'ready' && !exists))) schema.remove();
    // Synchronize the server-owned document before Suspense paints its fallback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresent(document.getElementById('lm-collection-document') !== null);
  }, [activePage, status, exists]);
  return present;
}

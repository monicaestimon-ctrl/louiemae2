import { useLayoutEffect, useState } from 'react';
import type { PublicContentStatus } from '../contexts/usePublicSiteContent';

export function useInitialPageDocument(activePage: string, status: PublicContentStatus) {
  const [present, setPresent] = useState(() => document.getElementById('lm-page-document') !== null);
  useLayoutEffect(() => {
    for (const id of ['lm-page-document', 'lm-page-structured-data']) {
      const element = document.getElementById(id);
      if (element && (element.dataset.pageId !== activePage || status === 'unavailable')) element.remove();
    }
    // The server-owned document must remain visible while the interactive module loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresent(document.getElementById('lm-page-document') !== null);
  }, [activePage, status]);
  return present;
}

import { useLayoutEffect, useState } from 'react';
import { productRoute } from '../lib/storefrontNavigation';

/** Keep Suspense feedback observable when initial HTML is removed during navigation. */
export function useInitialProductDocument(activePage: string) {
  const [present, setPresent] = useState(() => document.getElementById('lm-product-document') !== null);
  useLayoutEffect(() => {
    const initial = document.getElementById('lm-product-document');
    const route = productRoute(activePage);
    if (initial && (initial.dataset.productId !== route?.id || initial.dataset.variantId !== (route?.variantId ?? ''))) {
      initial.remove();
      document.getElementById('lm-product-structured-data')?.remove();
    }
    // ProductPage may already have removed the document on a successful handoff.
    // Synchronize removal of server-owned DOM before Suspense paints its fallback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresent(document.getElementById('lm-product-document') !== null);
  }, [activePage]);
  return present;
}

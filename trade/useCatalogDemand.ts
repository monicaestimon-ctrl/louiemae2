import { useCallback, useEffect, useState } from 'react';

/** Only the landing page can work from its initial selection and curated references. */
export function routeNeedsCatalog(hash: string) {
  const route = hash.replace(/^#/, '').split('?')[0];
  return route !== '' && route !== 'home';
}

/** Demand lasts for this viewer session; an account change remounts the owner. */
export function useCatalogDemand() {
  const [requested, setRequested] = useState(() => routeNeedsCatalog(window.location.hash));
  const request = useCallback(() => setRequested(true), []);
  useEffect(() => {
    const changed = () => { if (routeNeedsCatalog(window.location.hash)) request(); };
    window.addEventListener('hashchange', changed);
    changed();
    return () => window.removeEventListener('hashchange', changed);
  }, [request]);
  return { requested, request };
}

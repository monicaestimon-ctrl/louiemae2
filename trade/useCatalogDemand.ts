import { useCallback, useEffect, useState } from 'react';

/** Only the landing page can work from its initial selection and curated references. */
export function routeNeedsCatalog(hash: string, discovery: 'legacy' | 'server' | 'pending' = 'legacy') {
  const route = hash.replace(/^#/, '').split('?')[0];
  if (discovery === 'pending' || (discovery === 'server' && route === 'discover')) return false;
  return route !== '' && route !== 'home';
}

/** Demand lasts for this viewer session; an account change remounts the owner. */
export function useCatalogDemand(discovery: 'legacy' | 'server' | 'pending' = 'legacy') {
  const [requested, setRequested] = useState(() => routeNeedsCatalog(window.location.hash, discovery));
  const request = useCallback(() => setRequested(true), []);
  useEffect(() => {
    const changed = () => { if (routeNeedsCatalog(window.location.hash, discovery)) request(); };
    window.addEventListener('hashchange', changed);
    changed();
    return () => window.removeEventListener('hashchange', changed);
  }, [request, discovery]);
  return { requested, request };
}

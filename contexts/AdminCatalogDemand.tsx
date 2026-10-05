import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Register demand rather than keeping the full private catalog subscribed for
// every authenticated visitor. Each mounted consumer owns its own registration.
export const AdminCatalogDemandContext = createContext<(() => () => void) | null>(null);
export const StorefrontCatalogDemandContext = createContext<(() => () => void) | null>(null);

export function useCatalogDemand() {
  const [consumers, setConsumers] = useState(0);
  const register = useCallback(() => {
    setConsumers(count => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setConsumers(count => count - 1);
    };
  }, []);
  return { requested: consumers > 0, register };
}
export const useAdminCatalogDemand = useCatalogDemand;

export function useAdminCatalog(enabled: boolean) {
  const register = useContext(AdminCatalogDemandContext);
  if (!register) throw new Error('useAdminCatalog must be used within a SiteProvider');
  useEffect(() => enabled ? register() : undefined, [enabled, register]);
}

export function useStorefrontCatalog(enabled = true) {
  const register = useContext(StorefrontCatalogDemandContext);
  if (!register) throw new Error('useStorefrontCatalog must be used within a SiteProvider');
  useEffect(() => enabled ? register() : undefined, [enabled, register]);
}

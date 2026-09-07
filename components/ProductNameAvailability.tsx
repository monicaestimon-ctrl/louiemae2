import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';

interface ProductNameAvailabilityProps {
  name: string;
  productId?: string;
  pendingClaimId?: string;
  ownerKey?: string;
  dark?: boolean;
}

export const ProductNameAvailability: React.FC<ProductNameAvailabilityProps> = ({
  name,
  productId,
  pendingClaimId,
  ownerKey,
  dark = false,
}) => {
  const [debouncedName, setDebouncedName] = useState(name);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedName(name.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [name]);

  const result = useQuery(
    api.productNameRegistry.checkAvailability,
    debouncedName.length >= 3
      ? {
          displayName: debouncedName,
          productId: productId as Id<'products'> | undefined,
          pendingClaimId: pendingClaimId as Id<'productNameClaims'> | undefined,
          ownerKey,
        }
      : 'skip',
  );

  const mutedClass = dark ? 'text-cream/50' : 'text-earth/50';
  const availableClass = dark ? 'text-emerald-300' : 'text-emerald-700';
  const unavailableClass = dark ? 'text-red-300' : 'text-red-700';

  if (name.trim().length < 3) return <p className={`mt-1 text-xs ${mutedClass}`}>Enter at least 3 characters.</p>;
  if (debouncedName !== name.trim() || result === undefined) {
    return <p className={`mt-1 flex items-center gap-1 text-xs ${mutedClass}`}><Loader2 className="h-3 w-3 animate-spin" /> Checking global name history…</p>;
  }
  return result.available ? (
    <p className={`mt-1 flex items-center gap-1 text-xs ${availableClass}`}><CheckCircle2 className="h-3.5 w-3.5" /> {result.message}</p>
  ) : (
    <p className={`mt-1 flex items-center gap-1 text-xs ${unavailableClass}`}><XCircle className="h-3.5 w-3.5" /> {result.message}</p>
  );
};

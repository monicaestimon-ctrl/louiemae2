import { useEffect, useMemo, useState } from 'react';
import { useQueries } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { usePendingTimeout } from '../../contexts/usePendingTimeout';
import type { CartItem } from '../../contexts/CartContext';
import { reviewCartItem } from '../../lib/cartCurrentReview';

/** Subscribe only while open. Never turn persisted display data into purchase authority. */
export function useCurrentCartReview(items: CartItem[], open: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // The SDK must commit an empty watch set before attaching the same query again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (retrying) setRetrying(false);
  }, [retrying]);
  const idsKey = JSON.stringify([...new Set(items.map((item) => item.product.id))].sort());
  const queries = useMemo(() => {
    const ids: string[] = JSON.parse(idsKey);
    return !open || retrying || ids.length > 30
      ? {}
      : Object.fromEntries(
          ids.map((id) => [id, { query: api.products.getStorefrontDetail, args: { id } }])
        );
  }, [idsKey, open, retrying]);
  const values = useQueries(queries);
  const pending = open && items.some((item) => values[item.product.id] === undefined);
  const timedOut = usePendingTimeout(pending, `${idsKey}:${attempt}:${open}`);
  const reviews = items.map((item) =>
    reviewCartItem(
      item,
      timedOut && values[item.product.id] === undefined
        ? new Error('Current details timed out')
        : values[item.product.id]
    )
  );
  return {
    reviews,
    blocked: !open || !items.length || reviews.some((review) => review.status !== 'ready'),
    fingerprint: JSON.stringify(reviews.map((review) => [review.status, review.fingerprint])),
    retry: () => {
      setRetrying(true);
      setAttempt((value) => value + 1);
    },
  };
}

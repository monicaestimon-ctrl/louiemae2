import { useEffect, useMemo, useState } from 'react';
import { useQueries } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { usePendingTimeout } from '../../contexts/usePendingTimeout';
import type { CartItem } from '../../contexts/CartContext';
import { cartItemKey, effectiveVariantId } from '../../lib/cartStorage';
import { reviewCartItem, type CurrentCartReview } from '../../lib/cartCurrentReview';

/** A retry changes query identity even when another component retains its old subscription. */
export function useCurrentCartReview(items: CartItem[], open: boolean) {
  const [attempt, setAttempt] = useState(0);
  const overLimit = items.length > 30;
  const linesKey = JSON.stringify(
    items.map((item) => ({
      key: cartItemKey(item),
      id: item.product.id,
      variantId: effectiveVariantId(item) ?? '',
      quantity: item.quantity,
    }))
  );
  const queries = useMemo(() => {
    const lines: { key: string; id: string; variantId: string; quantity: number }[] =
      JSON.parse(linesKey);
    return !open || overLimit
      ? {}
      : Object.fromEntries(
          lines.map(({ key, ...line }) => [
            key,
            { query: api.retailLaunch.cartReview, args: { ...line, attempt } },
          ])
        );
  }, [linesKey, open, overLimit, attempt]);
  const values = useQueries(queries);
  const deadlines = Object.values(values).flatMap((value) => {
    const deadline =
      value && typeof value === 'object' ? (value as { expiresAt?: unknown }).expiresAt : undefined;
    return typeof deadline === 'number' && Number.isSafeInteger(deadline) ? [deadline] : [];
  });
  const expiresAt = deadlines.length ? Math.min(...deadlines) : null;
  useEffect(() => {
    if (!open || expiresAt === null || expiresAt <= Date.now()) return;
    let refreshed = false;
    const refresh = () => {
      if (refreshed || Date.now() < expiresAt) return;
      refreshed = true;
      setAttempt((value) => Math.min(value + 1, 1_000_000));
    };
    const timer = setTimeout(refresh, Math.min(expiresAt - Date.now() + 1, 2_147_483_647));
    const visible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [expiresAt, open, linesKey]);
  const pending =
    open && !overLimit && items.some((item) => values[cartItemKey(item)] === undefined);
  const timedOut = usePendingTimeout(pending, `${linesKey}:${attempt}:${open}`);
  const reviews: CurrentCartReview[] = items.map((item) =>
    overLimit
      ? { status: 'limit', choices: [], fingerprint: 'limit' }
      : reviewCartItem(
          item,
          timedOut && values[cartItemKey(item)] === undefined
            ? new Error('Current details timed out')
            : values[cartItemKey(item)]
        )
  );
  return {
    reviews,
    overLimit,
    blocked: !open || !items.length || reviews.some((review) => review.status !== 'ready'),
    fingerprint: JSON.stringify(reviews.map((review) => [review.status, review.fingerprint])),
    retry: () => setAttempt((value) => Math.min(value + 1, 1_000_000)),
  };
}

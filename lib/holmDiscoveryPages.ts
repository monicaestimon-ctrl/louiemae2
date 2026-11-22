export type DiscoveryPage<T> = { ready: boolean; items: T[]; nextCursor: string | null; refreshAfterMs: number };

/** A changed upstream boundary invalidates every downstream page immediately,
 * including already-resolved subscriptions. Never show a stale suffix while
 * React catches up and replaces those subscriptions. */
export function discoveryPageChain<T>(cursors: readonly (string | null)[], results: readonly (DiscoveryPage<T> | Error | undefined)[]) {
  const items: T[] = [];
  let expected: string | null = null;
  let accepted = 0;
  let refreshAfterMs = 30_000;
  let pending = false;
  let unavailable = false;
  let error: Error | null = null;
  for (let index = 0; index < cursors.length; index++) {
    if ((index > 0 && expected === null) || cursors[index] !== expected) break;
    const page = results[index];
    if (page === undefined) { pending = true; break; }
    if (page instanceof Error) { error = page; break; }
    if (!page.ready) { unavailable = true; break; }
    if (page.nextCursor !== null && (page.nextCursor === cursors[index] || cursors.slice(0, index).includes(page.nextCursor))) {
      error = new Error('Catalog continuation did not advance.'); break;
    }
    items.push(...page.items);
    refreshAfterMs = Math.min(refreshAfterMs, page.refreshAfterMs);
    expected = page.nextCursor;
    accepted++;
  }
  return { items: unavailable || error ? [] : items, accepted, nextCursor: expected, pending, unavailable, error, refreshAfterMs };
}

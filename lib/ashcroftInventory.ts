export type AshcroftFeed = {
  observedAt: number;
  validUntil: number;
  rows: { sku: string; quantity: number }[];
};

/** Active-only supplier export: absence means unverified, never zero or available. */
export function ashcroftQuantity(feed: AshcroftFeed | null, sku: string | undefined, now: number) {
  if (!feed || !sku || feed.observedAt > now || feed.validUntil <= now) return null;
  return feed.rows.find(row => row.sku === sku)?.quantity ?? null;
}

type PricedVariant = { id: string; retail: number | null; trade: number | null };

/** Call only on the current, authorized catalog result, never raw candidate rows.
 * Both price directions represent a product by its cheapest eligible variant.
 * A reader accepts only the index row for this variant, so no seen-ID cursor is needed. */
export function representativeDiscoveryVariant<T extends PricedVariant>(variants: readonly T[], channel: 'retail' | 'trade'): T | null {
  let chosen: T | null = null;
  for (const variant of variants) {
    const price = variant[channel];
    if (price === null || !Number.isSafeInteger(price) || price <= 0) continue;
    const current = chosen?.[channel];
    if (!chosen || current === null || current === undefined || price < current
      || (price === current && variant.id < chosen.id)) chosen = variant;
  }
  return chosen;
}

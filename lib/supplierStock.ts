import type { Observation } from './catFreshness';

/** A newer on-hand file can withdraw availability, but cannot establish sellable stock. */
export function supplierStockConstraint(observations: readonly Observation[], stockObservedAt: number | undefined, now: number) {
  const candidates = observations.filter(o => o.field === 'supplier_inventory_on_hand'
    && Number.isSafeInteger(o.observedAt) && o.observedAt > 0 && o.observedAt <= now
    && (o.confidence === 'confirmed' || o.confidence === 'corroborated' || o.confidence === 'conflict'));
  if (!candidates.length) return null;
  const observedAt = Math.max(...candidates.map(o => o.observedAt));
  if (stockObservedAt !== undefined && stockObservedAt > observedAt) return null;
  const latest = candidates.filter(o => o.observedAt === observedAt);
  // Readers cap a single timestamp at 20 rows. Saturation is unresolved, not evidence of agreement.
  if (latest.length >= 20 || latest.some(o => o.confidence === 'conflict'))
    return { availability: 'unknown' as const, observedAt };
  const values = latest.map(o => {
    try {
      const value: unknown = JSON.parse(o.extractedValue);
      if (!value || typeof value !== 'object') return null;
      const row = value as Record<string, unknown>;
      if (row.kind !== 'on_hand' || ![row.CA_QTY, row.FL_QTY].every(q => q === null || (typeof q === 'number' && Number.isSafeInteger(q) && q >= 0))) return null;
      return [row.CA_QTY, row.FL_QTY];
    } catch { return null; }
  });
  const zero = values.every(v => v !== null && v[0] === 0 && v[1] === 0);
  return { availability: zero ? 'out_of_stock' as const : 'unknown' as const, observedAt };
}

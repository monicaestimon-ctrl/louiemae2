// MAP, promotions and market review (spec S13, v2 §8). MAP, advertised-price rules, coupons,
// trade treatment and rights are separate controls. A mechanism without documented supplier
// authorization is refused by the server whatever the client sends or the MAP arithmetic says.
import { CommerceError } from './errors';

export type Mechanism = 'coupon' | 'automatic' | 'project' | 'credit' | 'trade';
export type SupplierPolicyView = { kind: string; status: 'documented' | 'unverified' | 'denied'; scope: { all?: boolean; skus?: string[] } };

const POLICY_FOR: Record<Mechanism, string> = {
  coupon: 'coupon',
  automatic: 'coupon',
  project: 'promotion_stacking',
  credit: 'store_credit',
  trade: 'trade',
};

/** Suppliers whose mechanisms are disabled unless documented (v2 §8: Zuo coupons, promotions and stacking). */
export const DOCUMENTATION_REQUIRED = new Set(['zuo']);

/** Whether a mechanism may apply to a supplier SKU. */
export function mechanismAllowed(supplierCode: string, sku: string, mechanism: Mechanism, policies: readonly SupplierPolicyView[]): boolean {
  const kind = POLICY_FOR[mechanism];
  const relevant = policies.filter((p) => p.kind === kind && (p.scope.all || p.scope.skus?.includes(sku)));
  if (relevant.some((p) => p.status === 'denied')) return false;
  if (!DOCUMENTATION_REQUIRED.has(supplierCode)) return true;
  return relevant.some((p) => p.status === 'documented');
}

export function assertMechanism(supplierCode: string, sku: string, mechanism: Mechanism, policies: readonly SupplierPolicyView[]) {
  if (!mechanismAllowed(supplierCode, sku, mechanism, policies)) throw new CommerceError('MAP_POLICY_REVIEW', `${mechanism} is not authorized for ${supplierCode} ${sku}`, "This offer can't be applied to this item.");
}

/**
 * Advertised merchandise must not fall below MAP after discounts and credits. Delivery and tax
 * can't be used to hide it. `mapMinor` is on the same selling-unit basis as `netUnitMinor`.
 */
export function assertMapRespected(netUnitMinor: number, mapMinor: number | null, applicability: 'applies' | 'not_applicable' | 'unknown') {
  if (applicability === 'unknown') throw new CommerceError('MAP_POLICY_REVIEW', 'MAP applicability unknown');
  if (applicability === 'applies') {
    if (mapMinor === null || mapMinor <= 0) throw new CommerceError('MAP_POLICY_REVIEW', 'MAP missing or zero');
    if (netUnitMinor < mapMinor) throw new CommerceError('MAP_POLICY_REVIEW', `Net ${netUnitMinor} below MAP ${mapMinor}`);
  }
}

// ---------------- market review ----------------
export type MarketObservation = { exactMatch: boolean; totalBeforeTaxMinor: number; inStock: boolean };

/**
 * v2 §8 trigger: more than 10% above the median of at least three valid exact-product delivered
 * prices, or materially (default 25%) above the lowest valid one. Fewer than three → evidence limited.
 */
export function marketFlag(ourDeliveredMinor: number, observations: readonly MarketObservation[], materialBps = 2_500) {
  const exact = observations.filter((o) => o.exactMatch && o.inStock && o.totalBeforeTaxMinor > 0).map((o) => o.totalBeforeTaxMinor).sort((a, b) => a - b);
  if (exact.length < 3) return { flag: 'evidence_limited' as const, medianMinor: undefined };
  const mid = Math.floor(exact.length / 2);
  const median = exact.length % 2 ? exact[mid] : Math.round((exact[mid - 1] + exact[mid]) / 2);
  if (ourDeliveredMinor * 10 > median * 11) return { flag: 'above_median_10pct' as const, medianMinor: median };
  if (ourDeliveredMinor * 10_000 > exact[0] * (10_000 + materialBps)) return { flag: 'above_lowest_material' as const, medianMinor: median };
  return { flag: 'ok' as const, medianMinor: median };
}

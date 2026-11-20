/** Known supplier cost for a new legacy offer. Does not prove full expense qualification. */
export function legacySupplierCostMinor(cost: number | undefined, currency: string, usdRate: number): number | null {
  if (cost === undefined || !Number.isFinite(cost) || cost <= 0 || !/^[A-Z]{3}$/.test(currency)
    || !Number.isFinite(usdRate) || usdRate <= 0 || (currency === 'USD' && usdRate !== 1)) return null;
  const minor = Math.round(cost * usdRate * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

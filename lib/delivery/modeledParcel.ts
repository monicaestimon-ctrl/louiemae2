import { cartonMetrics, type CarrierRule, type CartonIn } from '../shipping/classify';

/** Owner-approved planning rates. Values include the modeled parcel surcharges,
 * but exclude supplier handling, customer processing and the uncertainty reserve. */
export type ModeledParcelRates = {
  sourceSha256: string;
  sourceObservedAt: number;
  maxCartons: number;
  maxLongestMm: number;
  maxSecondLongestMm: number;
  maxLengthPlusGirthMm: number;
  maxVolumeMm3: number;
  maxActualWeightG: number;
  /** Index zero is one billable pound. Missing weights/zones require a quote. */
  packageMinorByZone: Record<string, number[]>;
};

export function validModeledParcel(value: unknown): value is ModeledParcelRates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as ModeledParcelRates;
  if (!/^[a-f0-9]{64}$/.test(m.sourceSha256 ?? '') || !Number.isSafeInteger(m.sourceObservedAt)
    || m.sourceObservedAt <= 0 || m.sourceObservedAt > Date.now()) return false;
  for (const n of [m.maxCartons, m.maxLongestMm, m.maxSecondLongestMm, m.maxLengthPlusGirthMm,
    m.maxVolumeMm3, m.maxActualWeightG]) if (!Number.isSafeInteger(n) || n < 1) return false;
  if (m.maxCartons > 500 || !m.packageMinorByZone || typeof m.packageMinorByZone !== 'object'
    || Array.isArray(m.packageMinorByZone)) return false;
  const entries = Object.entries(m.packageMinorByZone);
  return entries.length > 0 && entries.length <= 100 && entries.every(([zone, rates]) =>
    zone.trim().length > 0 && Array.isArray(rates) && rates.length > 0 && rates.length <= 150
    && rates.every(n => Number.isSafeInteger(n) && n > 0 && n <= 100_000_000));
}

export function modeledParcelFreight(cartons: readonly CartonIn[], rule: CarrierRule,
  zone: string, model: ModeledParcelRates): { freightMinor: number; billableLb: number[] } | { reason: string } {
  if (!validModeledParcel(model) || !cartons.length || cartons.length > model.maxCartons)
    return { reason: 'Shipment is outside the approved parcel model' };
  const rates = model.packageMinorByZone[zone];
  if (!rates) return { reason: 'No approved parcel model for this delivery zone' };
  const weights = [];
  let total = 0;
  for (const carton of cartons) {
    if (carton.supplierMethod !== 'ground') return { reason: 'Supplier freight requires a separate quote' };
    let m;
    try { m = cartonMetrics(carton, rule); } catch { return { reason: 'Invalid carton measurements' }; }
    const dims = [carton.lengthMm, carton.widthMm, carton.heightMm].sort((a, b) => b - a);
    if (m.longestMm > model.maxLongestMm || dims[1] > model.maxSecondLongestMm
      || m.lengthPlusGirthMm > model.maxLengthPlusGirthMm || m.volumeMm3 > model.maxVolumeMm3
      || m.actualG > model.maxActualWeightG)
      return { reason: 'Carton size or weight is outside the approved parcel model' };
    // 1 lb = 453.59237 g. Round each carton independently; never average a basket.
    const lb = Math.ceil(m.billableG / 453.59237);
    const price = rates[lb - 1];
    if (!price) return { reason: 'Billable carton weight is outside the approved parcel model' };
    weights.push(lb); total += price;
  }
  if (!Number.isSafeInteger(total)) return { reason: 'Shipment total exceeds supported bounds' };
  return { freightMinor: total, billableLb: weights };
}

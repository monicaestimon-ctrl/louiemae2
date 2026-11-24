import { CommerceError } from '../errors';
import { mul, parseDecimal, rat, toMinor } from '../decimal';

export type CartonEvidence = {
  count: number;
  length: string;
  width: string;
  height: string;
  weight: string;
  dimensionsUnit: 'in' | 'mm';
  weightUnit: 'lb' | 'g';
  supplierMethod: 'ground' | 'ltl' | 'unknown';
};
export function normalizeCartons(rows: readonly CartonEvidence[]) {
  if (!rows.length || rows.length > 20)
    throw new CommerceError('INVALID_INPUT', 'Enter 1–20 carton types per selling pack');
  let count = 0;
  return rows.map((row, index) => {
    if (
      !Number.isSafeInteger(row.count) ||
      row.count < 1 ||
      row.count > 100 ||
      (count += row.count) > 100
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'A selling pack must contain 1–100 physical cartons'
      );
    const convert = (value: string, multiplier: ReturnType<typeof rat>, limit: number) => {
      if (!/^\d{1,9}(\.\d{1,6})?$/.test(value))
        throw new CommerceError(
          'INVALID_INPUT',
          'Use positive dimensions and gross shipping weights'
        );
      const normalized = toMinor(mul(parseDecimal(value), multiplier), 'ceil');
      if (normalized < 1 || normalized > limit)
        throw new CommerceError(
          'INVALID_INPUT',
          'Shipping measurement is outside the supported range'
        );
      return normalized;
    };
    const factor = row.dimensionsUnit === 'in' ? rat(254, 10) : rat(1);
    const [lengthMm, widthMm, heightMm] = [row.length, row.width, row.height]
      .map((n) => convert(n, factor, 20000))
      .sort((a, b) => b - a);
    const grossWeightG = convert(
      row.weight,
      row.weightUnit === 'lb' ? rat(45359237, 100000) : rat(1),
      10000000
    );
    return {
      index,
      cartonsPerPack: row.count,
      lengthMm,
      widthMm,
      heightMm,
      grossWeightG,
      supplierMethod: row.supplierMethod,
    };
  });
}

export type WarehouseEvidence = {
  active: boolean;
  evidenceRef?: string;
  verifiedAt?: number;
  validUntil?: number;
  timezone?: string;
  cutoffLocal?: string;
  services?: ('ground' | 'ltl')[];
};
export function warehouseCurrent(w: WarehouseEvidence | null, now: number): boolean {
  return (
    !!w?.active &&
    !!w.evidenceRef?.trim() &&
    Number.isSafeInteger(w.verifiedAt) &&
    w.verifiedAt! > 0 &&
    w.verifiedAt! <= now &&
    Number.isSafeInteger(w.validUntil) &&
    w.validUntil! > now &&
    !!w.timezone &&
    !!w.cutoffLocal &&
    !!w.services?.length
  );
}

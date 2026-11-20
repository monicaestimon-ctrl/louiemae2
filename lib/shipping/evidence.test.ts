import { describe, expect, it } from 'vitest';
import { normalizeCartons, warehouseCurrent, type CartonEvidence } from './evidence';
const row: CartonEvidence = {
  count: 1,
  length: '24',
  width: '20',
  height: '36',
  weight: '30',
  dimensionsUnit: 'in',
  weightUnit: 'lb',
  supplierMethod: 'ltl',
};
describe('shipping source measurements', () => {
  it('keeps carton count separate from pack pieces and normalizes exact source units conservatively', () => {
    expect(normalizeCartons([row])).toEqual([
      {
        index: 0,
        cartonsPerPack: 1,
        lengthMm: 915,
        widthMm: 610,
        heightMm: 508,
        grossWeightG: 13608,
        supplierMethod: 'ltl',
      },
    ]);
    expect(
      normalizeCartons([{ ...row, count: 2, dimensionsUnit: 'mm', weightUnit: 'g' }])[0]
    ).toMatchObject({ cartonsPerPack: 2, lengthMm: 36, grossWeightG: 30 });
  });
  it('rejects missing, nonphysical and unbounded shipping measurements', () => {
    for (const change of [
      { count: 0 },
      { count: 1.1 },
      { length: '' },
      { weight: '-2' },
      { height: '1e3' },
      { width: '999999999' },
    ])
      expect(() => normalizeCartons([{ ...row, ...change }])).toThrow();
    expect(() => normalizeCartons([])).toThrow();
    expect(() =>
      normalizeCartons([
        { ...row, count: 60 },
        { ...row, count: 60 },
      ])
    ).toThrow();
  });
  it('requires current origin evidence, not just a ZIP and active switch', () => {
    const now = Date.now();
    const source = {
      active: true,
      evidenceRef: 'Supplier source',
      verifiedAt: now - 1000,
      validUntil: now + 1000,
      timezone: 'America/Los_Angeles',
      cutoffLocal: '14:00',
      services: ['ground' as const],
    };
    expect(warehouseCurrent(source, now)).toBe(true);
    for (const change of [
      { verifiedAt: now + 1 },
      { validUntil: now },
      { evidenceRef: '' },
      { services: [] },
      { active: false },
      { verifiedAt: undefined },
    ])
      expect(warehouseCurrent({ ...source, ...change }, now)).toBe(false);
  });
});

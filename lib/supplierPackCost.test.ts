import { describe, expect, it } from 'vitest';
import { supplierPackCostMinor } from './supplierPackCost';

describe('supplier pack costs', () => {
  it('rounds exact per-piece decimals only after packing', () => {
    expect(supplierPackCostMinor({ wholesaleMinor: 11513, wholesalePrecise: '115.125' }, 2)).toBe(
      23025
    );
    expect(supplierPackCostMinor({ wholesaleMinor: 11513, wholesalePrecise: '115.125' }, 1)).toBe(
      11513
    );
    expect(supplierPackCostMinor({ wholesaleMinor: 11513 }, 2)).toBe(23026);
  });
  it('distinguishes unknown costs from confirmed zero', () => {
    expect(supplierPackCostMinor(null, 2)).toBeNull();
    expect(supplierPackCostMinor({ wholesaleMinor: null }, 2)).toBeNull();
    expect(supplierPackCostMinor({ wholesaleMinor: 0 }, 2)).toBe(0);
  });
  it('rejects invalid sources, pack bases and unsafe totals without a silent fallback', () => {
    for (const pieces of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => supplierPackCostMinor({ wholesaleMinor: 100 }, pieces)).toThrow();
    for (const cost of [
      { wholesaleMinor: -1 },
      { wholesaleMinor: 1.5 },
      { wholesaleMinor: 100, wholesalePrecise: '' },
      { wholesaleMinor: 100, wholesalePrecise: '-1' },
    ])
      expect(() => supplierPackCostMinor(cost, 2)).toThrow();
    expect(() => supplierPackCostMinor({ wholesaleMinor: Number.MAX_SAFE_INTEGER }, 2)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyProjectPricing,
  clientSellCents,
  floorCents,
  projectTier,
  tradeCents,
} from './holmPricing';

describe('House of Louie Mae trade pricing', () => {
  it('takes 25% off retail when the margin allows it', () => {
    expect(tradeCents(10_000_00, 4_000_00)).toBe(7_500_00);
  });

  it('never prices below landed cost plus the 25% margin floor after card fees', () => {
    // (6,000 + 0.30) / (1 − 0.25 − 0.029)
    expect(floorCents(6_000_00)).toBe(8_322_20);
    expect(tradeCents(10_000_00, 6_000_00)).toBe(8_322_20);
    // the floor price keeps at least 25% after cost and processing
    const p = floorCents(568_00);
    expect(p - 568_00 - (p * 0.029 + 30)).toBeGreaterThanOrEqual(p * 0.25 - 1);
  });

  it('does not offer a price when retail cannot fund the known cost floor', () => {
    expect(tradeCents(10_000_00, 9_000_00)).toBe(0);
  });

  it('reaches 3% over $10,000 and 5% over $25,000', () => {
    expect(projectTier(9_999_99).bps).toBe(0);
    expect(projectTier(10_000_00)).toEqual({ bps: 300, next: { minCents: 2_500_000, bps: 500 } });
    expect(projectTier(25_000_00)).toEqual({ bps: 500, next: null });
  });

  it('limits project pricing by each line floor', () => {
    const out = applyProjectPricing([
      { unitCents: 7_500_00, quantity: 2, floorCents: 0 },
      { unitCents: 7_500_00, quantity: 2, floorCents: 7_400_00 },
    ]);
    expect(out.bps).toBe(500);
    expect(out.units).toEqual([7_125_00, 7_400_00]);
    expect(out.discountCents).toBe(2 * 375_00 + 2 * 100_00);
  });

  it('rejects unfunded project lines instead of lowering their floor', () => {
    expect(() => applyProjectPricing([
      { unitCents: 10_000_00, quantity: 3, floorCents: 12_000_00 },
    ])).toThrow(/funded lines/);
  });
  it.each([0, -1, NaN, Infinity, 100.5])('does not turn unknown or invalid cost %s into an offer', cost => {
    expect(tradeCents(100_000, cost)).toBe(0);
  });
  it('refuses malformed project quantities and unsupported totals', () => {
    expect(() => applyProjectPricing([{unitCents: 10000, quantity: 1.5, floorCents: 1000}])).toThrow();
    expect(() => applyProjectPricing([{unitCents: Number.MAX_SAFE_INTEGER, quantity: 2, floorCents: 1000}])).toThrow();
  });

  it('prices client quotes from trade', () => {
    expect(clientSellCents(10_000, 7_500, 'cost', 0)).toBe(7_500);
    expect(clientSellCents(10_000, 7_500, 'retail', 0)).toBe(10_000);
    expect(clientSellCents(10_000, 7_500, 'markup', 4000)).toBe(10_500);
  });
});

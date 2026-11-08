import { describe, expect, it } from 'vitest';
import { allocateHandling, estimateCart, evaluateGroup, flatRateTax, ladderCharge, type EngineGroup, type EngineLine } from './engine';
import { classify, type CarrierRule } from '../shipping/classify';
import { CONFIG_SEED } from '../config/seed';
import type { DeliveryLadder } from '../config';

const ladder = CONFIG_SEED.find((s) => s.key === 'delivery-ladder')!.value as DeliveryLadder;
const rates = { processingBps: 300, returnsBps: 200, overheadBps: 500, deliveryProcessingBps: 300 };
const noTax = flatRateTax(0);

describe('ladder (DEL01, G3)', () => {
  it('maps the spec examples', () => {
    expect(ladderCharge(4_999, ladder)).toBe(4_999);
    expect(ladderCharge(5_000, ladder)).toBe(5_999);
    expect(ladderCharge(19_500, ladder)).toBe(19_999);
    expect(ladderCharge(20_000, ladder)).toBeNull();
    expect(ladderCharge(0, ladder)).toBe(4_999);
    expect(ladderCharge(7_732, ladder)).toBe(7_999);
  });
  it('is monotonic at every boundary', () => {
    let last = 0;
    for (let q = 0; q <= 19_999; q += 1) {
      const c = ladderCharge(q, ladder)!;
      expect(c).toBeGreaterThanOrEqual(last);
      expect(c).toBeGreaterThanOrEqual(q);
      last = c;
    }
  });
});

const line = (over: Partial<EngineLine> = {}): EngineLine => ({ key: 'l', netMinor: 100_000, costMinor: 40_000, physicalUnits: 1, allowancePerUnitMinor: 2_500, marginBps: 2_000, commissionMinor: 0, otherMinor: 0, ...over });

describe('line economics (DEL02, G2)', () => {
  it('reproduces the worked example: F = $100, S = $25, pd = 3% → $79.99', () => {
    // A line whose budget is exactly $25 and whose contribution exceeds it.
    const g: EngineGroup = { key: 'g', supplierOrderFeeMinor: 1_000, freightMinor: 10_000, quoteReasons: [], lines: [line({ allowancePerUnitMinor: 2_500 })] };
    const r = evaluateGroup(g, rates);
    expect(r.subsidyMinor).toBe(2_500); // B = 25 + max(0, 10 − 10)
    expect(r.requirementMinor).toBe(7_732);
    const est = estimateCart([g], rates, ladder, noTax);
    expect(est.status === 'ok' && est.deliveryMinor).toBe(7_999);
  });

  it('allocates the supplier order fee once, by physical units (four pieces, one $10 fee, $40 allocation → $30 left)', () => {
    const lines = [line({ key: 'a', physicalUnits: 2, allowancePerUnitMinor: 0 }), line({ key: 'b', physicalUnits: 2, allowancePerUnitMinor: 0 })];
    expect(allocateHandling(lines, 1_000)).toEqual([500, 500]);
    const r = evaluateGroup({ key: 'g', supplierOrderFeeMinor: 1_000, freightMinor: 0, quoteReasons: [], lines }, rates);
    expect(r.lines.map((l) => l.budgetMinor)).toEqual([1_500, 1_500]); // $30 left in total, never spent twice
  });

  it('caps each line by its own contribution, never min(ΣA, ΣB)', () => {
    const rich = line({ key: 'rich', netMinor: 100_000, costMinor: 10_000, allowancePerUnitMinor: 2_500 });
    const thin = line({ key: 'thin', netMinor: 10_000, costMinor: 6_900, allowancePerUnitMinor: 6_000 });
    const r = evaluateGroup({ key: 'g', supplierOrderFeeMinor: 0, freightMinor: 50_000, quoteReasons: [], lines: [rich, thin] }, rates);
    const thinRes = r.lines.find((l) => l.key === 'thin')!;
    expect(thinRes.subsidyMinor).toBe(thinRes.contributionMinor); // limited by its own A, not the rich line's spare
    expect(thinRes.subsidyMinor).toBeLessThan(thinRes.budgetMinor);
  });

  it('blocks automatic checkout for a negative contribution or an unresolved margin', () => {
    const neg = estimateCart([{ key: 'g', supplierOrderFeeMinor: 0, freightMinor: 5_000, quoteReasons: [], lines: [line({ costMinor: 99_000 })] }], rates, ladder, noTax);
    expect(neg.status).toBe('quote_required');
    const unresolved = estimateCart([{ key: 'g', supplierOrderFeeMinor: 0, freightMinor: 5_000, quoteReasons: [], lines: [line({ marginBps: null })] }], rates, ladder, noTax);
    expect(unresolved.status).toBe('quote_required');
  });

  it('sums mixed groups once, rounds once, and makes the whole cart quote-required if any group needs a quote', () => {
    const a: EngineGroup = { key: 'zuo-95206', supplierOrderFeeMinor: 1_000, freightMinor: 4_000, quoteReasons: [], lines: [line({ key: 'a' })] };
    const b: EngineGroup = { key: 'zuo-other', supplierOrderFeeMinor: 1_000, freightMinor: 4_000, quoteReasons: [], lines: [line({ key: 'b', allowancePerUnitMinor: 0 })] };
    const est = estimateCart([a, b], rates, ladder, noTax);
    expect(est.status).toBe('ok');
    if (est.status === 'ok') expect(est.deliveryMinor).toBe(4_999 + 1_000); // 1031 + 1031 = 2062 → $49.99… plus no extra
    const q = estimateCart([a, { ...b, freightMinor: null, quoteReasons: ['LTL needs a quote'] }], rates, ladder, noTax);
    expect(q.status).toBe('quote_required');
  });

  it('adds a fixed supplier-rule charge (Ashcroft per-item) on top of the ladder', () => {
    const est = estimateCart([], rates, ladder, noTax, 7_900);
    expect(est.status === 'ok' && est.deliveryMinor).toBe(7_900);
  });

  it('iterates tax upward until the tier is stable', () => {
    const g: EngineGroup = { key: 'g', supplierOrderFeeMinor: 0, freightMinor: 7_600, quoteReasons: [], lines: [line({ netMinor: 30_000, costMinor: 20_000, allowancePerUnitMinor: 0 })] };
    const withTax = estimateCart([g], rates, ladder, flatRateTax(1_000));
    const without = estimateCart([g], rates, ladder, noTax);
    expect(withTax.status).toBe('ok');
    if (withTax.status === 'ok' && without.status === 'ok') {
      expect(withTax.deliveryMinor).toBeGreaterThanOrEqual(without.deliveryMinor);
      expect(withTax.taxMinor).toBeGreaterThan(0);
    }
  });
});

describe('shipment classification (DEL03)', () => {
  const rule: CarrierRule = { carrier: 'test', service: 'ground', effectiveFrom: 0, dimDivisorMm3PerG: 5_000, ground: { maxLongestMm: 2_743, maxLengthPlusGirthMm: 4_191, maxWeightG: 68_000 }, ltl: { maxLongestMm: 3_600, maxWeightG: 900_000, maxCartons: 20 } };
  const carton = (over = {}) => ({ lengthMm: 900, widthMm: 600, heightMm: 500, grossWeightG: 15_000, supplierMethod: 'ground' as const, ...over });
  it('ships small cartons by ground and computes girth per carton', () => {
    const c = classify([carton()], rule);
    expect(c.mode).toBe('ground');
    expect(c.cartons[0]).toMatchObject({ longestMm: 900, girthMm: 2_200, lengthPlusGirthMm: 3_100 });
  });
  it('moves an oversize carton to LTL and never downgrades supplier LTL', () => {
    expect(classify([carton({ lengthMm: 2_800 })], rule).mode).toBe('ltl');
    expect(classify([carton({ supplierMethod: 'ltl' as const })], rule).mode).toBe('ltl');
  });
  it('quotes sofas beyond LTL limits, unknown cartons and quote-only destinations', () => {
    expect(classify([carton({ lengthMm: 4_000 })], rule).mode).toBe('quote');
    expect(classify([], rule).mode).toBe('quote');
    expect(classify([carton()], rule, { quoteOnly: true }).mode).toBe('quote');
    expect(classify([carton({ grossWeightG: 0 })], rule).mode).toBe('quote');
  });
});

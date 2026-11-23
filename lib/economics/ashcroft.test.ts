import { describe, expect, it } from 'vitest';
import { ashcroftBase, ashcroftBasketFunded, ashcroftMinimums, ashcroftScenario, type AshcroftPricingInput } from './ashcroft';
import { rat, toMinor } from '../decimal';
import { parseConfig } from '../config';

const input: AshcroftPricingInput = {
  wholesaleSellingUnit: rat(30000), extraSellingUnitCostsMinor: [0, 0, 0],
  modeledFreightMinor: 11900, customerDeliveryMinor: 2900, mapSellingUnitMinor: null,
  marginBps: 2000, maxCommissionBps: 1800,
  assumptions: { supplierCode: 'ashcroft', wholesaleUnitBasis: 'selling_unit', supplierPaymentReserveBps: 300,
    handlingPerSellingUnitMinor: 0, fixedProcessingPerSellingUnitMinor: 30,
    processingBps: 300, returnsBps: 200, overheadBps: 500, fundedTradeDiscountBps: 0 },
};

describe('independent Ashcroft selling-unit economics', () => {
  it('funds freight net of customer delivery processing without a Zuo allowance', () => {
    // $309 cost with reserve + $119 modeled freight + $0.30 processing - $28.13 net delivery.
    expect(toMinor(ashcroftBase(input), 'ceil')).toBe(40017);
    const floors = ashcroftMinimums(input);
    expect(floors).toEqual({ basePackMinor: 40017, minimumRetailMinor: 76956, minimumTradeMinor: 57168 });
    expect(ashcroftScenario(input, 'retail', floors.minimumRetailMinor, 1800).passes).toBe(true);
    expect(ashcroftScenario(input, 'retail', floors.minimumRetailMinor - 1, 1800).passes).toBe(false);
    expect(ashcroftScenario(input, 'trade', floors.minimumTradeMinor, 0).passes).toBe(true);
    expect(ashcroftScenario(input, 'trade', floors.minimumTradeMinor - 1, 0).passes).toBe(false);
  });
  it('counts a selling unit once and never uses excess delivery to fund merchandise', () => {
    expect(toMinor(ashcroftBase({ ...input, customerDeliveryMinor: 100000 }), 'ceil')).toBe(30930);
    const fractional = { ...input, wholesaleSellingUnit: rat(3000001, 100) };
    expect(ashcroftMinimums(fractional).minimumRetailMinor).toBe(76956);
  });
  it('uses only an explicitly funded discount and matching selling-unit MAP', () => {
    const fixed = { ...input, mapSellingUnitMinor: 80000,
      assumptions: { ...input.assumptions, fundedTradeDiscountBps: 2500 } };
    expect(ashcroftMinimums(fixed).minimumRetailMinor).toBe(106667);
    expect(ashcroftMinimums({ ...fixed, assumptions: input.assumptions }).minimumRetailMinor).toBe(80000);
  });
  it('does not apply referral commission to the trade floor', () => {
    expect(ashcroftMinimums({ ...input, maxCommissionBps: 0 }).minimumTradeMinor).toBe(57168);
    expect(ashcroftScenario(input, 'trade', 60000, 0).contributionMinor).toBe(13983);
  });
  it('requires complete costs and a positive funding denominator', () => {
    for (const extra of [null, -1, 1.1]) expect(() => ashcroftMinimums({ ...input, extraSellingUnitCostsMinor: [extra] })).toThrow();
    expect(() => ashcroftMinimums({ ...input, marginBps: 9500 })).toThrow();
    expect(() => ashcroftMinimums({ ...input, wholesaleSellingUnit: rat(0) })).toThrow();
  });
  it('validates independent settings and rejects Zuo fields or incompatible units', () => {
    expect(parseConfig('pricingAssumptions', input.assumptions)).toEqual(input.assumptions);
    for (const patch of [{ wholesaleUnitBasis: 'piece' }, { handlingPerPieceMinor: 1000 }, { allowanceBySize: {} },
      { fixedProcessingPerSellingUnitMinor: undefined }, { fundedTradeDiscountBps: 10000 }])
      expect(() => parseConfig('pricingAssumptions', { ...input.assumptions, ...patch })).toThrow();
  });
});

it('uses identical exact funding at fractional minimum prices and rejects unfunded credit or tax', () => {
  const i = { ...input, wholesaleSellingUnit: rat(10002), maxCommissionBps: 0 };
  const base = ashcroftBase(i);
  const basis = { baseNumerator: String(base.n), baseDenominator: String(base.d), ...i.assumptions, commissionBps: 0, marginBps: i.marginBps };
  expect(ashcroftMinimums(i).minimumRetailMinor).toBe(27742);
  expect(ashcroftScenario(i, 'retail', 27742, 0).passes).toBe(true);
  expect(ashcroftBasketFunded(basis, 27742, 1)).toBe(true);
  expect(ashcroftBasketFunded(basis, 27742 * 3, 3)).toBe(true);
  expect(ashcroftBasketFunded(basis, 27741, 1)).toBe(false);
  expect(ashcroftBasketFunded(basis, 27742, 1, 100)).toBe(false);
});

import { describe, expect, it } from 'vitest';
import { planningDelivery } from './planning';
const ladder = { tiersMinor: [4999, 5999, 6999, 7999, 8999, 9999, 10999, 11999, 12999, 13999, 14999], minimumMinor: 4999, quoteAboveMinor: 14999, deliveryProcessingBps: 300 };
const input = { freightMinor: 15000, uncertaintyBps: 1000, supplierOrderFeeMinor: 1000, lines: [{ units: 2, allowanceMinor: 3000, handlingMinor: 1000 }], ladder };
describe('nonbinding planning budgets', () => {
  it('applies reserve and per-order fee once then subtracts embedded physical-unit budgets', () => {
    // (15000 + 1500 + 1000 - 6000 - 2000) / .97 = 9793.82, then customer tier.
    expect(planningDelivery(input)).toBe(9999);
    expect(planningDelivery({ ...input, lines: [{ units: 1, allowanceMinor: 3000, handlingMinor: 1000 }, { units: 1, allowanceMinor: 3000, handlingMinor: 1000 }] })).toBe(9999);
  });
  it('honors the minimum and refuses amounts above the supported ladder', () => {
    expect(planningDelivery({ ...input, freightMinor: 100 })).toBe(4999);
    expect(planningDelivery({ ...input, freightMinor: 100000 })).toBeNull();
  });
  it('rejects invalid or overflowing monetary inputs', () => {
    expect(planningDelivery({ ...input, freightMinor: -1 })).toBeNull();
    expect(planningDelivery({ ...input, freightMinor: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(planningDelivery({ ...input, lines: [{ units: 0, allowanceMinor: 0, handlingMinor: 0 }] })).toBeNull();
  });
});

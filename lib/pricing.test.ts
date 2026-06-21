import { describe, expect, it } from 'vitest';
import {
  calculateEstimatedCjProductCost,
  calculateLandedCost,
  calculatePricingBreakdown,
  calculateRetailFromLandedCost,
  getEstimatedShipping,
} from './pricing';

describe('pricing engine', () => {
  it('keeps the existing source estimate formula', () => {
    const pricing = calculatePricingBreakdown({
      sourcePriceUsd: 10,
      collection: 'furniture',
    });

    expect(calculateEstimatedCjProductCost(10)).toBe(14);
    expect(getEstimatedShipping('furniture')).toBe(22);
    expect(pricing.landedCost).toBe(36);
    expect(pricing.suggestedRetailPrice).toBe(107.99);
    expect(pricing.pricingSource).toBe('source_estimate');
  });

  it('calculates retail from confirmed landed cost with fees', () => {
    const landedCost = calculateLandedCost(12.5, 7.25, {
      serviceFee: 1.1,
      taxesFee: 0.9,
      clearanceFee: 0.75,
      remoteFee: 0.5,
    });

    expect(landedCost).toBe(23);
    expect(calculateRetailFromLandedCost(landedCost)).toBe(68.99);
  });

  it('uses confirmed product and shipping costs when available', () => {
    const pricing = calculatePricingBreakdown({
      sourcePriceUsd: 5,
      collection: 'kids',
      confirmedProductCost: 9.25,
      confirmedShippingCost: 6.5,
      fees: { taxesFee: 0.25 },
    });

    expect(pricing.productCost).toBe(9.25);
    expect(pricing.shippingCost).toBe(6.5);
    expect(pricing.landedCost).toBe(16);
    expect(pricing.suggestedRetailPrice).toBe(47.99);
    expect(pricing.pricingSource).toBe('cj_freight_confirmed');
    expect(pricing.warnings).toHaveLength(0);
  });

  it('treats zero-dollar confirmed shipping as confirmed', () => {
    const pricing = calculatePricingBreakdown({
      sourcePriceUsd: 5,
      collection: 'kids',
      confirmedProductCost: 7,
      confirmedShippingCost: 0,
      fees: { serviceFee: -3 },
    });

    expect(pricing.shippingCost).toBe(0);
    expect(pricing.serviceFee).toBe(0);
    expect(pricing.landedCost).toBe(7);
    expect(pricing.pricingSource).toBe('cj_freight_confirmed');
    expect(pricing.warnings).toHaveLength(0);
  });

  it('keeps current retail price visible when admin locked', () => {
    const pricing = calculatePricingBreakdown({
      sourcePriceUsd: 10,
      collection: 'decor',
      currentRetailPrice: 80,
      adminLockedPrice: true,
    });

    expect(pricing.currentRetailPrice).toBe(80);
    expect(pricing.suggestedRetailPrice).toBe(77.99);
    expect(pricing.estimatedProfit).toBe(54);
    expect(pricing.warnings).toContain('Admin price is locked; suggested CJ price was not applied automatically.');
  });
});

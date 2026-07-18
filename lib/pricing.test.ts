import { describe, expect, it } from 'vitest';
import {
  calculateEstimatedCjProductCost,
  calculateLandedCost,
  calculateOrderPricingReconciliation,
  calculatePricingBreakdown,
  calculateRetailFromProductCost,
  calculateRetailFromLandedCost,
  getCheckoutShippingForSubtotal,
  getEstimatedShipping,
} from './pricing';

describe('pricing engine', () => {
  it('calculates source estimates from source price, CJ buffer, retail multiplier, then shipping', () => {
    const pricing = calculatePricingBreakdown({
      sourcePriceUsd: 10,
      collection: 'furniture',
    });

    expect(calculateEstimatedCjProductCost(10)).toBe(12);
    expect(getEstimatedShipping('furniture')).toBe(120);
    expect(pricing.landedCost).toBe(132);
    expect(pricing.suggestedRetailPrice).toBe(143.99);
    expect(pricing.pricingSource).toBe('source_estimate');
  });

  it('adds shipping after the retail multiplier instead of multiplying shipping', () => {
    expect(calculateRetailFromProductCost(12, 120)).toBe(143.99);
  });

  it('uses conservative category shipping buffers before CJ freight is confirmed', () => {
    expect(getEstimatedShipping('fashion')).toBe(20);
    expect(getEstimatedShipping('kids')).toBe(20);
    expect(getEstimatedShipping('decor')).toBe(69.99);
    expect(getEstimatedShipping('furniture')).toBe(120);
    expect(getEstimatedShipping('unknown')).toBe(20);
  });

  it('calculates retail from confirmed landed cost with fees', () => {
    const landedCost = calculateLandedCost(12.5, 7.25, {
      serviceFee: 1.1,
      taxesFee: 0.9,
      clearanceFee: 0.75,
      remoteFee: 0.5,
    });

    expect(landedCost).toBe(23);
    expect(calculateRetailFromLandedCost(landedCost)).toBe(45.99);
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
    expect(pricing.suggestedRetailPrice).toBe(25.99);
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
    expect(pricing.suggestedRetailPrice).toBe(93.99);
    expect(pricing.estimatedProfit).toBe(-1.99);
    expect(pricing.warnings).toContain('Admin price is locked; suggested CJ price was not applied automatically.');
  });

  it('selects customer-facing checkout shipping from cart subtotal tiers', () => {
    expect(getCheckoutShippingForSubtotal(0).amount).toBe(49.99);
    expect(getCheckoutShippingForSubtotal(150).amount).toBe(49.99);
    expect(getCheckoutShippingForSubtotal(199.99).amount).toBe(49.99);
    expect(getCheckoutShippingForSubtotal(200).amount).toBe(69.99);
    expect(getCheckoutShippingForSubtotal(348.99).amount).toBe(69.99);
    expect(getCheckoutShippingForSubtotal(349).amount).toBe(89.99);
    expect(getCheckoutShippingForSubtotal(499.99).amount).toBe(89.99);
    expect(getCheckoutShippingForSubtotal(500).amount).toBe(99.99);
  });

  it('reconciles order-level CJ costs against customer shipping collected', () => {
    const reconciliation = calculateOrderPricingReconciliation({
      items: [
        { quantity: 2, productCost: 6, estimatedShippingCost: 4, retailPrice: 24 },
      ],
      quotedShippingCost: 9,
      quotedTaxesFee: 1,
      quotedClearanceFee: 0.5,
      customerShippingCollected: 9.99,
      freightQuoteAvailable: true,
    });

    expect(reconciliation.productCostTotal).toBe(12);
    expect(reconciliation.landedCost).toBe(22.5);
    expect(reconciliation.estimatedProfit).toBe(35.49);
    expect(reconciliation.warnings).toHaveLength(0);
  });

  it('warns when order freight or product costs are weak', () => {
    const reconciliation = calculateOrderPricingReconciliation({
      items: [
        { quantity: 1, estimatedShippingCost: 4, retailPrice: 20 },
      ],
      quotedShippingCost: 8,
      customerShippingCollected: 0,
      freightQuoteAvailable: true,
    });

    expect(reconciliation.warnings).toContain('One or more CJ product costs were missing; order profit may be understated.');
    expect(reconciliation.warnings).toContain('Actual destination freight is more than 25% above product-level shipping assumptions.');
  });
});

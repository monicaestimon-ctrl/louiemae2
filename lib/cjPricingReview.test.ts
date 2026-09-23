import { describe, expect, it } from 'vitest';
import { cjMoney, cjPricingBlocks, quoteRetail, type CjPricedProduct } from './cjPricingReview';
const now = Date.now();
const product = (): CjPricedProduct => ({
  price: 30.99,
  cjProductId: 'pid',
  cjSourcingStatus: 'approved',
  cjVariantId: 'vid',
  cjSku: 'sku',
  cjPricingReview: {
    cjProductId: 'pid',
    checkedAt: now,
    destination: 'US',
    quantity: 1,
    quotes: [
      {
        vid: 'vid',
        sku: 'sku',
        name: 'Default',
        itemCost: 10,
        shippingCost: 8,
        taxesFee: 2,
        origin: 'CN',
        logisticsName: 'CJPacket',
      },
    ],
  },
});
describe('CJ publication pricing', () => {
  it('requires quotes even when sourcing is approved', () => {
    const p = product();
    delete p.cjPricingReview;
    expect(cjPricingBlocks(p, now)).not.toHaveLength(0);
  });
  it('does not convert absent prices to zero', () => {
    for (const n of [null, undefined, '', ' ', NaN, Infinity, -1, false])
      expect(cjMoney(n)).toBeUndefined();
    expect(cjMoney('0')).toBe(0);
  });
  it('blocks missing freight but permits explicitly quoted zero freight', () => {
    const p = product();
    delete p.cjPricingReview!.quotes[0].shippingCost;
    expect(cjPricingBlocks(p, now)).not.toHaveLength(0);
    p.cjPricingReview!.quotes[0].shippingCost = 0;
    expect(cjPricingBlocks(p, now)).toEqual([]);
  });
  it('requires every sellable variant to match current quotes', () => {
    const p = product();
    p.variants = [
      {
        id: 'v',
        name: 'Large',
        cjVariantId: 'other',
        cjSku: 'other',
        inStock: true,
        priceAdjustment: 0,
      },
    ];
    expect(cjPricingBlocks(p, now)[0]).toContain('Large');
  });
  it('rejects quotes for another product or stale destination', () => {
    const p = product();
    p.cjPricingReview!.cjProductId = 'other';
    expect(cjPricingBlocks(p, now)).not.toHaveLength(0);
    p.cjPricingReview!.cjProductId = 'pid';
    p.cjPricingReview!.destination = 'CA';
    expect(cjPricingBlocks(p, now)).not.toHaveLength(0);
  });
  it('requires refreshed quotes at publication after 24 hours', () =>
    expect(cjPricingBlocks(product(), now + 86400001)[0]).toContain('24 hours'));
  it('protects the current pricing rule against a low locked price', () => {
    const p = product();
    p.price = 20;
    expect(cjPricingBlocks(p, now)[0]).toContain('retail must be at least');
  });
  it('accepts covered costs and calculates per-variant suggested retail', () => {
    expect(cjPricingBlocks(product(), now)).toEqual([]);
    expect(quoteRetail(product().cjPricingReview!.quotes[0])).toBe(29.99);
  });
});

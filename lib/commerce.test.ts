import { describe, expect, it } from 'vitest';
import {
  allowsChannel,
  blankCommerceDraft,
  checkQuantity,
  listingSnapshot,
  priceFromCost,
  sourceIdentity,
  totalLines,
  houseEstimateFromCost,
  applyHouseEstimates,
} from './commerce';
describe('shared supplier catalog invariants', () => {
  it.each([
    [40, 240],
    [50, 300],
    [50.01, 300],
    [60, 300],
    [75, 337.5],
    [75.01, 337.5],
    [100, 400],
    [174.99, 699.96],
    [175, 700],
    [200, 700],
    [249, 747],
    [250, 750],
    [300, 750],
    [375, 750],
    [400, 800],
    [1000, 2000],
  ])('prices House cost $%s at $%s without tier drops', (cost, price) => {
    expect(houseEstimateFromCost(cost, 1)).toBe(Math.round(price * 100));
  });
  it('never decreases across consecutive cent-denominated costs', () => {
    let previous = 0;
    for (let cost = 1; cost <= 110000; cost++) {
      const next = houseEstimateFromCost(cost / 100, 1);
      if (next < previous) throw new Error(`Price dropped at ${cost} cents`);
      previous = next;
    }
  });
  it('converts cost before choosing a tier, requires known positive costs, and preserves retail', () => {
    expect(houseEstimateFromCost(1000, 0.14)).toBe(56000);
    for (const [cost, rate] of [
      [0, 1],
      [-1, 1],
      [1, 0],
      [NaN, 1],
      [1, Infinity],
    ])
      expect(() => houseEstimateFromCost(cost, rate)).toThrow();
    const draft = blankCommerceDraft();
    draft.variants[0] = { ...draft.variants[0], cost: 1000, retail: 179900 };
    const priced = applyHouseEstimates(draft);
    expect(priced.variants[0].commercial).toBe(200000);
    expect(priced.variants[0].retail).toBe(179900);
    expect(draft.variants[0].commercial).toBe(0);
  });
  it('normalizes Ashcroft collection and product links without changing the variant product', () => {
    expect(
      sourceIdentity(
        'https://www.ashcroftfurniture.com/collections/chairs/products/chair?tracking=1',
        'ashcroft'
      )
    ).toBe(sourceIdentity('https://ashcroftfurniture.com/products/chair', 'ashcroft'));
    expect(() => sourceIdentity('https://evil.test/products/chair', 'ashcroft')).toThrow();
  });
  it('keeps source and fulfillment route separate', () => {
    expect(sourceIdentity('https://detail.1688.com/offer/123.html', 'cj')).not.toBe(
      sourceIdentity('https://detail.1688.com/offer/123.html', 'owner_managed')
    );
    expect(allowsChannel('owner_managed', 'retail')).toBe(false);
  });
  it('calculates markup versus margin without an implicit six-times multiplier', () => {
    expect(priceFromCost(1000, 1, 'markup', 50)).toBe(150000);
    expect(priceFromCost(1000, 1, 'margin', 40)).toBe(166667);
    expect(() => priceFromCost(10, 1, 'margin', 100)).toThrow();
  });
  it('enforces supplier order increments and bounded totals', () => {
    expect(() => checkQuantity(3, { minimum: 2, increment: 2 })).toThrow();
    expect(totalLines([{ quantity: 15, unitPrice: 10000 }], 5000, 0)).toBe(155000);
  });
  it('projects approved customer fields with independent prices, never supplier evidence', () => {
    const d = {
      ...blankCommerceDraft(),
      name: 'Chair',
      description: 'Chair description',
      category: 'Chairs',
      factsApproved: true,
      imagesApproved: true,
      images: ['https://example.com/image.jpg'],
      supplierContact: 'private',
      variants: [
        { ...blankCommerceDraft().variants[0], cost: 100, retail: 25000, commercial: 20000 },
      ],
    };
    const retail = listingSnapshot(d, 'ashcroft', 'retail');
    expect(retail.variants[0].price).toBe(25000);
    expect(listingSnapshot(d, 'ashcroft', 'house').variants[0].price).toBe(20000);
    expect(retail).not.toHaveProperty('supplierContact');
    expect(retail.variants[0]).not.toHaveProperty('cost');
    expect(() => listingSnapshot(d, 'owner_managed', 'retail')).toThrow();
    expect(() =>
      listingSnapshot({ ...d, conflicts: ['orientation'] }, 'ashcroft', 'house')
    ).toThrow();
  });
});

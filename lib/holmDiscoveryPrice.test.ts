import { expect, it } from 'vitest';
import { representativeDiscoveryVariant } from './holmDiscoveryPrice';
it('uses current authorized prices, excludes absent channels and breaks equal-price ties by variant identity', () => {
  const variants = [{ id: 'b', retail: 1000, trade: null }, { id: 'a', retail: 1000, trade: 800 }, { id: 'c', retail: 2000, trade: 700 }];
  expect(representativeDiscoveryVariant(variants, 'retail')?.id).toBe('a');
  expect(representativeDiscoveryVariant(variants, 'trade')?.id).toBe('c');
  expect(representativeDiscoveryVariant([...variants].reverse(), 'retail')?.id).toBe('a');
  expect(representativeDiscoveryVariant(variants.map(v => ({ ...v, trade: null })), 'trade')).toBeNull();
  expect(representativeDiscoveryVariant([{ id: 'bad', retail: NaN, trade: -1 }], 'retail')).toBeNull();
});
it('produces exact ascending and descending product price order across variant pages after withdrawal', () => {
  const products = [
    { id: 'sofa', variants: [{ id: 'low', retail: 1000, trade: 900 }, { id: 'high', retail: 9000, trade: 8100 }] },
    { id: 'chair', variants: [{ id: 'a', retail: 2000, trade: 1800 }, { id: 'b', retail: 2000, trade: 1800 }] },
    { id: 'desk', variants: [{ id: 'a', retail: 5000, trade: 4500 }] },
  ];
  // Candidate rows retain unavailable prices; authoritative variants change.
  const rows = products.flatMap(p => p.variants.map(v => ({ product: p.id, variant: v.id, price: v.retail })));
  products[0].variants.shift();
  for (const direction of [1, -1]) {
    const ordered = [...rows].sort((a, b) => direction * (a.price - b.price) || a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant));
    const accepted = [];
    for (const row of ordered) {
      const product = products.find(p => p.id === row.product)!;
      const selected = representativeDiscoveryVariant(product.variants, 'retail');
      if (selected?.id === row.variant && selected.retail === row.price) accepted.push(row.product);
    }
    expect(accepted).toEqual(direction === 1 ? ['chair', 'desk', 'sofa'] : ['sofa', 'desk', 'chair']);
  }
});

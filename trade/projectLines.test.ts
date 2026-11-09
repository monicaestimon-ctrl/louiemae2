import { describe, expect, it } from 'vitest';
import type { HolmProduct } from './catalog';
import { projectLines } from './projectLines';

const product = { id: 1, lid: 'product-a', vid: 'variant-a', name: 'Chair', minimum: 2, increment: 2, oos: false } as HolmProduct;
const products = new Map([[1, product]]);
describe('project checkout identity and quantities', () => {
  it('keeps unavailable saved items as blocking errors instead of substituting a product', () => {
    const result = projectLines([{ pid: 99, qty: 2 }, { pid: 1, qty: 2 }], products);
    expect(result.errors).toHaveLength(1);
    expect(result.lines).toEqual([{ productId: 'product-a', variantId: 'variant-a', packs: 2 }]);
  });
  it('combines the same variant across rooms without dropping quantity', () => {
    expect(projectLines([{ pid: 1, qty: 2 }, { pid: 1, qty: 4 }], products)).toEqual({
      errors: [], lines: [{ productId: 'product-a', variantId: 'variant-a', packs: 6 }],
    });
  });
  it.each([0, 1, 3, 2.5, Infinity, NaN, 10002])('blocks invalid pack quantity %s', qty => {
    expect(projectLines([{ pid: 1, qty }], products).errors.length).toBeGreaterThan(0);
  });
  it('blocks an unavailable product', () => {
    expect(projectLines([{ pid: 1, qty: 2 }], new Map([[1, { ...product, oos: true }]] )).errors).toHaveLength(1);
  });
  it('does not substitute a new default variant for a saved selection', () => {
    expect(projectLines([{ pid: 1, vid: 'retired-variant', qty: 2 }], products).errors).toHaveLength(1);
  });
});

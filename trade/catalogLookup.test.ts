import { expect, it } from 'vitest';
import { displayProduct } from './catalogLookup';
import type { HolmProduct } from './catalog';

it('does not substitute the first available product for a missing saved identity', () => {
  const first = { id: 1, lid: 'available', price: 200, img: '/real.webp' } as HolmProduct;
  const products = new Map([[1, first]]);
  expect(displayProduct(products, 1)).toBe(first);
  const missing = displayProduct(products, 999);
  expect(missing.id).toBe(999);
  expect(missing.lid).toBe('');
  expect(missing.variants).toEqual([]);
  expect(missing.oos).toBe(true);
  expect(Number.isFinite(missing.price)).toBe(false);
  expect(missing.dimsCm).toBeNull();
  expect(missing.model).toBeNull();
  expect(products.has(999)).toBe(false);
});

import { describe, expect, it } from 'vitest';
import { blankFurniture, estimate, publicFurniture, validateFurniture } from './furniture';
describe('furniture estimates and publishing boundaries', () => {
  it('uses the requested range in USD and converts source currency first', () => {
    expect(estimate(100, 1)).toEqual({ lower: 500, upper: 600 });
    expect(estimate(1000, 0.14)).toEqual({ lower: 740, upper: 840 });
  });
  it('blocks publishing without image rights and positive variant estimates', () => {
    const p = {
      ...blankFurniture(),
      name: 'Chair',
      description: 'Walnut chair',
      images: ['https://example.com/chair.jpg'],
      published: true,
      variants: [{ id: 'a', name: 'Walnut', cost: 100, minimum: 1 }],
    };
    expect(() => validateFurniture(p)).toThrow('permission');
    expect(() => validateFurniture({ ...p, imagePermission: true })).not.toThrow();
    expect(() =>
      validateFurniture({
        ...p,
        imagePermission: true,
        variants: [{ id: 'a', name: 'Walnut', cost: 1, minimum: 1 }],
      })
    ).toThrow('positive');
  });
  it('never serializes source pricing or supplier data for public browsing', () => {
    const p = {
      ...blankFurniture(),
      _id: 'id',
      name: 'Chair',
      supplierName: 'private factory',
      supplierContact: 'private@example.com',
      packaging: 'private crate',
      sourceUrl: 'https://private.example.com',
      variants: [{ id: 'a', name: 'Walnut', cost: 100, minimum: 2 }],
    };
    const result = publicFurniture(p);
    expect(result.variants[0]).toEqual({
      id: 'a',
      name: 'Walnut',
      minimum: 2,
      lower: 500,
      upper: 600,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|cost|usdRate|supplier|sourceUrl/);
  });
});

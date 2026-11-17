import { expect, it } from 'vitest';
import { liveProducts, type LiveItem } from './catalog';
import { CURATED_SOURCES } from './curatedSources';

const source = (id: number) => Object.keys(CURATED_SOURCES).find(key => CURATED_SOURCES[key] === id)!;
const item = (id: string, name: string): LiveItem => ({
  id, name, description: '', category: 'sectionals', images: ['/fixture.webp'], facts: '', inStock: true,
  variants: [{ id: 'variant', name: 'Default', minimum: 1, increment: 1, retail: 10000, trade: null }],
});

it('keeps curated identities and assets stable across pages, ordering and renames', () => {
  const left = item(source(5), 'Osborne Left Facing');
  const right = item(source(6), 'Osborne Right Facing');
  const identity = (rows: LiveItem[]) => liveProducts(rows).map(p => [p.lid, p.id, p.cutout]);
  expect(identity([right, left])).toEqual(identity([left, right]));
  expect(identity([right])).toEqual([[right.id, 6, 'c/6.webp']]);
  expect(identity([{ ...left, name: 'A renamed sectional' }])).toEqual([[left.id, 5, 'c/5.webp']]);
});

it('does not give a same-named new product another product’s studio assets', () => {
  const mapped = liveProducts([item('new-product', 'Osborne Velvet Sectional Left Facing')])[0];
  expect(mapped.id).toBeGreaterThanOrEqual(1000);
  expect(mapped.cutout).toBeNull();
  expect(mapped.model).toBeNull();
  expect(mapped.dimsCm).toBeNull();
});

it('fails closed on duplicate identities and real numeric hash collisions', () => {
  const first = item('fixture-6678', 'First');
  const second = item('fixture-17986', 'Second');
  expect(liveProducts([first])[0].id).toBe(liveProducts([second])[0].id);
  expect(() => liveProducts([first, second])).toThrow('Catalog product identities require review');
  expect(() => liveProducts([first, first])).toThrow('Catalog product identities require review');
});

it('retains noncurated numeric IDs when unrelated rows or prices change', () => {
  const saved = item('existing-source', 'Original');
  const original = liveProducts([saved])[0];
  const changed = liveProducts([item(source(1), 'Bramwell'), { ...saved, name: 'New name', variants: [{ ...saved.variants[0], retail: 20000 }] }]).find(p => p.lid === saved.id)!;
  expect(changed.id).toBe(original.id);
  expect(changed.price).toBe(200);
  expect(changed.trade).toBeNull();
});

import { expect, it } from 'vitest';
import type { HolmProduct } from './catalog';
import { mergeProjectItem, projectItemKey, resolveProjectItems, resolveProjectProduct, sameProjectSelection, sameSavedRow, restoreProjectItem } from './projectIdentity';
import { projectLines } from './projectLines';

const product = {
  id: 1, lid: 'product-a', vid: 'new-default', name: 'Chair', price: 120,
  trade: 100, minimum: 1, increment: 1, oos: false,
  variants: [{ id: 'saved-option', name: 'Walnut', retail: 14000, trade: 11000, minimum: 2, increment: 2 }],
} as HolmProduct;
const products = new Map([[1, product]]);

it('targets an unavailable source row without removing the compatible legacy row or another room', () => {
  const removed = { pid: 1, lid: 'old-source', vid: 'v', zone: 'Room', qty: 2 };
  const legacy = { pid: 1, vid: 'v', zone: 'Room', qty: 3 };
  const otherRoom = { ...removed, zone: 'Office' };
  expect([removed, legacy, otherRoom].filter(row => !sameSavedRow(row, removed))).toEqual([legacy, otherRoom]);
  expect(sameProjectSelection(removed, legacy)).toBe(true);
});

it('undo restores quantity to the original project after switching and never recreates deleted projects', () => {
  const item = { pid: 1, lid: 'a', vid: 'v', zone: 'Room', qty: 2 };
  const projects = [{ id: 'A', items: [{ ...item, qty: 1 }] }, { id: 'B', items: [{ ...item, qty: 4 }] }];
  expect(restoreProjectItem(projects, 'A', item).map(p => p.items[0].qty)).toEqual([3, 4]);
  expect(restoreProjectItem(projects.slice(1), 'A', item)).toEqual(projects.slice(1));
  expect(projects.map(p => p.items[0].qty)).toEqual([1, 4]);
});

it('preserves a saved non-default option with its current price and pack rules', () => {
  const item = { pid: 1, lid: 'product-a', vid: 'saved-option', qty: 2 };
  expect(resolveProjectProduct(item, products)).toMatchObject({ vid: 'saved-option', price: 140, trade: 110, minimum: 2 });
  expect(projectLines([item], products)).toEqual({ errors: [], lines: [{ productId: 'product-a', variantId: 'saved-option', packs: 2 }] });
  expect(projectLines([{ ...item, qty: 1 }], products).errors).toHaveLength(1);
});

it('blocks a numeric-ID collision instead of switching supplier product identity', () => {
  expect(resolveProjectProduct({ pid: 1, lid: 'different-product', vid: 'new-default' }, products)).toBeNull();
});

it('retains missing rows without mutating or dropping the saved draft', () => {
  const items = [{ pid: 99, lid: 'not-loaded', qty: 4 }, { pid: 1, vid: 'deleted-option', qty: 2 }];
  const before = globalThis.structuredClone(items);
  expect(resolveProjectItems(items, products)).toEqual({ resolved: [], missing: before });
  expect(items).toEqual(before);
  expect(projectLines(items, products).lines).toEqual([]);
});

it('keeps different variants and ambiguous concatenated IDs separate', () => {
  expect(sameProjectSelection({ pid: 1, vid: 'a' }, { pid: 1, vid: 'b' })).toBe(false);
  expect(projectItemKey({ pid: 1, zone: '23' })).not.toBe(projectItemKey({ pid: 12, zone: '3' }));
});

it('restores quantities into the same option and room without overwriting another option', () => {
  const items = [{ pid: 1, vid: 'a', qty: 2, zone: 'Room' }, { pid: 1, vid: 'b', qty: 4, zone: 'Room' }];
  const merged = mergeProjectItem(items, { pid: 1, vid: 'a', qty: 3, zone: 'Room' });
  expect(merged.map(item => item.qty)).toEqual([5, 4]);
  expect(items.map(item => item.qty)).toEqual([2, 4]);
});

import { expect, it } from 'vitest';
import { unresolvedPlannerItems } from './plannerDraft';
import type { HolmProduct } from './catalog';
it('requires review for missing or conflicting sources without changing layout data', () => {
  const items = [{ pid: 1, lid: 'wrong', x: 5, z: 2 }, { pid: 99, x: -4, z: 1 }, { pid: 1, lid: 'current', x: 3, z: 0 }];
  const before = globalThis.structuredClone(items);
  const products = new Map([[1, { id: 1, lid: 'current' } as HolmProduct]]);
  expect(unresolvedPlannerItems(items, products).map(row => row.index)).toEqual([0, 1]);
  expect(items).toEqual(before);
});

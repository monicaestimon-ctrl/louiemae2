import { expect, it } from 'vitest';
import type { HolmProduct } from './catalog';
import { editorSelections, reconcileEditorSelections } from './editorSelections';
import { projectItemKey } from './projectIdentity';
const product = { id: 1, lid: 'source', vid: 'oak', price: 100, trade: 90, variants: [{ id: 'walnut', name: 'Walnut', retail: 20000, trade: 18000, minimum: 2, increment: 2 }] } as HolmProduct;
it('groups repeated copies by exact source/option and visibility without changing layout records', () => {
  const items = [{ pid: 1, lid: 'source', vid: 'oak' }, { pid: 1, lid: 'source', vid: 'walnut' }, { pid: 1, lid: 'source', vid: 'oak' }, { pid: 1, lid: 'source', vid: 'oak', hidden: true }];
  const rows = editorSelections(items, new Map([[1, product]]));
  expect(rows.map(row => [row.vid, row.qty, row.hidden, row.product?.price])).toEqual([['oak',2,false,100],['walnut',1,false,200],['oak',1,true,100]]);
  expect(new Set(rows.map(row=>row.key)).size).toBe(3);
  expect(items).toHaveLength(4);
});
it('preserves unresolved and conflicting selections instead of substituting a visible product', () => {
  const legacy = { pid: 1 };
  const products = Object.assign(new Map([[1, product]]), { blockedSavedIdentities: new Set([projectItemKey(legacy)]) });
  const rows = editorSelections([legacy, { pid: 1, lid: 'other' }, { pid: 1, lid: 'source', vid: 'removed' }, { pid: 1, lid: 'source', vid: 'oak' }], products);
  expect(rows.map(row=>!!row.product)).toEqual([false,false,false,true]);
});

it('synchronizes copies without moving or replacing the other option', () => {
  const oak = { pid: 1, lid: 'source', vid: 'oak' }, walnut = { ...oak, vid: 'walnut' };
  const result = reconcileEditorSelections([oak, walnut, oak], [walnut, oak, walnut]);
  expect([...result.keep]).toEqual([0, 1]);
  expect(result.add).toEqual([walnut]);
  expect(reconcileEditorSelections([oak], [{ ...oak, lid: 'different' }]).keep.size).toBe(0);
});

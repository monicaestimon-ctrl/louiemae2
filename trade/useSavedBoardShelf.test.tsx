import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { holmLegacyId } from '../lib/holmProductIdentity';
import type { HolmProduct } from './catalog';
import { useSavedBoardShelf } from './useSavedBoardShelf';
const responses = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('convex/react', () => ({ useQueries: () => responses.value }));

it('resolves distinct saved options, deduplicates identical pins and retains unavailable references', () => {
  const source = 'saved-source', pid = holmLegacyId(source);
  const oak = { pid, lid: source, vid: 'oak' }, walnut = { ...oak, vid: 'walnut' };
  const boards = [{ pins: [oak, walnut] }, { pins: [oak] }];
  const collages = [{ els: [{ kind: 'img', ...oak }] }];
  const catalog = new Map<number, HolmProduct>();
  const view = renderHook(() => useSavedBoardShelf(boards, collages, catalog));
  expect(view.result.current.allPins).toEqual([]);
  expect(view.result.current.reviewCount).toBe(4);
  const item = { id: source, name: 'Saved Chair', description: '', category: 'Chairs', images: [], facts: '', inStock: true,
    variants: [{ id: 'walnut', name: 'Walnut', minimum: 1, increment: 1, retail: 20000, trade: 16000 },
      { id: 'oak', name: 'Oak', minimum: 2, increment: 2, retail: 10000, trade: 8000 }] };
  responses.value = { 'source:0': [{ productId: source, item }] }; view.rerender();
  expect(view.result.current.allPins.map(product => [product.vid, product.trade, product.minimum])).toEqual([
    ['oak', 80, 2], ['walnut', 160, 1],
  ]);
  expect(view.result.current.reviewCount).toBe(0);
  responses.value = { 'source:0': [{ productId: source, item: { ...item, variants: [item.variants[0]] } }] }; view.rerender();
  expect(view.result.current.productFor(oak)).toBeNull();
  expect(view.result.current.allPins.map(product => product.vid)).toEqual(['walnut']);
  expect(view.result.current.reviewCount).toBe(3);
  expect(boards[0].pins).toEqual([oak, walnut]);
  expect(catalog.size).toBe(0);
});

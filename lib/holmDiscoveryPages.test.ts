import { expect, it } from 'vitest';
import { discoveryPageChain } from './holmDiscoveryPages';
const page = (items: string[], nextCursor: string | null, refreshAfterMs = 30000) => ({ ready: true, items, nextCursor, refreshAfterMs });
it('drops stale suffixes immediately when live updates move a page boundary', () => {
  expect(discoveryPageChain([null, 'old'], [page(['current'], 'new'), page(['stale'], null)]))
    .toMatchObject({ items: ['current'], accepted: 1, nextCursor: 'new', pending: false });
  expect(discoveryPageChain([null, 'old'], [page([], null), page(['stale'], null)]).items).toEqual([]);
});
it('preserves empty continuations and waits for contiguous pages', () => {
  expect(discoveryPageChain([null, 'next'], [page([], 'next'), undefined]))
    .toMatchObject({ items: [], accepted: 1, nextCursor: 'next', pending: true });
  expect(discoveryPageChain([null, 'next'], [undefined, page(['late'], null)]).items).toEqual([]);
  expect(discoveryPageChain([null, 'next'], [page([], 'next'), page(['found'], null, 800)]))
    .toMatchObject({ items: ['found'], accepted: 2, nextCursor: null, refreshAfterMs: 800 });
});
it('fails closed for errors, withdrawn readiness and cyclic continuations', () => {
  expect(discoveryPageChain([null, 'next'], [page(['first'], 'next'), new Error('Access changed')]).items).toEqual([]);
  expect(discoveryPageChain([null], [{ ...page(['first'], null), ready: false }]).unavailable).toBe(true);
  expect(discoveryPageChain([null, 'next'], [page(['first'], 'next'), page(['second'], 'next')]).error).toBeInstanceOf(Error);
});

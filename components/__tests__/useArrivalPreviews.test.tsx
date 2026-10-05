import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { useArrivalPreviews, useCollectionArrivalPreview, useDropPreviews, useCollectionDropPreview } from '../useArrivalPreviews';

const mocks = vi.hoisted(() => ({ ready: undefined as unknown, query: vi.fn(), pages: vi.fn(),
  dated: { results: [] as unknown[], status: 'LoadingFirstPage', loadMore: vi.fn() },
  legacy: { results: [] as unknown[], status: 'LoadingFirstPage', loadMore: vi.fn() } }));
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => { mocks.query(...args); return mocks.ready; },
  usePaginatedQuery: (...args: unknown[]) => {
    mocks.pages(...args);
    return (args[1] as { kind?: string })?.kind === 'legacy' ? mocks.legacy : mocks.dated;
  },
}));
const row = (id: string) => ({ _id: id, name: id, price: 20, images: ['image'], category: 'chair', collection: 'furniture', descriptionExcerpt: 'not a full description' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = undefined;
  mocks.dated.results = []; mocks.dated.status = 'LoadingFirstPage';
  mocks.legacy.results = []; mocks.legacy.status = 'LoadingFirstPage';
});

it('skips unavailable catalogs, exposes loading separately, and keeps one cutoff across rerenders', () => {
  const time = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const view = renderHook(() => useArrivalPreviews());
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.unavailable).toBe(false);
  expect(mocks.pages.mock.calls.every(call => call[1] === 'skip')).toBe(true);
  mocks.ready = { ready: false }; view.rerender();
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.unavailable).toBe(true);
  mocks.ready = { ready: true }; view.rerender();
  const first = mocks.pages.mock.calls.filter(call => call[1] !== 'skip').map(call => call[1]);
  expect(first.map(args => args.collection)).toEqual(['fashion', 'kids', 'furniture', 'decor']);
  const cutoff = first[0].since;
  time.mockReturnValue(1_900_000_000_000); view.rerender();
  expect(mocks.pages.mock.calls.filter(call => call[1] !== 'skip').every(call => call[1].since === cutoff)).toBe(true);
  expect(getFunctionName(mocks.query.mock.calls[0][0])).toBe('catalogReadiness:status');
  expect(mocks.pages.mock.calls.every(call => getFunctionName(call[0]) === 'catalog:arrivalsPage')).toBe(true);
  time.mockRestore();
});

it('continues empty dated pages and loads legacy rows only after exhausting dated results', () => {
  mocks.dated.status = 'CanLoadMore';
  const view = renderHook(() => useCollectionArrivalPreview('furniture', 1, true));
  expect(mocks.dated.loadMore).toHaveBeenCalledWith(12);
  expect(mocks.pages.mock.calls[1][1]).toBe('skip');
  expect(view.result.current.loading).toBe(true);
  mocks.dated.results = [row('dated')]; mocks.dated.status = 'Exhausted';
  mocks.legacy.status = 'CanLoadMore'; view.rerender();
  expect(mocks.pages.mock.lastCall?.[1]).toEqual({ collection: 'furniture', since: 1, kind: 'legacy' });
  expect(mocks.legacy.loadMore).toHaveBeenCalledWith(11);
  mocks.legacy.results = [row('legacy')]; mocks.legacy.status = 'Exhausted'; view.rerender();
  expect(view.result.current.products.map(product => product.id)).toEqual(['dated', 'legacy']);
  expect(view.result.current.products[0]).not.toHaveProperty('description');
  expect(view.result.current.loading).toBe(false);
});

it('caps previews at twelve and responds to live removal or readiness loss without stale legacy rows', () => {
  mocks.dated.results = Array.from({ length: 13 }, (_, i) => row(`dated-${i}`));
  mocks.dated.status = 'CanLoadMore';
  const view = renderHook(({ ready }) => useCollectionArrivalPreview('furniture', 1, ready), { initialProps: { ready: true } });
  expect(view.result.current.products).toHaveLength(12);
  expect(view.result.current.loading).toBe(false);
  expect(mocks.dated.loadMore).not.toHaveBeenCalled();
  mocks.dated.results = [row('remaining')]; view.rerender({ ready: true });
  expect(mocks.dated.loadMore).toHaveBeenCalledWith(11);
  expect(view.result.current.loading).toBe(true);
  mocks.legacy.results = [row('stale-legacy')];
  expect(view.result.current.products.map(product => product.id)).toEqual(['remaining']);
  view.rerender({ ready: false });
  expect(view.result.current.products).toEqual([]);
  expect(view.result.current.loading).toBe(false);
});

it('loads collection drop previews independently and skips unavailable catalogs', () => {
  const view = renderHook(() => useDropPreviews());
  expect(view.result.current.loading).toBe(true);
  expect(mocks.pages.mock.calls.every(call => call[1] === 'skip')).toBe(true);
  mocks.ready = { ready: true }; view.rerender();
  expect(mocks.pages.mock.calls.slice(-4).map(call => call[1].collection)).toEqual(['fashion', 'kids', 'furniture', 'decor']);
  expect(mocks.pages.mock.calls.every(call => getFunctionName(call[0]) === 'catalog:dropPage')).toBe(true);
  mocks.ready = { ready: false }; view.rerender();
  expect(view.result.current.unavailable).toBe(true);
  expect(view.result.current.loading).toBe(false);
});

it('fills short drop pages up to four, preserving backend publication order and reacting to updates', () => {
  mocks.dated.status = 'CanLoadMore';
  const view = renderHook(() => useCollectionDropPreview('furniture', true));
  expect(mocks.dated.loadMore).toHaveBeenCalledWith(4);
  mocks.dated.results = [row('published')]; view.rerender();
  expect(mocks.dated.loadMore).toHaveBeenLastCalledWith(3);
  mocks.dated.results = [row('published'), row('older'), row('legacy-new'), row('plain'), row('extra')]; view.rerender();
  expect(view.result.current.products.map(product => product.id)).toEqual(['published', 'older', 'legacy-new', 'plain']);
  expect(view.result.current.loading).toBe(false);
  mocks.dated.results = []; mocks.dated.status = 'Exhausted'; view.rerender();
  expect(view.result.current.products).toEqual([]);
  expect(view.result.current.loading).toBe(false);
});

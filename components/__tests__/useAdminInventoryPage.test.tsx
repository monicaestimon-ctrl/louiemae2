import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { useAdminInventoryPage } from '../useAdminInventoryPage';
const mocks = vi.hoisted(() => ({ ready: undefined as unknown, query: vi.fn(), pages: vi.fn(),
  page: { results: [] as unknown[], status: 'LoadingFirstPage', loadMore: vi.fn() } }));
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => { mocks.query(...args); return mocks.ready; },
  usePaginatedQuery: (...args: unknown[]) => { mocks.pages(...args); return mocks.page; },
}));
const filters = { collection: 'all', category: null, search: '', connection: 'all' as const, collections: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.ready = undefined; mocks.page.results = []; mocks.page.status = 'LoadingFirstPage'; });

it('skips inactive or unverified readers without treating them as exhausted empty inventory', () => {
  const view = renderHook(({ active }) => useAdminInventoryPage(active, filters), { initialProps: { active: false } });
  expect(mocks.query.mock.lastCall?.[1]).toBe('skip');
  expect(mocks.pages.mock.lastCall?.[1]).toBe('skip');
  expect(view.result.current.complete).toBe(false);
  view.rerender({ active: true }); expect(view.result.current.loading).toBe(true);
  mocks.ready = { ready: false }; view.rerender({ active: true });
  expect(view.result.current.unavailable).toBe(true);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.complete).toBe(false);
});

it('keeps continuation available for empty filtered pages and distinguishes exhaustion', () => {
  mocks.ready = { ready: true }; mocks.page.status = 'CanLoadMore';
  const view = renderHook(() => useAdminInventoryPage(true, filters));
  expect(view.result.current.products).toEqual([]);
  expect(view.result.current.canLoadMore).toBe(true);
  expect(view.result.current.complete).toBe(false);
  act(() => view.result.current.loadMore()); expect(mocks.page.loadMore).toHaveBeenCalledWith(25);
  mocks.page.status = 'LoadingMore'; view.rerender(); expect(view.result.current.loadingMore).toBe(true);
  mocks.page.status = 'Exhausted'; view.rerender(); expect(view.result.current.complete).toBe(true);
});

it('sends authoritative search/status filters and preserves full counts without inventing a full product', () => {
  mocks.ready = { ready: true }; mocks.page.status = 'Exhausted';
  mocks.page.results = [{ _id: 'outside-old-cap', name: 'Chair', variantCount: 150, imageCount: 40,
    variantImageCount: 125, connectionStatus: { state: 'ready' } }];
  const view = renderHook(() => useAdminInventoryPage(true, { ...filters, collection: 'furniture', category: 'chairs', search: ' LATE FIELD ', connection: 'ready' }));
  expect(getFunctionName(mocks.pages.mock.lastCall?.[0])).toBe('catalog:adminPage');
  expect(mocks.pages.mock.lastCall?.[1]).toMatchObject({ collection: 'furniture', adminSearch: 'late field', connectionState: 'ready', categoryFilter: { requested: 'chairs', hierarchy: false } });
  expect(view.result.current.products[0]).toMatchObject({ id: 'outside-old-cap', variantCount: 150, imageCount: 40, variantImageCount: 125 });
  expect(view.result.current.products[0]).not.toHaveProperty('description');
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoreCatalog, useStoreCategoryOptions } from '../useStoreCatalog';
import type { CollectionConfig } from '../../types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), loadMore: vi.fn(), rows: [] as unknown[], status: 'LoadingFirstPage' }));
vi.mock('convex/react', () => ({ usePaginatedQuery: (...args: unknown[]) => {
  mocks.query(...args); return { results: mocks.rows, status: mocks.status, loadMore: mocks.loadMore };
} }));
const config: CollectionConfig = { id: 'kids', title: 'Kids', subtitle: '', heroImage: '', subcategories: [
  { id: 'girls', title: 'Girls', image: '', isMainCategory: true },
  { id: 'dresses', title: 'Dresses', image: '', parentCategory: 'Girls' },
] };
const row = (id: string) => ({ _id: id, name: id, images: ['image'], price: 12, category: 'Dresses', isNew: true, variantCount: 150, variants: [{ id: 'partial' }] });
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.status = 'LoadingFirstPage'; });

describe('bounded store readers', () => {
  it('skips inactive readers and forwards exact hierarchical filters and server sorting', () => {
    const view = renderHook(({ ready }) => useStoreCatalog(config, 'Girls', ready, 'price-asc'), { initialProps: { ready: false } });
    expect(mocks.query.mock.lastCall?.[1]).toBe('skip');
    view.rerender({ ready: true });
    expect(mocks.query.mock.lastCall?.[1]).toMatchObject({ collection: 'kids', sort: 'price-asc', categoryFilter: { hierarchy: true, descendantIds: ['girls', 'dresses'] } });
    expect(mocks.query.mock.lastCall?.[2]).toEqual({ initialNumItems: 25 });
    expect(view.result.current.loading).toBe(true);
  });
  it('keeps empty filtered pages incomplete, only advances grids on demand and preserves full variant counts', () => {
    mocks.status = 'CanLoadMore';
    const view = renderHook(() => useStoreCatalog(config, 'All', true, 'newest'));
    expect(view.result.current.complete).toBe(false);
    expect(mocks.loadMore).not.toHaveBeenCalled();
    view.result.current.loadMore(); expect(mocks.loadMore).toHaveBeenCalledWith(25);
    mocks.rows = [row('later-than-500')]; mocks.status = 'Exhausted'; view.rerender();
    expect(view.result.current.products[0]).toMatchObject({ id: 'later-than-500', variantCount: 150 });
    expect(view.result.current.products[0]).not.toHaveProperty('variants');
    expect(view.result.current.complete).toBe(true);
  });
  it('fills short previews, stops at the requested size and clears stale rows when disabled', () => {
    mocks.status = 'CanLoadMore';
    const view = renderHook(({ ready }) => useStoreCatalog(config, 'Girls', ready, 'featured', 4), { initialProps: { ready: true } });
    expect(mocks.loadMore).toHaveBeenLastCalledWith(4);
    mocks.rows = [row('one')]; view.rerender({ ready: true });
    expect(mocks.loadMore).toHaveBeenLastCalledWith(3);
    mocks.loadMore.mockClear(); mocks.rows = Array.from({ length: 6 }, (_, i) => row(String(i))); view.rerender({ ready: true });
    expect(view.result.current.products).toHaveLength(4); expect(mocks.loadMore).not.toHaveBeenCalled();
    view.rerender({ ready: false }); expect(view.result.current.products).toEqual([]);
  });
  it('unions configured, selected and paginated legacy categories without scanning all pages automatically', () => {
    mocks.rows = ['Vintage', 'Dresses', 'Vintage']; mocks.status = 'CanLoadMore';
    const view = renderHook(() => useStoreCategoryOptions(config, 'Saved category', true));
    expect(view.result.current.categories).toEqual(['All', 'Dresses', 'Girls', 'Saved category', 'Vintage']);
    expect(mocks.loadMore).not.toHaveBeenCalled();
    view.result.current.loadMore(); expect(mocks.loadMore).toHaveBeenCalledWith(25);
    mocks.rows = [...mocks.rows, 'Late legacy']; mocks.status = 'Exhausted'; view.rerender();
    expect(view.result.current.categories).toContain('Late legacy'); expect(view.result.current.canLoadMore).toBe(false);
  });
});

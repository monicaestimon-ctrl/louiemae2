import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorefrontProductDetail } from '../useStorefrontProductDetail';
const mocks = vi.hoisted(() => ({ result: undefined as unknown, query: vi.fn() }));
vi.mock('convex/react', () => ({ useQueries: (queries: unknown) => { mocks.query(queries); return { result: mocks.result }; } }));
beforeEach(() => { vi.clearAllMocks(); mocks.result = undefined; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('selected storefront detail', () => {
  it('distinguishes transport failure from a missing product and recovers without a stale purchase button', () => {
    mocks.result = new Error('private supplier diagnostic');
    const view = renderHook(() => useStorefrontProductDetail('selected'));
    expect(view.result.current).toMatchObject({ product: null, loading: false, unavailable: false, failed: true });
    mocks.result = undefined; view.rerender();
    act(() => vi.advanceTimersByTime(10_000));
    expect(view.result.current.failed).toBe(true);
    act(() => view.result.current.retry());
    expect(view.result.current.loading).toBe(true);
    mocks.result = { _id: 'selected', name: 'Verified chair', price: 420 }; view.rerender();
    expect(view.result.current.product?.name).toBe('Verified chair');
    expect(view.result.current.failed).toBe(false);
  });
  it('skips unopened details and distinguishes loading and unavailable products', () => {
    const view = renderHook(({ id }: { id?: string }) => useStorefrontProductDetail(id), { initialProps: { id: undefined as string | undefined } });
    expect(mocks.query.mock.lastCall?.[0]).toEqual({});
    expect(view.result.current).toMatchObject({ product: null, loading: false, unavailable: false });
    view.rerender({ id: 'selected' });
    expect(view.result.current.loading).toBe(true);
    mocks.result = null; view.rerender({ id: 'selected' });
    expect(view.result.current).toMatchObject({ product: null, loading: false, unavailable: true });
  });
  it('preserves full fields, reacts to updates and clears detail on close or selection changes', () => {
    mocks.result = { _id: 'first', name: 'Original', price: 10, description: 'x'.repeat(4000),
      variants: Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, name: `${i}`, inStock: true, priceAdjustment: i })) };
    const view = renderHook(({ id }: { id?: string }) => useStorefrontProductDetail(id), { initialProps: { id: 'first' as string | undefined } });
    expect(view.result.current.product?.variants).toHaveLength(150);
    expect(view.result.current.product?.description).toHaveLength(4000);
    mocks.result = { _id: 'first', name: 'Changed', price: 20, variants: [] };
    view.rerender({ id: 'first' });
    expect(view.result.current.product?.price).toBe(20);
    view.rerender({ id: undefined });
    expect(view.result.current.product).toBeNull();
    view.rerender({ id: 'second' });
    expect(view.result.current.product).toBeNull();
    expect(view.result.current.loading).toBe(true);
    mocks.result = undefined; view.rerender({ id: 'second' });
    expect(view.result.current.product).toBeNull();
    expect(view.result.current.loading).toBe(true);
  });
});

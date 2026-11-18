import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKidsRootPreview } from '../useKidsRootPreview';
const transport = vi.hoisted(() => ({ value: undefined as unknown, queries: vi.fn() }));
vi.mock('convex/react', () => ({ useQueries: (queries: object) => {
  transport.queries(queries);
  return Object.keys(queries).length ? { result: transport.value } : {};
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); transport.value = undefined; vi.clearAllMocks(); });
it('times out without false emptiness and recovers on a verified live response', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ enabled }) => useKidsRootPreview(enabled), { initialProps: { enabled: true } });
  expect(result.current).toEqual({ products: [], loading: true, unavailable: false });
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current).toEqual({ products: [], loading: false, unavailable: true });
  transport.value = { ready: true, version: 5, products: [] };
  rerender({ enabled: true });
  expect(result.current).toEqual({ products: [], loading: false, unavailable: false });
  transport.value = new Error('Offline');
  rerender({ enabled: true });
  expect(result.current.unavailable).toBe(true);
  rerender({ enabled: false });
  expect(result.current).toEqual({ products: [], loading: false, unavailable: false });
  expect(transport.queries).toHaveBeenLastCalledWith({});
});
it('preserves compact metadata without treating preview stock as purchase permission', () => {
  transport.value = { ready: true, version: 5, products: [{ _id: 'dress', name: 'Dress', images: ['one'], price: 32, category: 'Dresses', variantCount: 150 }] };
  const { result, rerender } = renderHook(({ enabled }) => useKidsRootPreview(enabled), { initialProps: { enabled: true } });
  expect(result.current.products[0]).toMatchObject({ id: 'dress', inStock: false, variantCount: 150, images: ['one'] });
  transport.value = { ready: false, version: 5, products: [] };
  rerender({ enabled: true });
  expect(result.current).toEqual({ products: [], loading: false, unavailable: true });
  rerender({ enabled: false });
  expect(result.current.unavailable).toBe(false);
});

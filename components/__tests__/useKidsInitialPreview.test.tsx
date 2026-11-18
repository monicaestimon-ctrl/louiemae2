import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKidsRootPreview } from '../useKidsRootPreview';
import { kidsInitialPreview } from '../../lib/kidsInitialPreview';
const transport = vi.hoisted(() => ({
  value: undefined as unknown,
  initial: undefined as unknown,
}));
vi.mock('../../lib/publicInitialData', () => ({
  readPublicInitialData: () => ({ kids: transport.initial }),
}));
vi.mock('convex/react', () => ({
  useQueries: (queries: object) => (Object.keys(queries).length ? { result: transport.value } : {}),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  transport.value = undefined;
  transport.initial = undefined;
});
const initial = () =>
  kidsInitialPreview({
    ready: true,
    version: 5,
    products: [
      {
        _id: 'dress',
        name: 'Dress',
        price: 32,
        category: 'Dresses',
        images: ['/dress.webp'],
        variantCount: 2,
      },
    ],
  });
it('shows only verified display data before the live connection and lets live empty override it', () => {
  transport.initial = initial();
  const { result, rerender } = renderHook(() => useKidsRootPreview(true));
  expect(result.current.loading).toBe(false);
  expect(result.current.products[0]).toMatchObject({ id: 'dress', inStock: false });
  transport.value = { ready: true, version: 5, products: [] };
  rerender();
  expect(result.current.products).toEqual([]);
  transport.value = undefined;
  rerender();
  expect(result.current.products).toEqual([]);
  expect(result.current.loading).toBe(true);
});
it('withdraws initial display at the unchanged timeout and recovers from live data', () => {
  transport.initial = initial();
  vi.useFakeTimers();
  const { result, rerender } = renderHook(() => useKidsRootPreview(true));
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.unavailable).toBe(true);
  expect(result.current.products).toEqual([]);
  transport.value = initial();
  rerender();
  expect(result.current.unavailable).toBe(false);
  expect(result.current.products).toHaveLength(1);
  transport.value = { ready: false, version: 5, products: [] };
  rerender();
  expect(result.current.unavailable).toBe(true);
  expect(result.current.products).toEqual([]);
});
it('does not resurrect initial data after route changes or a transport failure', () => {
  transport.initial = initial();
  const { result, rerender } = renderHook(({ enabled }) => useKidsRootPreview(enabled), {
    initialProps: { enabled: true },
  });
  rerender({ enabled: false });
  expect(result.current.products).toEqual([]);
  rerender({ enabled: true });
  expect(result.current.products).toEqual([]);
  transport.value = new Error('Offline');
  rerender({ enabled: true });
  expect(result.current.unavailable).toBe(true);
  transport.value = undefined;
  rerender({ enabled: true });
  expect(result.current.products).toEqual([]);
});
it('does not make an absent initial response look like verified emptiness', () => {
  const { result } = renderHook(() => useKidsRootPreview(true));
  expect(result.current).toEqual({ products: [], loading: true, unavailable: false });
});

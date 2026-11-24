import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useInitialPublicValue } from '../useInitialPublicValue';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('uses initial public content while connecting, then honors live withdrawal and never resurrects it', () => {
  const { result, rerender } = renderHook(
    ({ live }: { live: string | null | undefined | Error }) =>
      useInitialPublicValue(live, () => 'Initial'),
    { initialProps: { live: undefined } as { live: string | null | undefined | Error } }
  );
  expect(result.current.value).toBe('Initial');
  rerender({ live: 'Changed' });
  expect(result.current.value).toBe('Changed');
  rerender({ live: null });
  expect(result.current.value).toBeNull();
  rerender({ live: undefined });
  expect(result.current.value).toBeUndefined();
  rerender({ live: new Error('offline') });
  expect(result.current.unavailable).toBe(true);
  rerender({ live: 'Recovered' });
  expect(result.current.value).toBe('Recovered');
});
it('keeps timeout and disabled-query boundaries, even with initial data', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ enabled }) => useInitialPublicValue<string>(undefined, () => 'Initial', enabled),
    { initialProps: { enabled: true } }
  );
  expect(result.current.value).toBe('Initial');
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current).toEqual({ value: undefined, unavailable: true });
  rerender({ enabled: false });
  expect(result.current.value).toBeUndefined();
  rerender({ enabled: true });
  expect(result.current.value).toBeUndefined();
});
it('never uses an article snapshot for another request identity', () => {
  const { result, rerender } = renderHook(
    ({ id }) => useInitialPublicValue<string>(undefined, () => 'First article', true, id),
    { initialProps: { id: 'first' } }
  );
  expect(result.current.value).toBe('First article');
  rerender({ id: 'second' });
  expect(result.current.value).toBeUndefined();
});
it('preserves a confirmed live empty list instead of the original articles', () => {
  const { result } = renderHook(() => useInitialPublicValue<string[]>([], () => ['Old']));
  expect(result.current.value).toEqual([]);
});


it('starts a fresh pending budget when the article request changes', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ id }) => useInitialPublicValue<string>(undefined, () => undefined, true, id), { initialProps: { id: 'first' } });
  act(() => vi.advanceTimersByTime(5000));
  rerender({ id: 'second' });
  act(() => vi.advanceTimersByTime(6000));
  expect(result.current.unavailable).toBe(false);
  act(() => vi.advanceTimersByTime(4000));
  expect(result.current.unavailable).toBe(true);
});

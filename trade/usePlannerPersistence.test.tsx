import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlannerPersistence } from './usePlannerPersistence';

afterEach(() => vi.useRealTimers());
it('flushes the latest committed layout on unmount before the debounce fires', () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const initial = { items: [{ pid: 1, x: 1 }], wallImg: 'https://example.com/wall.jpg' };
  const view = renderHook(({ doc }) => usePlannerPersistence(doc, save), { initialProps: { doc: initial } });
  const edited = { ...initial, items: [{ pid: 1, x: 7 }], wallImg: 'data:image/png;base64,local' };
  view.rerender({ doc: edited });
  expect(save).not.toHaveBeenCalled();
  view.unmount();
  expect(save).toHaveBeenCalledExactlyOnceWith({ ...edited, wallImg: null });
  act(() => vi.advanceTimersByTime(500));
  expect(save).toHaveBeenCalledTimes(1);
});

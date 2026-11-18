/* global PerformanceObserverEntryList, PerformanceEntry */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAfterVisibleContent } from './visibleStartup';

let notify: (list: PerformanceObserverEntryList) => void;
const disconnect = vi.fn();
const observe = vi.fn();
const paint = (name = 'first-contentful-paint') =>
  notify({
    getEntriesByName: (requested) => (requested === name ? [{} as PerformanceEntry] : []),
  } as PerformanceObserverEntryList);
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main id="lm-page-document">Public content</main>';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  disconnect.mockClear();
  observe.mockReset();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('visible server document startup', () => {
  it.each([
    'lm-shell',
    'holm-shell',
    'lm-product-document',
    'lm-collection-document',
    'lm-page-document',
    'lm-journal-document',
  ])('paints %s before boot', (id) => {
    document.body.innerHTML = `<main id="${id}">Content</main>`;
    const start = vi.fn();
    const cancel = startAfterVisibleContent(start);
    expect(start).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({ type: 'paint', buffered: true });
    paint();
    expect(start).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    vi.runAllTimers();
    paint();
    expect(start).toHaveBeenCalledTimes(1);
    cancel();
  });
  it('starts a blank client route immediately', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const start = vi.fn();
    startAfterVisibleContent(start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
  });
  it('starts hidden documents immediately', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const start = vi.fn();
    startAfterVisibleContent(start);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('starts when paint observation is unsupported', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const start = vi.fn();
    startAfterVisibleContent(start);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('starts and cleans up when observing throws', () => {
    observe.mockImplementation(() => {
      throw Error('unsupported');
    });
    const start = vi.fn();
    startAfterVisibleContent(start);
    expect(start).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('keydown'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });
  it('bounds waiting and ignores unrelated paint entries', () => {
    const start = vi.fn();
    startAfterVisibleContent(start);
    paint('first-paint');
    vi.advanceTimersByTime(1499);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(1);
    paint();
    expect(start).toHaveBeenCalledTimes(1);
  });
  it.each(['pointerdown', 'keydown', 'hashchange', 'popstate'])(
    'starts immediately on %s without consuming the event',
    (event) => {
      const start = vi.fn();
      startAfterVisibleContent(start);
      const input = new Event(event, { cancelable: true });
      window.dispatchEvent(input);
      expect(input.defaultPrevented).toBe(false);
      expect(start).toHaveBeenCalledTimes(1);
      paint();
      vi.runAllTimers();
      expect(start).toHaveBeenCalledTimes(1);
    }
  );
  it('starts when the page becomes hidden before a paint', () => {
    const start = vi.fn();
    startAfterVisibleContent(start);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('cancels pending observation, intent listeners and timeout', () => {
    const start = vi.fn();
    const cancel = startAfterVisibleContent(start);
    cancel();
    paint();
    window.dispatchEvent(new Event('keydown'));
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});

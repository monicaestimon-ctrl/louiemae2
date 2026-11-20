import { renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useInitialPageDocument } from '../useInitialPageDocument';
afterEach(() => { document.body.innerHTML = ''; });
it('keeps matching content while loading and removes stale content and schema on navigation', () => {
  document.body.innerHTML = '<main id="lm-page-document" data-page-id="story"></main><script id="lm-page-structured-data" data-page-id="story"></script>';
  const view = renderHook(({ route }) => useInitialPageDocument(route, 'loading'), { initialProps: { route: 'story' } });
  expect(view.result.current).toBe(true);
  view.rerender({ route: 'shop' });
  expect(view.result.current).toBe(false);
  expect(document.getElementById('lm-page-structured-data')).toBeNull();
});
it('exposes recovery when the current source is unavailable', () => {
  document.body.innerHTML = '<main id="lm-page-document" data-page-id="story"></main>';
  expect(renderHook(() => useInitialPageDocument('story', 'unavailable')).result.current).toBe(false);
});

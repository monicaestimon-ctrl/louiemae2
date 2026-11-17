import { renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useInitialCollectionDocument } from '../useInitialCollectionDocument';
afterEach(() => { document.body.innerHTML = ''; });
it('keeps matching HTML through loading and removes it when navigation changes', () => {
  document.body.innerHTML = '<main id="lm-collection-document" data-collection-id="furniture"></main><script id="lm-collection-structured-data" data-collection-id="furniture"></script>';
  const view = renderHook(({ route }) => useInitialCollectionDocument(route, 'loading', false), { initialProps: { route: '#collection/furniture' } });
  expect(view.result.current).toBe(true);
  view.rerender({ route: '#collection/decor' });
  expect(view.result.current).toBe(false);
  expect(document.getElementById('lm-collection-structured-data')).toBeNull();
});
it('reveals recovery when current configuration is unavailable', () => {
  document.body.innerHTML = '<main id="lm-collection-document" data-collection-id="furniture"></main>';
  const view = renderHook(() => useInitialCollectionDocument('#collection/furniture', 'unavailable', true));
  expect(view.result.current).toBe(false);
});

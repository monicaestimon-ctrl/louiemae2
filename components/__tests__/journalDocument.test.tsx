import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useInitialJournalDocument } from '../useInitialJournalDocument';
import { useJournalMetadata } from '../useJournalMetadata';
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
const post = {
  _id: 'story1',
  title: 'Current story',
  excerpt: 'Current description',
  image: '',
  category: 'Home',
  date: 'November 17, 2026',
  content: '<p>Current text</p>',
};
it('keeps matching server content while loading and removes stale content on route changes', () => {
  document.body.innerHTML = '<main id="lm-journal-document" data-post-id="story1"></main>';
  document.head.innerHTML =
    '<script id="lm-journal-structured-data" data-post-id="story1" type="application/ld+json">{}</script>';
  const view = renderHook(({ route }) => useInitialJournalDocument(route), {
    initialProps: { route: '#blog/story1' },
  });
  expect(view.result.current).toBe(true);
  view.rerender({ route: '#blog/story2' });
  expect(view.result.current).toBe(false);
  expect(document.getElementById('lm-journal-structured-data')).toBeNull();
});
it('hands off current metadata and removes indexability/schema on withdrawal without affecting the next page', () => {
  document.body.innerHTML = '<main id="lm-journal-document" data-post-id="story1"></main>';
  document.head.innerHTML =
    '<link rel="canonical" href="https://www.louiemae.com/"><meta name="description">';
  const view = renderHook(
    ({ loading, current }: { loading: boolean; current: typeof post | null }) =>
      useJournalMetadata('story1', loading, false, current),
    { initialProps: { loading: true, current: null } }
  );
  expect(document.getElementById('lm-journal-document')).not.toBeNull();
  view.rerender({ loading: false, current: post });
  expect(document.getElementById('lm-journal-document')).toBeNull();
  expect(document.title).toBe('Current story | Louie Mae');
  expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
    'https://www.louiemae.com/blog/story1'
  );
  expect(document.getElementById('lm-journal-structured-data')?.textContent).toContain(
    'BlogPosting'
  );
  view.rerender({ loading: false, current: null });
  expect(document.getElementById('lm-journal-structured-data')).toBeNull();
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  view.unmount();
  expect(document.querySelector('meta[name="robots"]')).toBeNull();
});

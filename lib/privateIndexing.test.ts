import { expect, it } from 'vitest';
import { privateLocation, acquirePrivateIndexing } from './privateIndexing';
const location = (value: string) => new URL(value, 'https://www.louiemae.com');
it.each([
  '/?code=private',
  '/?session_id=private',
  '/trade/index.html#account',
  '/admin',
  '/furniture/admin',
  '/furniture/index.html',
  '/#unknown',
  '/#admin',
  '/#checkout/success?session_id=private',
  '/#checkout/cancel',
  '/?deliveryQuote=private#delivery-access=secret',
  '/?delivery-access=rejected',
  '/trade/#account',
  '/trade/#q/private',
  '/trade/#b/private',
  '/trade/#studio',
  '/trade/#unknown',
])('classifies private entry %s', (value) => expect(privateLocation(location(value))).toBe(true));
it.each([
  '/',
  '/#main-content',
  '/#support/contact',
  '/#collection/kids?cat=All',
  '/shop',
  '/collection/kids',
  '/products/public?variant=public',
  '/#creators',
  '/trade/',
  '/trade/#home',
  '/trade/#welcome',
  '/trade/#partner-terms',
])('keeps public entry %s indexable', (value) =>
  expect(privateLocation(location(value))).toBe(false)
);
it('keeps overlapping private owners and restores the original directives', () => {
  const doc = document.implementation.createHTMLDocument();
  // createHTMLDocument has no window; use the test DOM for MutationObserver.
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.head.innerHTML = '<meta name="robots" content="index, follow, max-image-preview:large">';
  const first = acquirePrivateIndexing(doc);
  const second = acquirePrivateIndexing(doc);
  expect(doc.querySelectorAll('meta[name=robots]')).toHaveLength(1);
  expect(doc.querySelector('meta')?.content).toBe('max-image-preview:large, noindex, nofollow');
  first();
  first();
  expect(doc.querySelector('meta')?.content).toContain('noindex');
  second();
  expect(doc.querySelector('meta')?.content).toBe('index, follow, max-image-preview:large');
});
it('removes only its newly created tag after the final owner closes', () => {
  const doc = document.implementation.createHTMLDocument();
  Object.defineProperty(doc, 'defaultView', { value: window });
  const release = acquirePrivateIndexing(doc);
  expect(doc.querySelector('meta')?.content).toBe('noindex, nofollow');
  release();
  expect(doc.querySelector('meta')).toBeNull();
});
it('preserves an existing stricter policy and an external policy change', async () => {
  const doc = document.implementation.createHTMLDocument();
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.head.innerHTML = '<meta name="robots" content="noindex, noarchive">';
  const release = acquirePrivateIndexing(doc);
  doc.querySelector('meta')!.content = 'noindex, nosnippet';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(doc.querySelector('meta')?.content).toBe('nosnippet, noindex, nofollow');
  release();
  expect(doc.querySelector('meta')?.content).toBe('noindex, nosnippet');
});
it('places its policy in the head even when unrelated body markup contains a robots tag', () => {
  const doc = document.implementation.createHTMLDocument();
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.body.innerHTML = '<meta name="robots" content="index">';
  const release = acquirePrivateIndexing(doc);
  expect(doc.head.querySelector('meta[name=robots]')?.getAttribute('content')).toBe(
    'noindex, nofollow'
  );
  expect(doc.body.querySelector('meta')?.getAttribute('content')).toBe('index');
  release();
  expect(doc.head.querySelector('meta')).toBeNull();
});
it('does not restore robots content onto a tag reassigned by another owner', async () => {
  const doc = document.implementation.createHTMLDocument();
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.head.innerHTML = '<meta name="robots" content="index">';
  const release = acquirePrivateIndexing(doc);
  const original = doc.querySelector('meta')!;
  original.name = 'description';
  original.content = 'External description';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(doc.head.querySelector('meta[name=robots]')?.getAttribute('content')).toBe(
    'noindex, nofollow'
  );
  release();
  expect(original.content).toBe('External description');
});
it('restores each original robots tag without manufacturing duplicate tags', () => {
  const doc = document.implementation.createHTMLDocument();
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.head.innerHTML =
    '<meta name="robots" content="index"><meta name="ROBOTS" content="noarchive">';
  const release = acquirePrivateIndexing(doc);
  expect(doc.querySelectorAll('meta')).toHaveLength(2);
  for (const node of doc.querySelectorAll('meta')) expect(node.content).toContain('noindex');
  release();
  expect([...doc.querySelectorAll('meta')].map((node) => node.content)).toEqual([
    'index',
    'noarchive',
  ]);
});

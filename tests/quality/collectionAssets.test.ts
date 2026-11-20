import { expect, it } from 'vitest';
import { collectionDocument } from '../../lib/serverCollectionDocument';
const template =
  '<html><head><title>Louie Mae</title><link rel="preload" href="/fonts/cormorant-garamond-latin-400-normal.woff2" as="font"/><link rel="preload" href="/fonts/cormorant-garamond-latin-400-italic.woff2" as="font"/><link rel="preload" href="/fonts/other.woff2" as="font"/></head><body><!--product-document--></body></html>';
it('retains useful font hints while allowing the italic face to load on demand', () => {
  const html = collectionDocument(template, {
    id: 'furniture',
    title: 'Furniture',
    subtitle: 'Objects',
    categories: [],
    cards: [],
  });
  const document = new window.DOMParser().parseFromString(html, 'text/html');
  expect(
    [...document.querySelectorAll('link[as="font"]')].map((el) => el.getAttribute('href'))
  ).toEqual(['/fonts/cormorant-garamond-latin-400-normal.woff2', '/fonts/other.woff2']);
});
it('uses the same reviewed mobile portrait source set for its preload and hero', () => {
  const image = '/images/brand/girls-dress.png';
  const html = collectionDocument(template, {
    id: 'kids',
    title: 'Kids',
    subtitle: 'Small wonders',
    primaryCategoryImage: image,
    rootCategories: [{ id: 'girls', title: 'Girls', image, isMainCategory: true }],
    categories: [],
    cards: [],
  });
  const document = new window.DOMParser().parseFromString(html, 'text/html');
  const preload = document.querySelector('link[as="image"]')!;
  const hero = document.querySelector('img')!;
  expect(preload.getAttribute('imagesrcset')).toBe(hero.getAttribute('srcset'));
  expect(preload.getAttribute('imagesizes')).toBe(hero.getAttribute('sizes'));
  expect(hero.getAttribute('srcset')).toContain('/images/opt/brand/girls-dress-360.webp 360w');
  expect(hero.getAttribute('srcset')).toContain('/images/opt/brand/girls-dress-533.webp 533w');
  expect(hero.getAttribute('loading')).toBe('eager');
  expect(hero.getAttribute('fetchPriority')).toBe('high');
});

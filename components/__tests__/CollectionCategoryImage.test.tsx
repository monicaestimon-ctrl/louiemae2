/* global DOMParser */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CollectionCategoryImage } from '../CollectionCategoryImage';
import { collectionDocument } from '../../lib/serverCollectionDocument';

afterEach(cleanup);
const source = '/images/brand/mae-dress.png';
const template =
  '<html><head><title>Fixture</title></head><body><!--product-document--></body></html>';

it('falls back to WebP, preserves decorative space on failure and resets for a new source', () => {
  const view = render(
    <CollectionCategoryImage source={source} alt="" className="absolute inset-0" />
  );
  const image = () => view.container.querySelector('img')!;
  expect(view.container.querySelector('source')?.getAttribute('media')).toBe(
    '(scripting: enabled)'
  );
  Object.defineProperty(image(), 'currentSrc', {
    configurable: true,
    value: 'https://example.test/image.avif',
  });
  fireEvent.error(image());
  expect(view.container.querySelector('source')).toBeNull();
  expect(image().getAttribute('srcset')).toContain('.webp');
  fireEvent.error(image());
  expect(image()).toBeNull();
  expect(view.container.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  view.rerender(<CollectionCategoryImage source="/unknown.jpg" alt="" />);
  expect(image().getAttribute('src')).toBe('/unknown.jpg');
  expect(image().getAttribute('srcset')).toBeNull();
  view.rerender(<CollectionCategoryImage source={source} alt="" />);
  expect(view.container.querySelector('source')).not.toBeNull();
});

it('uses the initial picture without preloading a competing format', () => {
  const html = collectionDocument(template, {
    id: 'fashion',
    title: 'Fashion',
    subtitle: 'Clothing',
    primaryCategoryImage: source,
    rootCategories: [{ id: 'dresses', title: 'Dresses', image: source }],
    categories: [],
    cards: [],
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('link[as="image"]')).toBeNull();
  expect(doc.querySelector('picture source')?.getAttribute('media')).toBe('(scripting: enabled)');
  expect(doc.querySelector('picture img')?.getAttribute('srcset')).toContain('.webp');
  expect(doc.querySelector('picture img')?.getAttribute('fetchpriority')).toBe('high');
});

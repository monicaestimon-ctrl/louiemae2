/* global DOMParser */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productDocument, type PublicProductDocument } from './serverProductDocument';
const template = readFileSync('index.html', 'utf8');
const product: PublicProductDocument = {
  _id: 'fixture',
  name: 'Chair $& </script><img src=x onerror=alert(1)>',
  description: 'Comfort & craft',
  category: 'Furniture',
  price: 120,
  images: ['https://example.com/chair.png'],
  inStock: true,
  variants: [
    { id: 'oak', name: 'Oak', priceAdjustment: 20, inStock: true },
    { id: 'walnut', name: 'Walnut', priceAdjustment: 30, inStock: false },
  ],
};
describe('initial public product document', () => {
  it('rejects root-relative URLs that the browser resolves off origin', () => {
    for (const image of ['/\\evil.example/x.png', '/\t/evil.example/x.png', '//evil.example/x.png', 'https://']) {
      const doc = new DOMParser().parseFromString(productDocument(template, { ...product, images: [image] })!, 'text/html');
      expect(doc.querySelector('img')).toBeNull();
      expect(doc.querySelector('link[as="image"]')).toBeNull();
      expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('');
      expect(JSON.parse(doc.querySelector('#lm-product-structured-data')!.textContent!).image).toEqual([]);
    }
    for (const image of ['/images/chair.png', 'https://example.com/chair.png']) {
      const doc = new DOMParser().parseFromString(productDocument(template, { ...product, images: [image] })!, 'text/html');
      expect(doc.querySelector('img')?.getAttribute('src')).toBe(image);
    }
  });
  it('renders literal escaped content, current selected price and metadata with one heading', () => {
    const html = productDocument(template, product, 'oak')!;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('h1')?.textContent).toBe(product.name);
    expect(doc.querySelector('[onerror]')).toBeNull();
    expect(doc.querySelector('#lm-shell')).toBeNull();
    expect(doc.body.textContent).toContain('$140.00');
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://louiemae.com/products/fixture'
    );
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain(
      product.name
    );
    expect(doc.querySelector('img')?.getAttribute('fetchpriority')).toBe('high');
    expect(doc.querySelector('link[as="image"]')?.getAttribute('href')).toBe(doc.querySelector('img')?.getAttribute('src'));
    expect(html.indexOf('name="viewport"')).toBeLessThan(html.indexOf('rel="preload" as="image"'));
    const schema = JSON.parse(
      doc.querySelector('script[type="application/ld+json"]')!.textContent!
    );
    expect(schema.name).toBe(product.name);
    expect(schema.offers.price).toBe(140);
    expect(doc.querySelector('button')).toBeNull();
  });
  it('keeps unavailable variants unavailable and rejects unknown options', () => {
    expect(productDocument(template, product, 'walnut')).toContain('https://schema.org/OutOfStock');
    expect(productDocument(template, product, 'missing')).toBeNull();
  });
  it('fails on missing build template and invalid prices', () => {
    expect(() => productDocument('', product)).toThrow('template');
    expect(() => productDocument(template, { ...product, price: NaN })).toThrow('price');
  });
});

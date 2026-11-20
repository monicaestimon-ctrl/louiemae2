import { describe, expect, it } from 'vitest';
import products from './productImageManifest.json';
import { imageEntry, responsiveImage, responsiveAvifSource } from './responsiveImage';

describe('source-bound product renditions', () => {
  const source = Object.keys(products)[0];
  it('selects responsive renditions for the exact immutable source', () => {
    const result = responsiveImage(source, '50vw');
    expect(result.src).toMatch(/^\/images\/opt\/products\/[a-f0-9]+-\d+\.webp$/);
    expect(result.srcSet).toContain('320w');
    expect(result.sizes).toBe('50vw');
  });
  it('never matches a different source or prototype key', () => {
    for (const value of [source + '?changed=true', source.replace('/api/storage/', '/different/'), '__proto__', 'constructor']) {
      expect(imageEntry(value)).toBeUndefined();
      expect(responsiveImage(value)).toEqual({ src: value });
    }
  });
});

describe('optional Story AVIF source', () => {
  it('keeps WebP fallback and matching size candidates for the exact known photograph', () => {
    const source = '/images/brand/fam2.png';
    const fallback = responsiveImage(source, '384px');
    const avif = responsiveAvifSource(source, '384px');
    expect(avif?.type).toBe('image/avif');
    expect(avif?.sizes).toBe(fallback.sizes);
    expect(avif?.srcSet.match(/\d+w/g)).toEqual(fallback.srcSet?.match(/\d+w/g));
    expect(fallback.src).toMatch(/\.webp$/);
  });
  it('does not invent AVIF candidates for changed or unknown sources', () => {
    for (const source of ['/images/brand/fam2.png?new=1', '/unknown.jpg', '__proto__']) {
      expect(responsiveAvifSource(source, '100vw')).toBeUndefined();
    }
  });
});

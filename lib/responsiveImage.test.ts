import { describe, expect, it } from 'vitest';
import products from './productImageManifest.json';
import { imageEntry, responsiveImage } from './responsiveImage';

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

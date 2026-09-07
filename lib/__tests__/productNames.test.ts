import { describe, expect, it } from 'vitest';
import { areProductNamesEquivalent, normalizeProductName, validateProductDisplayName } from '../productNames';

describe('product name normalization', () => {
  it('treats case, accents, punctuation, ampersands, and spacing consistently', () => {
    expect(normalizeProductName('  Chloé & Co.  Dress ')).toBe('chloe and co dress');
    expect(areProductNamesEquivalent('Chloé & Co.', 'chloe and co')).toBe(true);
  });

  it('rejects empty, punctuation-only, and overlong names', () => {
    expect(validateProductDisplayName('')).not.toHaveLength(0);
    expect(validateProductDisplayName('---')).not.toHaveLength(0);
    expect(validateProductDisplayName('A'.repeat(81))).not.toHaveLength(0);
    expect(validateProductDisplayName('Willow Linen Trousers')).toEqual([]);
  });
});

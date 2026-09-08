import { describe, expect, it } from 'vitest';
import { areProductNamesEquivalent, inferBoutiqueIdentity, normalizeBoutiqueIdentity, normalizeProductName, validateProductDisplayName } from '../productNames';

describe('product name normalization', () => {
  it('treats case, accents, punctuation, ampersands, and spacing consistently', () => {
    expect(normalizeProductName('  Chloé & Co.  Dress ')).toBe('chloe and co dress');
    expect(areProductNamesEquivalent('Chloé & Co.', 'chloe and co')).toBe(true);
  });

  it('normalizes boutique identities independently from product modifiers and types', () => {
    expect(normalizeBoutiqueIdentity('Chloé Ruffle Dress')).toBe('chloe');
    expect(inferBoutiqueIdentity('Poppy Pants')).toBe('poppy');
    expect(inferBoutiqueIdentity('Classic Woven Chair')).toBeUndefined();
  });

  it('rejects empty, punctuation-only, and overlong names', () => {
    expect(validateProductDisplayName('')).not.toHaveLength(0);
    expect(validateProductDisplayName('---')).not.toHaveLength(0);
    expect(validateProductDisplayName('A'.repeat(81))).not.toHaveLength(0);
    expect(validateProductDisplayName('Willow Linen Trousers')).toEqual([]);
  });
});

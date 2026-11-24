import { expect, it } from 'vitest';
import { discoveryWords, discoverySearchQuery, discoverySearchDocument, matchesDiscoverySearch } from './holmDiscoverySearch';

it('normalizes accents, case and punctuation with bounded terms', () => {
  expect(discoveryWords('Ivory BOUCLÉ—chair')).toEqual(['ivory', 'boucle', 'chair']);
  expect(() => discoverySearchQuery('a '.repeat(17))).toThrow('16');
  expect(() => discoverySearchQuery('a'.repeat(201))).toThrow('200');
  expect(discoveryWords('x'.repeat(33))).toEqual([]);
});
it('uses any-term membership and only final-term prefixes consistently for price-ordered candidates', () => {
  const matches = (query: string, text: string) => matchesDiscoverySearch(discoverySearchQuery(query), text);
  expect(matches('ivory cha', 'ivory boucle bench')).toBe(true);
  expect(matches('ivory cha', 'grey fabric chair')).toBe(true);
  expect(matches('iv cha', 'ivory bench')).toBe(false);
  expect(matches('red', 'upholstered chair')).toBe(false);
  expect(matches('  ', 'anything')).toBe(true);
  expect(matches('!!!', 'anything')).toBe(false);
});
it('adds known color, material, seating and curated-space navigation without guessing unknown facets', () => {
  const text = discoverySearchDocument({ name: 'Kensley', category: 'Sofas', type: 'sectional', material: 'boucle', tone: '#E7DFD0', seats: 5, curatedId: 7 });
  for (const query of ['bouclé', 'ivory', 'seating', 'workspace', 'model']) expect(matchesDiscoverySearch(discoverySearchQuery(query), text)).toBe(true);
  const unknown = discoverySearchDocument({ name: 'Quill', category: '', type: 'other', material: 'unknown', tone: '', seats: 0 });
  expect(unknown).toBe('quill');
  expect(matchesDiscoverySearch(discoverySearchQuery('leather tan'), unknown)).toBe(false);
});

import { expect, it } from 'vitest';
import { discoveryToneOrder, matchesDiscoveryFacets, normalizeDiscoveryRequest, type DiscoveryRequest } from './holmDiscoveryFilters';
const request: DiscoveryRequest = { query: '', type: 'all', materials: [], tones: [], photoPalette: [], maximumMinor: null, inStock: false, sort: 'relevance', channel: 'retail' };
it('canonicalizes equivalent filters without conflating blank search with punctuation-only search', () => {
  const normalized = normalizeDiscoveryRequest({ ...request, materials: ['wood', 'leather', 'wood'], tones: ['#abcdef', '#ABCDEF'] });
  expect(normalized.materials).toEqual(['leather', 'wood']);
  expect(normalized.tones).toEqual(['#ABCDEF']);
  expect(normalizeDiscoveryRequest(request).query.empty).toBe(true);
  expect(normalizeDiscoveryRequest({ ...request, query: '!!' }).query.empty).toBe(false);
});
it('rejects malformed filters, unsafe prices and excessive palettes', () => {
  for (const patch of [{ type: 'constructor' }, { materials: ['__proto__'] }, { maximumMinor: NaN }, { maximumMinor: 1.5 }, { tones: ['red'] }, { photoPalette: Array(9).fill('#000000') }]) {
    expect(() => normalizeDiscoveryRequest({ ...request, ...patch })).toThrow();
  }
});
it('keeps unknown facets visible without a filter but never pretends their color matches', () => {
  const unknown = { type: 'other', material: 'unknown', tone: '' };
  expect(matchesDiscoveryFacets(normalizeDiscoveryRequest(request), unknown)).toBe(true);
  expect(matchesDiscoveryFacets(normalizeDiscoveryRequest({ ...request, tones: ['#FFFFFF'] }), unknown)).toBe(false);
  expect(matchesDiscoveryFacets(normalizeDiscoveryRequest({ ...request, materials: ['unknown'] }), unknown)).toBe(true);
});
it('orders complete color buckets by photo distance, then deterministic ties, with unknown last', () => {
  expect(discoveryToneOrder(['#000000', '#FFFFFF', '', '#ffffff', 'bad'], ['#FDFDFD'])).toEqual(['#FFFFFF', '#000000', '']);
});

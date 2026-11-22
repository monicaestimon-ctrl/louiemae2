import { expect, it } from 'vitest';
import { matchHolmQuery } from './holmDiscoveryMatch';

const sofa = { id: 2, name: 'Roscoe', type: 'sofa', mat: 'leather', tone: '#A0612F', seats: 3 };
const lamp = { id: 1, name: 'Elara', type: 'lighting', mat: 'rattan', tone: '#C9A46C', seats: 0 };
const unknown = { id: 3, name: 'Quill', type: 'other', mat: 'unknown', tone: '', seats: 0 };

it('matches names, materials and product types without mutating candidates', () => {
  const items = [sofa, lamp, unknown];
  expect(matchHolmQuery('ROSCOE', items)).toEqual([sofa]);
  expect(matchHolmQuery('rattan', items)).toEqual([lamp]);
  expect(matchHolmQuery('sofa', items)).toEqual([sofa]);
  expect(items).toEqual([sofa, lamp, unknown]);
});
it('retains space picks/material hints and deterministic numeric tie ordering', () => {
  const spaces = { cafe: { label: 'Café', picks: [2, 1], mats: ['rattan'] } };
  expect(matchHolmQuery('cafe', [sofa, lamp], spaces)).toEqual([lamp, sofa]);
  expect(matchHolmQuery('seat', [{ ...sofa, id: 10 }, sofa]).map(p => p.id)).toEqual([2, 10]);
});
it('matches new color hints while unspecified colors and materials receive no false match', () => {
  const orange = { ...sofa, tone: '#B45E32' };
  expect(matchHolmQuery('orange', [unknown, orange])).toEqual([orange]);
  expect(matchHolmQuery('tan', [unknown])).toEqual([]);
  expect(matchHolmQuery('unknown', [unknown])).toEqual([]);
  expect(matchHolmQuery('upholstered', [{ ...sofa, tone: '#923F3F' }])).toEqual([]);
});
it('handles empty queries/sets and retains the established relative relevance cutoff', () => {
  expect(matchHolmQuery(' ', [sofa])).toEqual([]);
  expect(matchHolmQuery('sofa', [])).toEqual([]);
  const weaker = { ...sofa, id: 4, name: 'Another' };
  expect(matchHolmQuery('Roscoe sofa', [weaker, sofa])).toEqual([sofa]);
});

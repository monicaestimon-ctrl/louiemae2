import { expect, it } from 'vitest';
import { holmCatalogFacets, toneDistance } from './holmCatalogFacets';

const facets = (name: string, category = '', facts = '') => holmCatalogFacets({ name, category, facts });

it('does not invent a chair, leather material or tan color for an unidentified piece', () => {
  expect(facets('Quill')).toMatchObject({ type: 'other', mat: 'unknown', tone: '', seats: 0 });
  expect(facets('Sagewell Teakley')).toMatchObject({ mat: 'unknown', tone: '' });
});

it.each([
  ['Light Grey Dining Chair', 'chair'],
  ['Light Grey Bench', 'bench'],
  ['Modular Sectional Sofa', 'sectional'],
  ['Curved Floor Lamp', 'lighting'],
  ['Wall Light', 'lighting'],
  ['Dining Table', 'table'],
  ['Platform Bed Frame', 'other'],
])('uses concrete type words in %s', (name, type) => {
  expect(facets(name).type).toBe(type);
});

it('prefers the supplied product category over loose name hints', () => {
  expect(facets('Light Grey', ' Accent Chairs ').type).toBe('chair');
  expect(facets('Quill', 'lighting').type).toBe('lighting');
});

it('does not equate a gold finish or a woven textile with brass or rattan', () => {
  expect(facets('Gold Finish Lamp', 'lighting', 'Material: steel').mat).toBe('unknown');
  expect(facets('Woven Chair', 'accent chairs', 'Polyester upholstery').mat).toBe('unknown');
  expect(facets('Bouclé Chair', 'accent chairs')).toMatchObject({ mat: 'boucle', tone: '' });
  expect(facets('Chair', 'accent chairs', 'Material: rattan')).toMatchObject({ mat: 'rattan' });
  expect(facets('Ivory Velvet Sofa')).toMatchObject({ mat: 'velvet', tone: '#E7DFD0' });
});

it('prefers the primary title material and color over frame and leg details', () => {
  expect(facets('Gold Chenille Swivel Chair', 'accent chairs', 'Solid wood frame. Black steel base.'))
    .toMatchObject({ mat: 'chenille', tone: '#B58D52' });
  expect(facets('Burnt Orange Bouclé Sofa', 'sofas', 'Black plastic legs.'))
    .toMatchObject({ mat: 'boucle', tone: '#B45E32' });
  expect(facets('Quill', '', 'Black legs.')).toMatchObject({ tone: '' });
  expect(facets('Quill', '', 'Color: Grey\nMaterial: Fabric')).toMatchObject({ tone: '#CFCBC4', mat: 'fabric' });
});

it('keeps curated facets tied to an explicit identity across marketing renames', () => {
  expect(holmCatalogFacets({ name: 'New name', category: '', facts: '' }, 5)).toMatchObject({
    curated: true, name: 'Osborne', line: 'Velvet Sectional, Left Facing', type: 'sectional',
    mat: 'velvet', tone: '#9A5A2E', seats: 4,
  });
  expect(facets('Osborne')).toMatchObject({ curated: false, mat: 'unknown', type: 'other' });
});

it('cannot match unknown or malformed colors to a known palette', () => {
  for (const value of ['', '#abc', '#GG0000', 'tan']) expect(toneDistance(value, '#B07A4A')).toBe(Infinity);
  expect(toneDistance('#b07a4a', '#B07A4A')).toBe(0);
});

/** Shared display facets for browser cards and server discovery. These are navigation
 * hints from supplied text, not supplier certifications or commission categories. */
export const HOLM_MATERIAL_LABELS: Record<string, string> = {
  leather: 'Leather', velvet: 'Velvet', boucle: 'Bouclé', rattan: 'Rattan',
  brass: 'Brass', wood: 'Wood', chenille: 'Chenille', fabric: 'Fabric', unknown: 'Material not specified',
};
export const HOLM_TYPE_LABELS: Record<string, string> = {
  sofa: 'Sofas', sectional: 'Sectionals', ottoman: 'Ottomans', bench: 'Benches',
  lighting: 'Lighting', chair: 'Chairs', stool: 'Stools', table: 'Tables', other: 'Other pieces',
};
export function toneDistance(a: string, b: string): number {
  if (!/^#[a-f0-9]{6}$/i.test(a) || !/^#[a-f0-9]{6}$/i.test(b)) return Infinity;
  return Math.hypot(...[1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
}

// id, name, line, type, material, tone, seats
const CURATED: [number, string, string, string, string, string, number][] = [
  [1, 'Bramwell', 'Brown Leather Sofa', 'sofa', 'leather', '#6B4A33', 3],
  [2, 'Roscoe', 'Cognac Leather Sofa', 'sofa', 'leather', '#A0612F', 3],
  [3, 'Westcott', 'Tan Leather Sofa', 'sofa', 'leather', '#B07A4A', 3],
  [4, 'Bellamere', 'Olive Velvet Sofa', 'sofa', 'velvet', '#5E6338', 3],
  [5, 'Osborne', 'Velvet Sectional, Left Facing', 'sectional', 'velvet', '#9A5A2E', 4],
  [6, 'Osborne', 'Velvet Sectional, Right Facing', 'sectional', 'velvet', '#9A5A2E', 4],
  [7, 'Kensley', 'Ivory Bouclé Corner Sofa', 'sectional', 'boucle', '#E7DFD0', 5],
  [8, 'Aster', 'Rattan Semi-Flush Light', 'lighting', 'rattan', '#C9A46C', 0],
  [9, 'Ansel', 'Cognac Leather Square Ottoman', 'ottoman', 'leather', '#A0612F', 1],
  [10, 'Kensley', 'Tufted Bouclé Ottoman', 'ottoman', 'boucle', '#EAE3D6', 1],
  [11, 'Aurelia', 'Brass Curved Floor Lamp', 'lighting', 'brass', '#B58D52', 0],
  [12, 'Elara', 'Three-Light Rattan Pendant', 'lighting', 'rattan', '#C9A46C', 0],
  [13, 'Montrose', 'Tan Leather & Teak Bench', 'bench', 'leather', '#B07A4A', 2],
  [14, 'Rory', 'Round Tan Leather Ottoman', 'ottoman', 'leather', '#B07A4A', 1],
  [15, 'Stellan', 'Tufted Leather Drum Ottoman', 'ottoman', 'leather', '#B07A4A', 1],
  [16, 'Marlowick', 'Tufted Leather Square Ottoman', 'ottoman', 'leather', '#B07A4A', 1],
  [17, 'Selwyn', 'Corner Sectional with Ottoman', 'sectional', 'leather', '#A0612F', 5],
  [18, 'Fable', 'Light Grey Bouclé Bench', 'bench', 'boucle', '#CFCBC4', 2],
  [19, 'Ronan', 'Ivory Bouclé Pedestal Bench', 'bench', 'boucle', '#E7DFD0', 2],
  [20, 'Lucienne', 'Black Faux Leather & Walnut Bench', 'bench', 'leather', '#2A2522', 2],
  [21, 'Cressida', 'Woven Leather Strap Bench', 'bench', 'leather', '#8E532A', 2],
  [22, 'Seren', 'Ivory Bouclé Storage Bench', 'bench', 'boucle', '#E7DFD0', 2],
  [23, 'Beckett', 'Tan Leather Bench', 'bench', 'leather', '#B07A4A', 2],
  [24, 'Tessa', 'Mid-Century Tan Leather Bench', 'bench', 'leather', '#B07A4A', 2],
];

const TYPE_BY_CATEGORY: Record<string, string> = {
  sofas: 'sofa',
  sectionals: 'sectional',
  ottomans: 'ottoman',
  benches: 'bench',
  lighting: 'lighting',
  barstools: 'stool',
  counterstools: 'stool',
  stools: 'stool',
  'dining tables': 'table',
  'dining chairs': 'chair',
  'accent chairs': 'chair',
};
const SEATS: Record<string, number> = { sofa: 3, sectional: 4, ottoman: 1, bench: 2, stool: 1, chair: 1, table: 0, lighting: 0 };
const TONES: [RegExp, string][] = [
  [/\b(?:cognac|caramel|rust)\b/i, '#A0612F'],
  [/\b(?:tan|camel|saddle)\b/i, '#B07A4A'],
  [/\b(?:brown|walnut|espresso|chocolate)\b/i, '#6B4A33'],
  [/\b(?:olive|green|sage|moss)\b/i, '#5E6338'],
  [/\b(?:ivory|cream|white|natural linen)\b/i, '#E7DFD0'],
  [/\b(?:grey|gray|stone|oatmeal|beige)\b/i, '#CFCBC4'],
  [/\b(?:black|charcoal)\b/i, '#2A2522'],
  [/\b(?:brass|gold)\b/i, '#B58D52'],
  [/\b(?:blue|navy)\b/i, '#33445E'],
  [/\borange\b/i, '#B45E32'],
  [/\byellow\b/i, '#D6B44C'],
  [/\b(?:red|burgundy)\b/i, '#923F3F'],
  [/\bpink\b/i, '#CA929B'],
  [/\b(?:purple|violet)\b/i, '#7B5D86'],
];
export const holmKnownTones = () => [...new Set([...CURATED.map(value => value[5]), ...TONES.map(value => value[1])])].sort();

const cleanName = (s: string) => s.split('|')[0].trim();

/** Separate explicit construction clauses from the primary title attributes. */
function primaryTitle(text: string) {
  const secondary = text.match(/\s+(?:with|featuring|on)\s+([^,;]+)/i);
  return secondary && /\b(?:legs?|base|frame)\b/i.test(secondary[1])
    ? text.slice(0, secondary.index).trim() : text;
}

function materialOf(text: string) {
  text = text.normalize('NFKD').replace(/\p{M}/gu, '');
  if (/\bboucle\b/i.test(text)) return 'boucle';
  if (/\bvelvet\b/i.test(text)) return 'velvet';
  if (/\bchenille\b/i.test(text)) return 'chenille';
  if (/\bfabric\b/i.test(text)) return 'fabric';
  if (/\brattan\b/i.test(text)) return 'rattan';
  if (/\bbrass\b/i.test(text)) return 'brass';
  if (/\bleather\b/i.test(text)) return 'leather';
  if (/\b(?:wood|oak|walnut|teak)\b/i.test(text)) return 'wood';
  return 'unknown';
}
function toneOf(text: string) {
  return TONES.find(([re]) => re.test(text))?.[1] ?? '';
}

export function holmCatalogFacets(item: { name: string; category: string; facts: string }, curatedId?: number) {
  const full = cleanName(item.name);
  const curated = CURATED.find(c => c[0] === curatedId);
  const category = item.category.trim().toLowerCase();
  const typeGuess = TYPE_BY_CATEGORY[category]
    ?? (/\bsectional\b/i.test(full) ? 'sectional'
      : /\bsofa\b|\bcouch\b/i.test(full) ? 'sofa'
      : /\blamp\b|\bpendant\b|\bchandelier\b|\bsconce\b|\b(?:floor|table|wall|ceiling) light\b/i.test(full) ? 'lighting'
      : /\bbench\b/i.test(full) ? 'bench'
      : /\bottoman\b/i.test(full) ? 'ottoman'
      : /\bstool\b/i.test(full) ? 'stool'
      : /\bchair\b/i.test(full) ? 'chair'
      : /\btable\b/i.test(full) ? 'table' : 'other');
  const primary = primaryTitle(full);
  const namedMaterial = materialOf(primary);
  // A primary title attribute wins over secondary frame/base details. If no
  // title color exists, accept a labeled color field rather than any leg color.
  const namedTone = toneOf(primary);
  const labeledColor = item.facts.match(/\b(?:color|colour)\s*:\s*([^\n;|]+)/i)?.[1] ?? '';
  const type = curated ? curated[3] : typeGuess;
  return {
    full, curated: Boolean(curated),
    name: curated ? curated[1] : full.split(' ')[0],
    line: curated ? curated[2] : full.split(' ').slice(1).join(' ') || item.category,
    type, mat: curated ? curated[4] : namedMaterial !== 'unknown' ? namedMaterial : materialOf(item.facts),
    tone: curated ? curated[5] : namedTone || toneOf(labeledColor),
    seats: curated ? curated[6] : (SEATS[type] ?? 0),
  };
}

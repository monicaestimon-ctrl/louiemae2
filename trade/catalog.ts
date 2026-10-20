// Maps live House listings onto the product shape the site was designed around.
// The 24 curated pieces keep their numeric ids (1–24) so hero films, room scenes and
// cutouts stay attached to the right product; every other listing gets a stable id
// derived from its database id.

export type LiveVariant = {
  id: string;
  name: string;
  image?: string;
  minimum: number;
  increment: number;
  retail: number;
  trade: number | null;
};
export type LiveItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  images: string[];
  facts: string;
  inStock: boolean;
  variants: LiveVariant[];
};
export type HolmProduct = {
  id: number;
  lid: string; // commerceProducts id
  vid: string; // default variant
  variants: LiveVariant[];
  name: string;
  line: string;
  full: string;
  type: string;
  mat: string;
  tone: string;
  price: number; // retail, dollars
  trade: number | null; // trade, dollars (verified accounts only)
  seats: number;
  oos: boolean;
  note: string;
  facts: string;
  img: string;
  imgs: string[];
  ar: number;
  sku: string;
  likes: number;
  widthCm: number | null;
  minimum: number;
  increment: number;
};

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
  [/cognac|caramel|rust/i, '#A0612F'],
  [/\btan\b|camel|saddle/i, '#B07A4A'],
  [/brown|walnut|espresso|chocolate/i, '#6B4A33'],
  [/olive|green|sage|moss/i, '#5E6338'],
  [/ivory|cream|white|boucl|natural linen/i, '#E7DFD0'],
  [/grey|gray|stone|oatmeal|beige/i, '#CFCBC4'],
  [/black|charcoal/i, '#2A2522'],
  [/brass|gold/i, '#B58D52'],
  [/rattan|wicker|woven|cane|oak|wood/i, '#C9A46C'],
  [/blue|navy/i, '#33445E'],
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter(Boolean);
const cleanName = (s: string) => s.split('|')[0].trim();

function materialOf(text: string) {
  if (/boucl/i.test(text)) return 'boucle';
  if (/velvet/i.test(text)) return 'velvet';
  if (/rattan|wicker|woven|cane/i.test(text)) return 'rattan';
  if (/brass|gold/i.test(text)) return 'brass';
  if (/leather/i.test(text)) return 'leather';
  if (/wood|oak|walnut|teak/i.test(text)) return 'wood';
  return 'leather';
}
function toneOf(text: string) {
  return TONES.find(([re]) => re.test(text))?.[1] ?? '#B07A4A';
}
/** Overall width in cm from "Overall dimensions (W × D × H): 92.5 × 39 × 26.4 in". */
function widthOf(facts: string) {
  const m = facts.match(/(\d+(?:\.\d+)?)\s*[×x]\s*\d+(?:\.\d+)?(?:\s*[×x]\s*\d+(?:\.\d+)?)?\s*(in|cm)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round(m[2].toLowerCase() === 'cm' ? n : n * 2.54);
}
function stableId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 1000 + ((h >>> 0) % 9_000_000);
}

export function liveProducts(items: LiveItem[]): HolmProduct[] {
  const used = new Set<number>();
  const out: HolmProduct[] = [];
  for (const item of items) {
    const full = cleanName(item.name);
    const w = words(full);
    // Curated match: same first name, and the most words in common with the curated line.
    let best: (typeof CURATED)[number] | null = null;
    let bestScore = 0;
    for (const c of CURATED) {
      if (used.has(c[0]) || w[0] !== c[1].toLowerCase()) continue;
      const score = 1 + words(c[2]).filter((x) => w.includes(x)).length;
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    const v0 = item.variants[0];
    if (!v0) continue;
    const typeGuess = TYPE_BY_CATEGORY[item.category.toLowerCase()] ?? (/sofa/i.test(full) ? 'sofa' : /light|lamp|pendant/i.test(full) ? 'lighting' : /bench/i.test(full) ? 'bench' : /ottoman/i.test(full) ? 'ottoman' : 'chair');
    const id = best ? best[0] : stableId(item.id);
    if (best) used.add(best[0]);
    const text = `${full} ${item.facts}`;
    out.push({
      id,
      lid: item.id,
      vid: v0.id,
      variants: item.variants,
      name: best ? best[1] : full.split(' ')[0],
      line: best ? best[2] : full.split(' ').slice(1).join(' ') || item.category,
      full,
      type: best ? best[3] : typeGuess,
      mat: best ? best[4] : materialOf(text),
      tone: best ? best[5] : toneOf(text),
      price: v0.retail / 100,
      trade: v0.trade === null ? null : v0.trade / 100,
      seats: best ? best[6] : (SEATS[typeGuess] ?? 1),
      oos: !item.inStock,
      note: item.description,
      facts: item.facts,
      img: v0.image || item.images[0] || '',
      imgs: item.images,
      ar: 1,
      sku: `HL-${String(id).padStart(3, '0')}`,
      likes: 0,
      widthCm: widthOf(item.facts),
      minimum: v0.minimum,
      increment: v0.increment,
    });
  }
  // Curated pieces first, in their designed order; the rest by name.
  return out.sort((a, b) => (a.id < 100 ? a.id : 1e9) - (b.id < 100 ? b.id : 1e9) || a.full.localeCompare(b.full));
}

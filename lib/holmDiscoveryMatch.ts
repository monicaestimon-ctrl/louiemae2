import { toneDistance } from './holmCatalogFacets';

export const HOLM_COLOR_WORDS: Readonly<Record<string, string>> = {
  cognac: '#A0612F', tan: '#B07A4A', brown: '#6B4A33', olive: '#5E6338', green: '#5E6338',
  ivory: '#E7DFD0', cream: '#E7DFD0', white: '#E7DFD0', grey: '#CFCBC4', gray: '#CFCBC4',
  black: '#2A2522', brass: '#B58D52', gold: '#B58D52', natural: '#C9A46C', warm: '#A0612F',
  light: '#E7DFD0', dark: '#2A2522', orange: '#B45E32', yellow: '#D6B44C', red: '#923F3F',
  pink: '#CA929B', purple: '#7B5D86', blue: '#33445E', navy: '#33445E',
};
type Candidate = { id: number; name: string; mat: string; type: string; tone: string; seats: number };
type Space = { label: string; picks: readonly number[]; mats: readonly string[] };

/** Current HOLM relevance semantics, independent of UI, prices and account state.
 * Call on the complete candidate set: its relative score cutoff is not a page filter. */
export function matchHolmQuery<T extends Candidate>(query: string, products: readonly T[], spaces: Readonly<Record<string, Space>> = {}): T[] {
  const words = query.trim().toLowerCase();
  if (!words) return [];
  const tokens = new Set(words.match(/[\p{L}\p{N}]+/gu) ?? []);
  const spaceEntries = Object.entries(spaces);
  const scored = products.map(product => {
    let score = 0;
    if (product.mat && product.mat !== 'unknown' && (words.includes(product.mat) || (product.mat === 'boucle' && words.includes('bouc')))) score += 5;
    if (product.type && (words.includes(product.type) || words.includes(product.type.replace(/s$/, '')))) score += 3;
    if (words.includes('light') && product.type === 'lighting') score += 2;
    if (words.includes('seat') && product.seats > 0) score += 1;
    for (const [word, color] of Object.entries(HOLM_COLOR_WORDS)) {
      if (tokens.has(word) && toneDistance(color, product.tone) < 60) score += 3;
    }
    for (const [key, space] of spaceEntries) {
      if (words.includes(key) || words.includes(space.label.toLowerCase().split(' ')[0])) {
        if (space.picks.includes(product.id)) score += 4;
        if (space.mats.includes(product.mat)) score += 1;
      }
    }
    if (product.name && words.includes(product.name.toLowerCase())) score += 8;
    return { product, score };
  });
  const top = Math.max(0, ...scored.map(item => item.score));
  return scored.filter(item => item.score > 0 && item.score >= top * 0.5)
    .sort((a, b) => b.score - a.score || a.product.id - b.product.id).map(item => item.product);
}

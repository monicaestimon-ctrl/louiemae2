import { toneDistance } from './holmCatalogFacets';
import { HOLM_COLOR_WORDS } from './holmDiscoveryMatch';
import { HOLM_SPACES } from './holmSpaces';

/** The index and the query use the same Latin-oriented normalized words. The
 * production search contract is any term, with prefix matching on the final term.
 * https://docs.convex.dev/search/text-search
 * Ranking is the search service's relevance order, not a page-local relative cutoff. */
export function discoveryWords(value: string): string[] {
  return (value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => [...word].length <= 32);
}
export function discoverySearchQuery(value: string) {
  if (value.length > 200) throw new Error('Use a search of 200 characters or fewer.');
  const terms = discoveryWords(value);
  if (terms.length > 16) throw new Error('Use up to 16 search words.');
  return { text: terms.join(' '), terms, empty: !value.trim() };
}
export function matchesDiscoverySearch(query: ReturnType<typeof discoverySearchQuery>, text: string) {
  if (query.empty) return true;
  const words = discoveryWords(text);
  return query.terms.some((term, index) => words.some(word => index === query.terms.length - 1 ? word.startsWith(term) : word === term));
}

const TYPE_ALIASES: Record<string, string> = { sofa: 'sofa sofas couch couches', sectional: 'sectional sectionals sofa',
  chair: 'chair chairs', stool: 'stool stools barstool barstools counterstool counterstools', lighting: 'lighting light lights lamp lamps',
  table: 'table tables', bench: 'bench benches', ottoman: 'ottoman ottomans' };
/** Search text contains public navigation hints only. No supplier facts or prices. */
export function discoverySearchDocument(value: { name: string; category: string; type: string; material: string; tone: string; seats: number; curatedId?: number }) {
  const colors = Object.entries(HOLM_COLOR_WORDS).filter(([, color]) => toneDistance(color, value.tone) < 60).map(([word]) => word);
  const spaces = Object.entries(HOLM_SPACES).filter(([, space]) => (value.curatedId !== undefined && space.picks.includes(value.curatedId)) || space.mats.includes(value.material))
    .flatMap(([key, space]) => [key, space.label]);
  const words = discoveryWords([value.name.slice(0, 256), value.category.slice(0, 128), TYPE_ALIASES[value.type] ?? '',
    value.material === 'unknown' ? '' : value.material, value.seats > 0 ? 'seat seating' : '', ...colors, ...spaces].join(' '));
  // Keep whole tokens so the length bound cannot create an accidental search term.
  const result: string[] = []; let size = 0;
  for (const word of words) { if (size + word.length + 1 > 640) break; result.push(word); size += word.length + 1; }
  return result.join(' ');
}

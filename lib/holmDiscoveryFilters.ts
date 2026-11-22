import { HOLM_MATERIAL_LABELS, HOLM_TYPE_LABELS, toneDistance } from './holmCatalogFacets';
import { discoverySearchQuery } from './holmDiscoverySearch';

export type DiscoveryRequest = {
  query: string; type: string; materials: string[]; tones: string[]; photoPalette: string[];
  maximumMinor: number | null; inStock: boolean; sort: 'relevance' | 'priceAsc' | 'priceDesc';
  channel: 'retail' | 'trade';
};
const unique = (values: string[]) => [...new Set(values)].sort();
function palette(values: string[]) {
  if (values.length > 8 || values.some(value => !/^#[a-f0-9]{6}$/i.test(value))) throw new Error('Use up to eight valid colors.');
  return unique(values.map(value => value.toUpperCase()));
}
export function normalizeDiscoveryRequest(request: DiscoveryRequest) {
  if (request.type !== 'all' && !Object.prototype.hasOwnProperty.call(HOLM_TYPE_LABELS, request.type)) throw new Error('Choose a valid product type.');
  if (request.materials.length > 12 || request.materials.some(value => !Object.prototype.hasOwnProperty.call(HOLM_MATERIAL_LABELS, value))) throw new Error('Choose valid materials.');
  if (request.maximumMinor !== null && (!Number.isSafeInteger(request.maximumMinor) || request.maximumMinor < 0 || request.maximumMinor > 10_000_000_000)) throw new Error('Choose a valid maximum price.');
  if (!['relevance', 'priceAsc', 'priceDesc'].includes(request.sort) || !['retail', 'trade'].includes(request.channel) || typeof request.inStock !== 'boolean') throw new Error('Choose valid catalog options.');
  return { query: discoverySearchQuery(request.query), type: request.type, materials: unique(request.materials),
    tones: palette(request.tones), photoPalette: palette(request.photoPalette), maximumMinor: request.maximumMinor,
    inStock: request.inStock, sort: request.sort, channel: request.channel };
}
export type NormalizedDiscoveryRequest = ReturnType<typeof normalizeDiscoveryRequest>;
export function matchesDiscoveryFacets(request: NormalizedDiscoveryRequest, item: { type: string; material: string; tone: string }) {
  return (request.type === 'all' || request.type === item.type)
    && (!request.materials.length || request.materials.includes(item.material))
    && (!request.tones.length || request.tones.some(color => toneDistance(color, item.tone) < 48));
}
/** Known tones are separate index buckets. Unknown tones come last, never a guessed match. */
export function discoveryToneOrder(knownTones: readonly string[], photoPalette: readonly string[]) {
  const tones = unique([...knownTones].map(value => value.toUpperCase()).filter(value => /^#[A-F0-9]{6}$/.test(value)));
  const distance = (tone: string) => Math.min(...photoPalette.map(color => toneDistance(color, tone)));
  return [...tones.sort((a, b) => distance(a) - distance(b) || a.localeCompare(b)), ''];
}

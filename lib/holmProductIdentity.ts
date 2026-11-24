import { CURATED_SOURCES } from '../trade/curatedSources';

/** Preserve existing saved numeric IDs. New persistence must also carry the source ID. */
export function holmLegacyId(productId: string): number {
  if (Object.prototype.hasOwnProperty.call(CURATED_SOURCES, productId)) return CURATED_SOURCES[productId];
  let hash = 2166136261;
  for (let index = 0; index < productId.length; index++) hash = Math.imul(hash ^ productId.charCodeAt(index), 16777619);
  return 1000 + ((hash >>> 0) % 9_000_000);
}

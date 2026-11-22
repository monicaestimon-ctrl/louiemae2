import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { holmCatalogFacets } from '../lib/holmCatalogFacets';
import { CURATED_SOURCES } from '../trade/curatedSources';

export const HOLM_DISCOVERY_VERSION = 1;
export type DiscoveryProjection = {
  listingId: Id<'commerceListings'>; productId: Id<'commerceProducts'>;
  version: number; name: string; nameKey: string; text: string;
  type: string; material: string; tone: string; seats: number;
};
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Navigation metadata only. No private prices, supplier facts, cost or eligibility authority. */
export function discoveryProjection(listing: Doc<'commerceListings'> | null): DiscoveryProjection | null {
  if (!listing?.published || listing.channel !== 'house') return null;
  const facets = holmCatalogFacets(listing.snapshot, CURATED_SOURCES[listing.productId]);
  const name = `${facets.name} ${facets.line}`.trim().slice(0, 256);
  return { listingId: listing._id, productId: listing.productId, version: HOLM_DISCOVERY_VERSION,
    name, nameKey: normalized(name), text: normalized(`${name} ${listing.snapshot.category} ${facets.type} ${facets.mat === 'unknown' ? '' : facets.mat}`).slice(0, 640),
    type: facets.type, material: facets.mat, tone: facets.tone, seats: facets.seats };
}
export function sameDiscovery(a: DiscoveryProjection | null, b: DiscoveryProjection | null) {
  return a === b || Boolean(a && b && a.listingId === b.listingId && a.productId === b.productId
    && a.version === b.version && a.name === b.name && a.nameKey === b.nameKey && a.text === b.text
    && a.type === b.type && a.material === b.material && a.tone === b.tone && a.seats === b.seats);
}
export async function syncDiscovery(ctx: Pick<MutationCtx, 'db'>, listingId: Id<'commerceListings'>, projection: DiscoveryProjection | null) {
  const old = await ctx.db.query('holmDiscoveryIndex').withIndex('by_listing', q => q.eq('listingId', listingId)).unique();
  if (!projection) { if (old) await ctx.db.delete(old._id); return; }
  if (!old) await ctx.db.insert('holmDiscoveryIndex', projection);
  else if (!sameDiscovery(old, projection)) await ctx.db.replace(old._id, projection);
}
export const discoveryState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('holmDiscoveryState')
  .withIndex('by_version', q => q.eq('version', HOLM_DISCOVERY_VERSION)).unique();

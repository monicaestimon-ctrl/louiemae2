import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { holmLegacyId } from '../lib/holmProductIdentity';

export const HOLM_IDENTITY_VERSION = 1;
export type HolmIdentity = { listingId: Id<'commerceListings'>; productId: Id<'commerceProducts'>; legacyId: number };
/** Identity is not eligibility. Unpublished sources retain identity, but reads recheck sellability. */
export function holmIdentityProjection(listing: Doc<'commerceListings'> | null): HolmIdentity | null {
  return listing?.channel === 'house' ? { listingId: listing._id, productId: listing.productId, legacyId: holmLegacyId(listing.productId) } : null;
}
export function sameHolmIdentity(a: HolmIdentity | null, b: HolmIdentity | null) {
  return a === b || Boolean(a && b && a.listingId === b.listingId && a.productId === b.productId && a.legacyId === b.legacyId);
}
export async function syncHolmIdentity(ctx: Pick<MutationCtx, 'db'>, listingId: Id<'commerceListings'>, expected: HolmIdentity | null) {
  const old = await ctx.db.query('holmCatalogIdentities').withIndex('by_listing', query => query.eq('listingId', listingId)).unique();
  if (!expected) { if (old) await ctx.db.delete(old._id); return; }
  if (!old) await ctx.db.insert('holmCatalogIdentities', expected);
  else if (!sameHolmIdentity(old, expected)) await ctx.db.replace(old._id, expected);
}
export const holmIdentityState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('holmIdentityState').withIndex('by_version', query => query.eq('version', HOLM_IDENTITY_VERSION)).unique();

import type { Doc } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';
import { retailDelivery } from '../lib/retailLaunch';

/** A live option is authoritative. Only an absent, selectively omitted option may use its retained identity. */
export function ashcroftListingIdentity(listing: Doc<'commerceListings'>, cv: Doc<'catVariants'>) {
  const options = listing.snapshot.variants.filter(v => v.id === cv.legacyVariantId);
  const routes = listing.fulfillment?.filter(v => v.id === cv.legacyVariantId) ?? [];
  const saved = listing.ashcroftIdentityOptions?.filter(v => v.id === cv.legacyVariantId) ?? [];
  const valid = options.length || routes.length
    ? options.length === 1 && routes.length === 1 && routes[0].sku === cv.supplierSku
      && options[0].minimum === cv.orderMinimumPacks && options[0].increment === cv.orderIncrementPacks
    : saved.length === 1 && saved[0].sku === cv.supplierSku
      && saved[0].minimum === cv.orderMinimumPacks && saved[0].increment === cv.orderIncrementPacks;
  if (!cv.legacyVariantId || cv.optionKey !== cv.legacyVariantId || cv.packId !== '1' || cv.piecesPerPack !== 1 || !valid)
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Exact legacy Ashcroft selling-unit identity required');
  return cv.legacyVariantId;
}

export function assertAshcroftChannelDelivery(listings: Doc<'commerceListings'>[]) {
  const live = listings.filter(l => l.published);
  if (live.length < 2 || !live.some(l => l.pricingMode === 'approved_v2')) return;
  const rates = live.map(l => retailDelivery(l.snapshot.category, l.snapshot.name));
  if (rates.some(r => !r || r.freight !== rates[0]?.freight || r.delivery !== rates[0]?.delivery))
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Ashcroft channel delivery models differ; review both listings before restoring');
}

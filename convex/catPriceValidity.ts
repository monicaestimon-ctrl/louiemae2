import type { Doc, Id } from './_generated/dataModel';

/** Approved prices belong to one exact variant/channel and a bounded effective window. */
export function isCurrentPrice(price: Doc<'catPriceRevisions'> | null, variantId: Id<'catVariants'>, channel: 'retail' | 'trade', now = Date.now()): price is Doc<'catPriceRevisions'> {
  return !!price && price.variantId === variantId && price.channel === channel &&
    price.status === 'approved' && Number.isSafeInteger(price.packPriceMinor) && price.packPriceMinor > 0 &&
    Number.isSafeInteger(price.effectiveFrom) && price.effectiveFrom <= now &&
    (price.effectiveTo === undefined || (Number.isSafeInteger(price.effectiveTo) && price.effectiveTo > now));
}

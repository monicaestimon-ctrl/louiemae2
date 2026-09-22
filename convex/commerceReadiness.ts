import type { QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { evaluateProductCjReadiness } from '../lib/cjFulfillmentReadiness';
export async function listingReady(
  ctx: Pick<QueryCtx, 'db'>,
  product: Doc<'commerceProducts'>,
  listing: Doc<'commerceListings'>
) {
  if (!listing.published || (product.provider === 'owner_managed' && listing.channel !== 'house'))
    return false;
  if (product.provider !== 'cj') return true;
  const source = product.cjProductId ? await ctx.db.get(product.cjProductId) : null;
  if (!source || !evaluateProductCjReadiness(source).ready) return false;
  return (
    listing.fulfillment?.every((v) => {
      const mapped = source.variants?.length
        ? source.variants.find((x) => x.id === v.id && x.inStock)
        : source;
      return (
        !!mapped &&
        !!v.cjVariantId &&
        !!v.cjSku &&
        mapped.cjVariantId === v.cjVariantId &&
        mapped.cjSku === v.cjSku
      );
    }) === true
  );
}

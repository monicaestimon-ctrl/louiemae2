import { isCjProductStorefrontReady, type CjReadinessProduct } from './cjFulfillmentReadiness';

/** Shared legacy publication authority for storefront detail and public search. */
export function isProductVisibleOnStorefront(
  product: CjReadinessProduct & { storefrontStatus?: 'published' | 'hidden' | 'next_launch' }
) {
  return (
    (!product.storefrontStatus || product.storefrontStatus === 'published') &&
    isCjProductStorefrontReady(product) &&
    product.inStock !== false &&
    product.cjInventoryStatus !== 'out_of_stock'
  );
}

import { Product } from '../types';

export const isProductVisibleOnStorefront = (product: Product): boolean => {
  const visibilityReady = !product.storefrontStatus || product.storefrontStatus === 'published';
  const fulfillmentReady = !product.cjSourcingStatus
    || product.cjSourcingStatus === 'none'
    || product.cjSourcingStatus === 'approved';

  return visibilityReady && fulfillmentReady;
};

export const productStorefrontStatusLabel = (product: Product): string => {
  if (product.storefrontStatus === 'hidden') return 'Hidden';
  if (product.storefrontStatus === 'next_launch') return 'Next Launch';
  return 'Published';
};

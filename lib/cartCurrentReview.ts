import type { Product, ProductVariant } from '../types';
import type { CartItem } from '../contexts/CartContext';
import { publicProductSnapshot } from './publicProductBootstrap';
import { publicQuantityRules } from './orderQuantity';
import { reviewQuantity } from './cartQuantityReview';

export type CurrentCartReview = {
  status: 'pending' | 'error' | 'unavailable' | 'changed' | 'quantity' | 'ready';
  product?: Product;
  variant?: ProductVariant;
  choices: number[];
  fingerprint: string;
};
const cents = (value: number) => Math.round(value * 100);
const rulesKey = (variant?: ProductVariant) => {
  const rules = variant?.quantityRules;
  return rules && publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack);
};

/** Current public detail is display evidence; only server checkout can authorize a sale. */
export function reviewCartItem(item: CartItem, value: unknown): CurrentCartReview {
  const blocked = (status: CurrentCartReview['status']): CurrentCartReview => ({
    status,
    choices: [],
    fingerprint: status,
  });
  if (value === undefined) return blocked('pending');
  if (value instanceof Error) return blocked('error');
  const product = publicProductSnapshot(value);
  if (
    !product ||
    product.id !== item.product.id ||
    product.fulfillmentProvider !== item.product.fulfillmentProvider
  )
    return blocked('unavailable');
  // Preserve the originally saved identity. A removed option cannot become a different first option.
  const savedVariant = item.selectedVariant ?? item.product.variants?.[0];
  if (!savedVariant) return blocked('unavailable');
  const variant = product.variants?.find((option) => option.id === savedVariant.id);
  if (!variant || !product.inStock || !variant.inStock || !rulesKey(variant))
    return blocked('unavailable');
  const quantity = reviewQuantity(item.quantity, variant.quantityRules);
  const fingerprint = JSON.stringify([
    product.id,
    variant.id,
    cents(product.price + variant.priceAdjustment),
    cents(product.deliveryFee ?? 0),
    rulesKey(variant),
    item.quantity,
  ]);
  const changed =
    cents(product.price + variant.priceAdjustment) !==
      cents(item.product.price + savedVariant.priceAdjustment) ||
    cents(product.deliveryFee ?? 0) !== cents(item.product.deliveryFee ?? 0) ||
    JSON.stringify(rulesKey(variant)) !== JSON.stringify(rulesKey(savedVariant));
  return {
    status: changed ? 'changed' : quantity.valid ? 'ready' : 'quantity',
    product,
    variant,
    choices: quantity.choices,
    fingerprint,
  };
}

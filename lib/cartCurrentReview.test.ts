import { expect, it } from 'vitest';
import { reviewCartItem } from './cartCurrentReview';
import type { CartItem } from '../contexts/CartContext';
const variant = {
  id: 'tan',
  name: 'Tan',
  inStock: true,
  priceAdjustment: 10,
  quantityRules: { minimum: 3, increment: 2 },
};
const product = {
  id: 'chair',
  name: 'Chair',
  description: '',
  category: 'Chair',
  collection: 'furniture',
  images: [],
  price: 100,
  inStock: true,
  fulfillmentProvider: 'ashcroft' as const,
  variants: [variant],
  deliveryFee: 20,
};
const item: CartItem = { product, selectedVariant: variant, quantity: 3 };
it('requires matching current product, supplier and saved option identities', () => {
  expect(reviewCartItem(item, product).status).toBe('ready');
  for (const other of [
    null,
    { ...product, id: 'other' },
    { ...product, fulfillmentProvider: 'zuo' },
    { ...product, variants: [{ ...variant, id: 'other' }] },
  ])
    expect(reviewCartItem(item, other).status).toBe('unavailable');
});
it('distinguishes pending and transport failure from confirmed unavailability', () => {
  expect(reviewCartItem(item, undefined).status).toBe('pending');
  expect(reviewCartItem(item, new Error('offline')).status).toBe('error');
  expect(reviewCartItem(item, { ...product, inStock: false }).status).toBe('unavailable');
});
it('requires explicit review of price, delivery or selling rule changes', () => {
  for (const current of [
    { ...product, price: 101 },
    { ...product, deliveryFee: 30 },
    { ...product, variants: [{ ...variant, quantityRules: { minimum: 1, increment: 1 } }] },
  ]) {
    const review = reviewCartItem(item, current);
    expect(review.status).toBe('changed');
    expect(review.fingerprint).not.toBe(reviewCartItem(item, product).fingerprint);
    expect(item.product.price).toBe(100);
  }
});
it('preserves a combined invalid quantity and proposes explicit corrections', () => {
  const combined = { ...item, quantity: 6 };
  expect(reviewCartItem(combined, product)).toMatchObject({ status: 'quantity', choices: [5, 7] });
  expect(combined.quantity).toBe(6);
});
it('does not restore missing rules or switch to the new first variant', () => {
  expect(
    reviewCartItem(item, { ...product, variants: [{ ...variant, quantityRules: undefined }] })
      .status
  ).toBe('unavailable');
  const unselected = { ...item, selectedVariant: undefined };
  expect(
    reviewCartItem(unselected, { ...product, variants: [{ ...variant, id: 'other' }, variant] })
      .variant?.id
  ).toBe('tan');
  expect(
    reviewCartItem({ ...unselected, product: { ...product, variants: undefined } }, product).status
  ).toBe('unavailable');
});

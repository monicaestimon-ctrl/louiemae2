import { expect, it } from 'vitest';
import { reviewCartItem as reviewEnvelope } from './cartCurrentReview';
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
const reviewCartItem = (item: CartItem, value: unknown) =>
  reviewEnvelope(
    item,
    value === undefined || value instanceof Error || value === null
      ? value
      : {
          product: value,
          quantity: item.quantity,
          variantId: (item.selectedVariant ?? item.product.variants?.[0])?.id,
          maximum: 20,
        }
  );
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

it('offers a valid correction for the current source quantity and the Ashcroft limit', () => {
  const one = { ...variant, quantityRules: { minimum: 1, increment: 1 } };
  const p = { ...product, variants: [one] };
  const review = (quantity: number, maximum: number) =>
    reviewEnvelope(
      { product: p, selectedVariant: one, quantity },
      { product: p, variantId: one.id, quantity, maximum }
    );
  expect(review(5, 3)).toMatchObject({ status: 'quantity', choices: [3] });
  expect(review(20, 20)).toMatchObject({ status: 'ready', choices: [19] });
  expect(review(21, 20)).toMatchObject({ status: 'quantity', choices: [20] });
  expect(review(1, 0).status).toBe('unavailable');
});
it.each(['', 'x'.repeat(301)])('rejects current names that cannot be saved', (name) => {
  expect(reviewCartItem(item, { ...product, name }).status).toBe('unavailable');
});
it('rejects a quantity result belonging to a different request or absent envelope', () => {
  expect(reviewEnvelope(item, product).status).toBe('unavailable');
  expect(reviewEnvelope(item, { product, quantity: 5, variantId: 'tan', maximum: 20 }).status).toBe(
    'unavailable'
  );
});

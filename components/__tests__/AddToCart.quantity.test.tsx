import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AddToCartButton } from '../cart/AddToCartButton';
import type { Product } from '../../types';
const add = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/CartContext', () => ({ useCart: () => ({ addToCart: add }) }));
const variant = {
  id: 'tan',
  name: 'Tan',
  inStock: true,
  priceAdjustment: 10,
  quantityRules: { minimum: 3, increment: 2, piecesPerPack: 2 },
};
const product: Product = {
  id: 'chair',
  name: 'Chair',
  description: '',
  category: 'Chair',
  collection: 'furniture',
  price: 100,
  images: [],
  inStock: true,
  fulfillmentProvider: 'zuo',
  variants: [variant],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('discloses the minimum pack count, physical basis and merchandise amount before adding', () => {
  render(<AddToCartButton product={product} selectedVariant={variant} />);
  fireEvent.click(
    screen.getByRole('button', { name: /Add 3 packs \(2 pieces per pack\) to Cart · \$330.00/ })
  );
  expect(add).toHaveBeenCalledWith(product, 3, variant);
});
it('does not guess one when current selling rules are missing', () => {
  const unknown = { ...variant, quantityRules: undefined };
  render(
    <AddToCartButton product={{ ...product, variants: [unknown] }} selectedVariant={unknown} />
  );
  expect(
    screen.getByRole('button', { name: 'Refresh product details before adding' })
  ).toBeDisabled();
  expect(add).not.toHaveBeenCalled();
});
it('requires selection when multiple options need an explicit choice', () => {
  render(<AddToCartButton product={product} variantRequired />);
  expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
  expect(add).not.toHaveBeenCalled();
});

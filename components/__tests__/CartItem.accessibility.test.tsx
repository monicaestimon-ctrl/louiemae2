import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CartItem } from '../cart/CartItem';
import type { Product } from '../../types';
const cart = vi.hoisted(() => ({ removeFromCart: vi.fn(), updateQuantity: vi.fn() }));
vi.mock('../../contexts/CartContext', () => ({ useCart: () => cart }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('distinguishes actions for two variants of the same product', () => {
  const product: Product = {
    id: 'chair',
    name: 'Chair',
    price: 100,
    description: '',
    images: [],
    category: 'Chairs',
    collection: 'furniture',
  };
  render(
    <>
      {['Cream', 'Black'].map((name) => (
        <CartItem
          key={name}
          item={{
            product,
            quantity: 2,
            selectedVariant: { id: name, name, priceAdjustment: 0, inStock: true },
          }}
        />
      ))}
    </>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Chair — Cream' }));
  expect(cart.updateQuantity).toHaveBeenCalledWith('chair', 3, 'Cream');
  fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Chair — Black' }));
  expect(cart.updateQuantity).toHaveBeenCalledWith('chair', 1, 'Black');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Chair — Black' }));
  expect(cart.removeFromCart).toHaveBeenCalledWith('chair', 'Black');
});

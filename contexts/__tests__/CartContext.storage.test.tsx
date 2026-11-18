import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../CartContext';
import type { Product } from '../../types';
const product: Product = {
  id: 'chair',
  name: 'Chair',
  price: 100,
  images: [],
  description: '',
  category: 'Chairs',
  collection: 'furniture',
  fulfillmentProvider: 'ashcroft',
};
function Controls() {
  const c = useCart();
  return (
    <>
      <button onClick={() => c.addToCart(product, 3)}>Add three</button>
      <button onClick={() => c.updateQuantity('chair', NaN)}>Invalid</button>
      <button onClick={() => c.addToCart(product, 9999)}>Exceed total</button>
      <button onClick={() => c.clearCart()}>Clear</button>
      <p data-testid="quantity">{c.itemCount}</p>
      <p role="status">{c.notice}</p>
    </>
  );
}
function App() {
  return (
    <CartProvider>
      <Controls />
    </CartProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it('retains in-memory items when browser storage is unavailable', () => {
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('Quota');
  });
  render(<App />);
  fireEvent.click(screen.getByText('Add three'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('3');
  expect(screen.getByRole('status')).toHaveTextContent('during this visit');
  fireEvent.click(screen.getByText('Clear'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('0');
});
it('contains malformed saved data and keeps the cart usable', () => {
  localStorage.setItem('louiemae_ashcroft_cart_v1', '{"items":"bad"}');
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('could not be restored');
  fireEvent.click(screen.getByText('Add three'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('3');
});
it('preserves additions and rejects unsafe updates without rounding or deleting items', () => {
  render(<App />);
  fireEvent.click(screen.getByText('Add three'));
  fireEvent.click(screen.getByText('Add three'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('6');
  fireEvent.click(screen.getByText('Invalid'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('6');
  fireEvent.click(screen.getByText('Exceed total'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('6');
  expect(screen.getByRole('status')).toHaveTextContent('project quote');
});

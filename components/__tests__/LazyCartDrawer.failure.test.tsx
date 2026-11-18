import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { LazyCartDrawer } from '../cart/LazyCartDrawer';
vi.mock('../cart/CartDrawer', () => {
  throw Error('Synthetic module failure');
});
function Controls() {
  const cart = useCart();
  return <button onClick={cart.openCart}>Open cart</button>;
}
it('contains failed drawer imports and preserves saved items', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.setItem(
    'louiemae_ashcroft_cart_v1',
    JSON.stringify([{ product: { id: 'fixture', name: 'Saved chair', price: 100, fulfillmentProvider: 'ashcroft' }, quantity: 2 }])
  );
  render(
    <CartProvider>
      <Controls />
      <LazyCartDrawer />
    </CartProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened');
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close cart' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(localStorage.getItem('louiemae_ashcroft_cart_v1')!)[0].quantity).toBe(2);
  log.mockRestore();
  localStorage.clear();
});

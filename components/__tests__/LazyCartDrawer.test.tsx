import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { LazyCartDrawer } from '../cart/LazyCartDrawer';
const calls = vi.hoisted(() => ({ imports: 0 }));
vi.mock('../cart/CartDrawer', () => {
  calls.imports++;
  return {
    default: function Drawer() {
      const cart = useCart();
      const [value, setValue] = useState('');
      return cart.isOpen ? (
        <div>
          <input
            aria-label="Owned draft"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button onClick={cart.closeCart}>Close fixture</button>
        </div>
      ) : null;
    },
  };
});
function Controls() {
  const cart = useCart();
  return <button onClick={cart.openCart}>Open cart</button>;
}
it('loads the drawer only on intent and retains its owner after closing', async () => {
  render(
    <CartProvider>
      <Controls />
      <LazyCartDrawer />
    </CartProvider>
  );
  expect(calls.imports).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  const field = await screen.findByLabelText('Owned draft');
  fireEvent.change(field, { target: { value: 'Retained' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close fixture' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(await screen.findByLabelText('Owned draft')).toHaveValue('Retained');
  expect(calls.imports).toBe(1);
});

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { ModuleLoadError } from '../../lib/moduleRecovery';

let failing = true;
function Page() { if (failing) throw new Error('page failed'); return <p>Recovered content</p>; }
function CartProof() { const cart = useCart(); return <span data-testid="cart-count">{cart.itemCount}</span>; }
function Shell({ route = 'home' }: { route?: string }) {
  return <CartProvider><nav>Persistent navigation</nav><CartProof /><ErrorBoundary key={route} retryLocally><Page /></ErrorBoundary></CartProvider>;
}
beforeEach(() => {
  failing = true;
  localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify([{ product: { id: 'chair', price: 100 }, quantity: 2 }]));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
it('offers a genuine reload for cached lazy module errors instead of a futile local remount', () => {
  function FailedModule(): never { throw new ModuleLoadError(); }
  render(<ErrorBoundary retryLocally><FailedModule /></ErrorBoundary>);
  expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});
it('preserves navigation and cart state while retrying only the failed page', () => {
  render(<Shell />);
  expect(screen.getByRole('navigation')).toBeTruthy();
  expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-error-heading');
  expect(screen.getByTestId('cart-count').textContent).toBe('2');
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Recovered content')).toBeTruthy();
  expect(screen.getByTestId('cart-count').textContent).toBe('2');
});
it('allows navigation away from a failed route without resetting the cart provider', () => {
  const view = render(<Shell />);
  failing = false;
  view.rerender(<Shell route="shop" />);
  expect(screen.getByText('Recovered content')).toBeTruthy();
  expect(screen.getByTestId('cart-count').textContent).toBe('2');
});

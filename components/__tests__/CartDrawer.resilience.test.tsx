import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { CartDrawer } from '../cart/CartDrawer';

const mocks = vi.hoisted(() => ({ credit: undefined as unknown, queries: vi.fn(), token: 'signed-in', checkoutFails: false }));
vi.mock('convex/react', () => ({ useQueries: (queries: unknown) => { mocks.queries(queries); return { credit: mocks.credit }; } }));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => mocks.token }));
vi.mock('../cart/CartItem', () => ({ default: () => <p>Saved chair</p> }));
vi.mock('../delivery/CheckoutV2', () => ({ default: () => { if (mocks.checkoutFails) throw new Error('checkout offline'); return <p>Verified checkout fixture</p>; } }));
function Controls() { const cart = useCart(); return <><button onClick={cart.openCart}>Open cart</button><span data-testid="count">{cart.itemCount}</span></>; }
function App() { return <CartProvider><Controls /><CartDrawer /></CartProvider>; }
function seed(provider = 'ashcroft') {
  localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify([{ product: { id: 'chair', name: 'Chair', price: 100, fulfillmentProvider: provider }, quantity: 2 }]));
}
beforeEach(() => { seed(); mocks.credit = undefined; mocks.token = 'signed-in'; mocks.checkoutFails = false; mocks.queries.mockClear(); vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('does not subscribe to credit for a closed or anonymous cart', () => {
  render(<App />);
  expect(mocks.queries).toHaveBeenLastCalledWith({});
  mocks.token = '';
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(mocks.queries).toHaveBeenLastCalledWith({});
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).not.toBeDisabled();
});
it('blocks checkout on unknown or failed credit while retaining the cart and allowing recovery', () => {
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole('status').textContent).toContain('could not be verified');
  mocks.credit = new Error('private credit failure');
  view.rerender(<App />);
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  expect(screen.getByTestId('count').textContent).toBe('2');
  mocks.credit = { balanceCents: 0, autoApply: false };
  view.rerender(<App />);
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).not.toBeDisabled();
});
it('contains v2 checkout errors and retries after closing and reopening without losing items', () => {
  seed('zuo'); mocks.checkoutFails = true;
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(screen.getByRole('alert').textContent).toContain('Checkout is temporarily unavailable');
  expect(screen.getByTestId('count').textContent).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Close cart' }));
  mocks.checkoutFails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(screen.getByText('Verified checkout fixture')).toBeTruthy();
  expect(screen.getByTestId('count').textContent).toBe('2');
});

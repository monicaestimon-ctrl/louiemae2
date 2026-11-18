import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import CartDrawer from '../cart/CartDrawer';
const source = vi.hoisted(() => ({
  details: {} as Record<string, unknown>,
  queries: vi.fn(),
  remember: vi.fn(),
}));
vi.mock('../../lib/delivery/checkoutReturn', () => ({
  rememberCheckout: source.remember,
  cartLines: () => [],
}));
vi.mock('convex/react', () => ({
  useQueries: (queries: Record<string, unknown>) => {
    source.queries(queries);
    return Object.fromEntries(Object.keys(queries).map((key) => [key, source.details[key]]));
  },
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => null }));
vi.mock('../delivery/CheckoutV2', () => ({
  default: ({ reviewBlocked }: { reviewBlocked: boolean }) => (
    <button disabled={reviewBlocked}>Synthetic v2 checkout</button>
  ),
}));
const option = {
  id: 'tan',
  name: 'Tan',
  priceAdjustment: 10,
  inStock: true,
  quantityRules: { minimum: 3, increment: 2 },
};
const product = {
  id: 'chair',
  name: 'Chair',
  description: '',
  images: [],
  price: 100,
  category: 'Chair',
  collection: 'furniture',
  fulfillmentProvider: 'ashcroft',
  inStock: true,
  variants: [option],
};
function Controls() {
  const cart = useCart();
  return (
    <>
      <button onClick={cart.openCart}>Open cart</button>
      <output data-testid="quantity">{cart.items[0]?.quantity}</output>
    </>
  );
}
function App() {
  return (
    <CartProvider>
      <Controls />
      <CartDrawer />
    </CartProvider>
  );
}
function seed(quantity = 3, provider = 'ashcroft') {
  localStorage.setItem(
    'louiemae_ashcroft_cart_v1',
    JSON.stringify([
      { product: { ...product, fulfillmentProvider: provider }, quantity, selectedVariant: option },
    ])
  );
}
beforeEach(() => {
  localStorage.clear();
  source.details = { chair: product };
  source.queries.mockClear();
  source.remember.mockClear();
  seed();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  localStorage.clear();
});
it('subscribes only while open and requires explicit review of an updated price', () => {
  source.details.chair = { ...product, price: 125 };
  render(<App />);
  expect(source.queries.mock.calls.every(([queries]) => !Object.keys(queries).length)).toBe(true);
  fireEvent.click(screen.getByText('Open cart'));
  expect(screen.getByText(/\$135.00 each/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Accept updated details for Chair — Tan' }));
  expect(screen.getByRole('heading', { name: 'Chair' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  expect(screen.getByTestId('quantity')).toHaveTextContent('3');
});
it('keeps invalid combined quantities until the customer chooses a visible correction', () => {
  seed(6);
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('6');
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose 5 · $550.00' }));
  expect(screen.getByRole('heading', { name: 'Chair' })).toHaveFocus();
  expect(screen.getByTestId('quantity')).toHaveTextContent('5');
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
});
it('keeps unavailable saved options and blocks both checkout paths', () => {
  seed(3, 'zuo');
  source.details.chair = null;
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  expect(screen.getByText(/cannot currently be purchased/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Synthetic v2 checkout' })).toBeDisabled();
  expect(screen.getByTestId('quantity')).toHaveTextContent('3');
});
it('times out an unresolved detail and commits an empty subscription before retry', () => {
  vi.useFakeTimers();
  source.details.chair = undefined;
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  act(() => vi.advanceTimersByTime(10001));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  source.queries.mockClear();
  source.details.chair = product;
  fireEvent.click(screen.getByRole('button', { name: 'Retry current product details' }));
  expect(source.queries.mock.calls.some(([queries]) => !Object.keys(queries).length)).toBe(true);
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
});
it('preserves a legacy fallback option while accepting its current price', () => {
  localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify([{ product, quantity: 3 }]));
  source.details.chair = { ...product, price: 125, variants: [{ ...option, id: 'other' }, option] };
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  fireEvent.click(screen.getByRole('button', { name: 'Accept updated details for Chair' }));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  expect(screen.getByText('$405.00')).toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem('louiemae_ashcroft_cart_v1')!)[0];
  expect(saved.product.variants[0].id).toBe('tan');
  expect(saved.quantity).toBe(3);
});
it('ignores a synthetic legacy checkout response after stock withdrawal', async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', request);
  vi.stubEnv('VITE_CONVEX_URL', 'https://synthetic.convex.cloud');
  const view = render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
  expect(request).toHaveBeenCalledTimes(1);
  source.details.chair = { ...product, inStock: false };
  view.rerender(<App />);
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({
        url: 'https://example.invalid/synthetic-checkout',
        sessionId: 'synthetic-session',
      }),
    })
  );
  expect(source.remember).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
});

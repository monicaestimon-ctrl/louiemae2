import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { useQueries } from 'convex/react';
import { api } from '../../convex/_generated/api';
import CartDrawer from '../cart/CartDrawer';
const source = vi.hoisted(() => ({
  details: {} as Record<string, unknown>,
  queries: vi.fn(),
  remember: vi.fn(),
  token: null as string | null,
  credit: undefined as unknown,
  failAttemptZero: false,
}));
vi.mock('../../lib/delivery/checkoutReturn', () => ({
  rememberCheckout: source.remember,
  cartLines: () => [],
}));
vi.mock('convex/react', () => ({
  useQueries: (
    queries: Record<
      string,
      { args: { id?: string; variantId?: string; quantity?: number; attempt?: number } }
    >
  ) => {
    source.queries(queries);
    return Object.fromEntries(
      Object.entries(queries).map(([key, { args }]) => {
        if (key === 'credit') return [key, source.credit];
        if (source.failAttemptZero && args.attempt === 0) return [key, new Error('Cached failure')];
        const product = source.details[args.id!];
        return [
          key,
          product === undefined || product === null || product instanceof Error
            ? product
            : { product, variantId: args.variantId, quantity: args.quantity, maximum: 20 },
        ];
      })
    );
  },
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => source.token }));
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
  source.token = null;
  source.credit = undefined;
  source.failAttemptZero = false;
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
it('times out an unresolved detail and changes the product query identity on retry', () => {
  vi.useFakeTimers();
  source.details.chair = undefined;
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  act(() => vi.advanceTimersByTime(10001));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  source.queries.mockClear();
  source.details.chair = product;
  fireEvent.click(screen.getByRole('button', { name: 'Retry current product details' }));
  expect(
    source.queries.mock.calls
      .flatMap(
        ([queries]) => Object.values(queries) as { args: { id?: string; attempt?: number } }[]
      )
      .filter((query) => query.args.id === 'chair')
      .map((query) => query.args.attempt)
  ).toContain(1);
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

it('retries independently while another subscriber retains the failed request', () => {
  source.failAttemptZero = true;
  function OtherSubscriber() {
    const result = useQueries({
      held: {
        query: api.retailLaunch.cartReview,
        args: { id: 'chair', variantId: 'tan', quantity: 3, attempt: 0 },
      },
    });
    return (
      <p>{result.held instanceof Error ? 'Other watch still failed' : 'Other watch changed'}</p>
    );
  }
  render(
    <>
      <OtherSubscriber />
      <App />
    </>
  );
  fireEvent.click(screen.getByText('Open cart'));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry current product details' }));
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  expect(screen.getByText('Other watch still failed')).toBeInTheDocument();
});
it('does not discard its own checkout response when a credit hold lowers the balance', async () => {
  source.token = 'synthetic-member';
  source.credit = { autoApply: true, balanceCents: 2000 };
  let finish!: (value: unknown) => void;
  const request = vi.fn(
    (_input: unknown, _options: { body: string }) =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', request);
  vi.stubEnv('VITE_CONVEX_URL', 'https://synthetic.convex.cloud');
  const view = render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
  const submitted = JSON.parse(request.mock.calls[0][1].body);
  expect(submitted.useCredit).toBe(true);
  expect(submitted.reviewVersion).toBe(1);
  expect(submitted.items[0].reviewed).toEqual({ merchandiseMinor: 11000, deliveryMinor: 0 });
  source.credit = { autoApply: true, balanceCents: 0 };
  view.rerender(<App />);
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({ url: '#synthetic-checkout', sessionId: 'synthetic-session' }),
    })
  );
  expect(source.remember).toHaveBeenCalledWith('synthetic-session', undefined, []);
});
it('preserves an oversized saved cart and gives removal guidance instead of an ineffective retry', () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({
    product: { ...product, id: 'chair' + i },
    selectedVariant: option,
    quantity: 3,
  }));
  localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify(rows));
  render(<App />);
  fireEvent.click(screen.getByText('Open cart'));
  expect(screen.getByText(/Retry cannot resolve this limit/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry current product details' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('louiemae_ashcroft_cart_v1')!)).toHaveLength(31);
});

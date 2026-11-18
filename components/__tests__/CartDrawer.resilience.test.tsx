import React, { useEffect, useState } from 'react';
import type { CheckoutDraftRef } from '../../lib/delivery/checkoutDraft';
import { STANDARD_ACCESS } from '../../lib/delivery/destination';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../../contexts/CartContext';
import { CartDrawer } from '../cart/CartDrawer';

const mocks = vi.hoisted(() => ({
  credit: undefined as unknown,
  product: undefined as unknown,
  queries: vi.fn(),
  token: 'signed-in',
  checkoutFails: false,
  draftMode: false,
}));
vi.mock('convex/react', () => ({
  useQueries: (queries: unknown) => {
    mocks.queries(queries);
    return Object.fromEntries(Object.entries(queries as Record<string,{args:{id?:string;variantId?:string;quantity?:number}}>).map(([key,{args}])=>[key,key==='credit'?mocks.credit:mocks.product===undefined || mocks.product===null || mocks.product instanceof Error?mocks.product:{product:mocks.product,variantId:args.variantId,quantity:args.quantity,maximum:20}]));
  },
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => mocks.token }));
vi.mock('../cart/CartItem', () => ({ default: () => <p>Saved chair</p> }));
vi.mock('../delivery/CheckoutV2', () => ({
  default: function Checkout({ draftRef }: { draftRef: CheckoutDraftRef }) {
    const [email, setEmail] = useState(() => draftRef.current?.email ?? '');
    useEffect(() => {
      if (mocks.draftMode)
        draftRef.current = {
          address: {
            recipientName: '',
            phone: '',
            line1: '',
            line2: '',
            city: '',
            state: 'CA',
            postalCode: '',
            country: 'US',
          },
          access: STANDARD_ACCESS,
          email,
          useCredit: false,
        };
    }, [draftRef, email]);
    if (mocks.checkoutFails) throw new Error('checkout offline');
    return mocks.draftMode ? (
      <input
        aria-label="Fixture contact email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
    ) : (
      <p>Verified checkout fixture</p>
    );
  },
}));
function Controls() {
  const cart = useCart();
  const [initialItems] = useState(cart.items);
  return (
    <>
      <button onClick={cart.openCart}>Open cart</button>
      <button onClick={cart.clearCart}>Clear cart</button>
      <button
        onClick={() => initialItems.forEach((item) => cart.addToCart(item.product, item.quantity))}
      >
        Restore fixture items
      </button>
      <span data-testid="count">{cart.itemCount}</span>
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
function seed(provider = 'ashcroft') {
  mocks.product = {id:'chair',name:'Chair',description:'',images:[],category:'Chair',collection:'furniture',price:100,inStock:true,fulfillmentProvider:provider,variants:[{id:'standard',name:'Standard',inStock:true,priceAdjustment:0,quantityRules:{minimum:1,increment:1}}]};
  localStorage.setItem(
    'louiemae_ashcroft_cart_v1',
    JSON.stringify([
      {
        product: mocks.product,
        quantity: 2,
      },
    ])
  );
}
beforeEach(() => {
  seed();
  mocks.credit = undefined;
  mocks.token = 'signed-in';
  mocks.checkoutFails = false;
  mocks.draftMode = false;
  mocks.queries.mockClear();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
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
  mocks.credit = null;
  view.rerender(<App />);
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  mocks.credit = { balanceCents: 0, autoApply: false };
  view.rerender(<App />);
  expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).not.toBeDisabled();
});
it('contains v2 checkout errors and retries after closing and reopening without losing items', () => {
  seed('zuo');
  mocks.checkoutFails = true;
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

it('retains a draft across closes and token renewal, but clears it for another account and logout', () => {
  seed('zuo');
  mocks.draftMode = true;
  const token = (sub: string, iat: number) =>
    'header.' + globalThis.btoa(JSON.stringify({ sub, iat })) + '.signature';
  mocks.token = token('customer-a', 1);
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  fireEvent.change(screen.getByLabelText('Fixture contact email'), {
    target: { value: 'private@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close cart' }));
  mocks.token = token('customer-a', 2);
  view.rerender(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  expect(screen.getByLabelText('Fixture contact email')).toHaveValue('private@example.test');
  mocks.token = token('customer-b', 1);
  view.rerender(<App />);
  expect(screen.getByLabelText('Fixture contact email')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Fixture contact email'), {
    target: { value: 'second@example.test' },
  });
  mocks.token = '';
  view.rerender(<App />);
  expect(screen.getByLabelText('Fixture contact email')).toHaveValue('');
  expect(screen.getByTestId('count')).toHaveTextContent('2');
});

it('clears contact inputs when an emptied cart is filled again', () => {
  seed('zuo');
  mocks.draftMode = true;
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
  fireEvent.change(screen.getByLabelText('Fixture contact email'), {
    target: { value: 'private@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close cart' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }));
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  fireEvent.click(screen.getByRole('button', { name: 'Restore fixture items' }));
  expect(screen.getByLabelText('Fixture contact email')).toHaveValue('');
  expect(screen.getByTestId('count')).toHaveTextContent('2');
});

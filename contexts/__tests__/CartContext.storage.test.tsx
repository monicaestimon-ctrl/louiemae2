import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from '../CartContext';
import { AddToCartButton } from '../../components/cart/AddToCartButton';
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
      <p role="status" data-testid="notice">
        {c.notice}
      </p>
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
  expect(screen.getByTestId('notice')).toHaveTextContent('during this visit');
  fireEvent.click(screen.getByText('Clear'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('0');
});
it('contains malformed saved data and keeps the cart usable', () => {
  localStorage.setItem('louiemae_ashcroft_cart_v1', '{"items":"bad"}');
  render(<App />);
  expect(screen.getByTestId('notice')).toHaveTextContent('could not be restored');
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
  expect(screen.getByTestId('notice')).toHaveTextContent('project quote');
});

const ruledOption = {
  id: 'oak',
  name: 'Oak',
  priceAdjustment: 0,
  inStock: true,
  quantityRules: { minimum: 3, increment: 2 },
};
const ruledProduct: Product = {
  ...product,
  fulfillmentProvider: 'zuo',
  inStock: true,
  variants: [ruledOption],
};
function AddControls() {
  const c = useCart();
  return (
    <>
      <AddToCartButton product={ruledProduct} selectedVariant={ruledOption} />
      <output data-testid="rows">
        {JSON.stringify(c.items.map((i) => ({ id: i.product.id, quantity: i.quantity })))}
      </output>
      <p role="status" data-testid="notice">
        {c.notice}
      </p>
    </>
  );
}
it('does not announce success for a repeat add that violates the increment', () => {
  render(
    <CartProvider>
      <AddControls />
    </CartProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: /Add 3 to Cart/ }));
  expect(screen.getByRole('button', { name: 'Added to Cart!' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Added to Cart!' }));
  expect(screen.queryByRole('button', { name: 'Added to Cart!' })).toBeNull();
  expect(screen.getByTestId('rows')).toHaveTextContent('"quantity":3');
  expect(screen.getByTestId('notice')).toHaveTextContent('increments');
});
it('merges an explicit option into its legacy first-variant line', () => {
  const option = { ...ruledOption, quantityRules: { minimum: 1, increment: 1 } };
  const p = { ...ruledProduct, variants: [option] };
  localStorage.setItem('louiemae_ashcroft_cart_v1', JSON.stringify([{ product: p, quantity: 2 }]));
  function Merge() {
    const c = useCart();
    return (
      <>
        <button onClick={() => c.addToCart(p, 1, option)}>Merge</button>
        <output>
          {c.items.length}:{c.itemCount}
        </output>
      </>
    );
  }
  render(
    <CartProvider>
      <Merge />
    </CartProvider>
  );
  fireEvent.click(screen.getByText('Merge'));
  expect(screen.getByText('1:3')).toBeInTheDocument();
});
it('invalidates an older snapshot when an oversized replacement cannot be stored', () => {
  const huge = {
    ...ruledProduct,
    id: 'huge',
    images: Array(10).fill('https://example.com/' + 'x'.repeat(2000)),
    variants: Array.from({ length: 1000 }, (_, i) => ({
      ...ruledOption,
      id: String(i),
      name: 'x'.repeat(300),
    })),
  };
  localStorage.setItem(
    'louiemae_ashcroft_cart_v1',
    JSON.stringify([
      { product, quantity: 1 },
      { product: { ...product, id: 'second' }, quantity: 1 },
    ])
  );
  function Save() {
    const c = useCart();
    return (
      <>
        <button onClick={() => c.addToCart(huge, 3, huge.variants[0])}>Add large record</button>
        <button onClick={() => c.removeFromCart('chair')}>Remove first</button>
        <output>{c.items.map((i) => i.product.id).join(',')}</output>
        <p role="status" data-testid="notice">
          {c.notice}
        </p>
      </>
    );
  }
  render(
    <CartProvider>
      <Save />
    </CartProvider>
  );
  fireEvent.click(screen.getByText('Add large record'));
  fireEvent.click(screen.getByText('Remove first'));
  expect(screen.getByText('second,huge')).toBeInTheDocument();
  expect(localStorage.getItem('louiemae_ashcroft_cart_v1')).toBeNull();
  expect(screen.getByTestId('notice')).toHaveTextContent('during this visit');
});
it('warns when browser restrictions also prevent invalidating the old saved cart', () => {
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('denied');
  });
  vi.spyOn(window.Storage.prototype, 'removeItem').mockImplementation(() => {
    throw Error('denied');
  });
  render(<App />);
  fireEvent.click(screen.getByText('Add three'));
  expect(screen.getByTestId('quantity')).toHaveTextContent('3');
  expect(screen.getByTestId('notice')).toHaveTextContent('previous saved cart may return');
});

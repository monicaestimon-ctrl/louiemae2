import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Product } from '../../types';
import { CartProvider, useCart } from '../../contexts/CartContext';
import HomeProductPreview from '../HomeProductPreview';
import CollectionProductPreview from '../CollectionProductPreview';
const fixture = vi.hoisted(() => ({
  product: null as Product | null,
  state: 'ready',
  retry: vi.fn(),
}));
vi.mock('../useStorefrontProductDetail', () => ({
  useStorefrontProductDetail: () => ({
    product: fixture.state === 'ready' ? fixture.product : null,
    loading: fixture.state === 'loading',
    unavailable: fixture.state === 'unavailable',
    failed: fixture.state === 'failed',
    retry: fixture.retry,
  }),
}));
vi.mock('../delivery/ProductDeliveryEstimate', () => ({
  default: () => <p>Delivery estimate fixture</p>,
}));
function CartReadout() {
  const { items } = useCart();
  return (
    <output data-testid="cart">
      {items.map((item) => `${item.selectedVariant?.id}:${item.quantity}`).join(',')}
    </output>
  );
}
function product(): Product {
  return {
    id: 'fixture',
    name: 'Fixture chair',
    description: 'Synthetic preview product',
    category: 'Chair',
    collection: 'furniture',
    price: 100,
    images: [],
    inStock: true,
    fulfillmentProvider: 'zuo',
    variants: [
      { id: 'ivory', name: 'Ivory', inStock: true, priceAdjustment: 0 },
      { id: 'walnut', name: 'Walnut', inStock: true, priceAdjustment: 20 },
      { id: 'sold', name: 'Sold out', inStock: false, priceAdjustment: 30 },
    ],
  };
}
beforeEach(() => {
  localStorage.clear();
  fixture.product = product();
  fixture.state = 'ready';
  fixture.retry.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
for (const presentation of ['home', 'collection']) {
  it(`${presentation} preview preserves selection, rejects withdrawn options and adds the selected identity`, () => {
    const close = vi.fn();
    const node = (
      <CartProvider>
        {presentation === 'home' ? (
          <HomeProductPreview productId="fixture" onClose={close} />
        ) : (
          <CollectionProductPreview
            productId="fixture"
            collectionTitle="Furniture"
            onClose={close}
          />
        )}
        <CartReadout />
      </CartProvider>
    );
    const view = render(node);
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sold out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Walnut' }));
    expect(screen.getByText('$120')).toBeTruthy();
    fixture.product = {
      ...fixture.product!,
      variants: fixture.product!.variants!.map((v) =>
        v.id === 'walnut' ? { ...v, inStock: false } : v
      ),
    };
    view.rerender(
      <CartProvider>
        {presentation === 'home' ? (
          <HomeProductPreview productId="fixture" onClose={close} />
        ) : (
          <CollectionProductPreview
            productId="fixture"
            collectionTitle="Furniture"
            onClose={close}
          />
        )}
        <CartReadout />
      </CartProvider>
    );
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ivory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(screen.getByTestId('cart')).toHaveTextContent('ivory:1');
  });
  it(`${presentation} preview keeps unavailable and failed details out of ordering controls`, () => {
    const close = vi.fn();
    fixture.state = 'unavailable';
    const make = () => (
      <CartProvider>
        {presentation === 'home' ? (
          <HomeProductPreview productId="fixture" onClose={close} />
        ) : (
          <CollectionProductPreview
            productId="fixture"
            collectionTitle="Furniture"
            onClose={close}
          />
        )}
      </CartProvider>
    );
    const view = render(make());
    expect(screen.getByRole('status')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).toBeNull();
    fixture.state = 'failed';
    view.rerender(make());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fixture.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  });
}
it('honors an initial collection variant without enabling an unavailable one', () => {
  const close = vi.fn();
  const view = render(
    <CartProvider>
      <CollectionProductPreview
        key="valid"
        productId="fixture"
        initialVariantId="walnut"
        collectionTitle="Furniture"
        onClose={close}
      />
    </CartProvider>
  );
  expect(screen.getByRole('button', { name: 'Walnut' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('$120')).toBeTruthy();
  view.rerender(
    <CartProvider>
      <CollectionProductPreview
        key="unavailable"
        productId="fixture"
        initialVariantId="sold"
        collectionTitle="Furniture"
        onClose={close}
      />
    </CartProvider>
  );
  expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
});

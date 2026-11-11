import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Product } from '../../types';
const state = vi.hoisted(() => ({
  product: null as Product | null,
  loading: false,
  failed: false,
  retry: vi.fn(),
  add: vi.fn(),
}));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: () => state }));
vi.mock('../../contexts/CartContext', () => ({ useCart: () => ({ addToCart: state.add }) }));
vi.mock('../delivery/ProductDeliveryEstimate', () => ({
  default: ({ variantId, disabledMessage }: { variantId?: string; disabledMessage?: string }) => <p>{disabledMessage ?? `Estimate option: ${variantId ?? 'none'}`}</p>,
}));
import { ProductPage } from '../ProductPage';
const product: Product = {
  id: 'stable-id',
  name: 'Rowan Chair',
  category: 'Chair',
  collection: 'furniture',
  description: 'A comfortable chair.',
  price: 100,
  images: [],
  fulfillmentProvider: 'zuo',
  inStock: true,
  variants: [
    { id: 'one', name: 'Ivory', inStock: true, priceAdjustment: 0 },
    { id: 'two', name: 'Walnut', inStock: true, priceAdjustment: 20 },
    { id: 'sold', name: 'Slate', inStock: false, priceAdjustment: 30 },
  ],
};
beforeEach(() => {
  state.product = product;
  state.loading = false;
  state.failed = false;
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/products/stable-id');
});
afterEach(cleanup);

it('uses the URL option and current price for a cart selection', () => {
  render(<ProductPage id="stable-id" variantId="two" />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rowan Chair');
  expect(screen.getByText('$120.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Walnut' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
  expect(state.add).toHaveBeenCalledWith(product, 1, product.variants![1]);
});
it('does not silently substitute an invalid or unavailable linked option', () => {
  const view = render(<ProductPage id="stable-id" variantId="wrong" />);
  expect(screen.getByText(/linked option is no longer available/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
  view.rerender(<ProductPage id="stable-id" variantId="sold" />);
  expect(screen.getByRole('button', { name: 'Out of Stock' })).toBeDisabled();
  expect(state.add).not.toHaveBeenCalled();
});
it('requires a selection before advertising ordering or delivery availability', () => {
  render(<ProductPage id="stable-id" />);
  expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
  expect(screen.queryByText('Available to order')).not.toBeInTheDocument();
  expect(screen.getByText('Select an available option to estimate delivery.')).toBeInTheDocument();
});
it('distinguishes outage, loading and confirmed absence without a purchase control', () => {
  state.product = null;
  state.failed = true;
  const view = render(<ProductPage id="stable-id" />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.retry).toHaveBeenCalledOnce();
  expect(screen.queryByText('Add to Cart')).not.toBeInTheDocument();
  state.failed = false;
  state.loading = true;
  view.rerender(<ProductPage id="stable-id" />);
  expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  state.loading = false;
  view.rerender(<ProductPage id="stable-id" />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Product unavailable');
});

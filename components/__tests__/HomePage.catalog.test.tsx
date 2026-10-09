import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../HomePage';
import { CartProvider, useCart } from '../../contexts/CartContext';
import type { Product } from '../../types';
const mocks = vi.hoisted(() => ({ ready: true, product: null as Product | null, loading: false, unavailable: false, catalog: vi.fn(), detail: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: () => ({ ready: mocks.ready }) }));
vi.mock('../../contexts/BlogContext', async () => {
  const { INITIAL_SITE_CONTENT } = await import('../../constants');
  return { useSite: () => ({ isLoading: false, siteContent: INITIAL_SITE_CONTENT }) };
});
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriber: vi.fn() }) }));
vi.mock('../DynamicPage', () => ({ DynamicSectionRenderer: () => null }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../SafeImage', () => ({ SafeImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../useStoreCatalog', () => ({ useStoreCatalog: (...args: unknown[]) => {
  mocks.catalog(...args);
  return { products: mocks.ready ? [{ id: 'real-product', name: 'Catalog chair', images: ['chair.jpg'], price: 1 }] : [], loading: false, complete: mocks.ready };
} }));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: (id: string | null) => {
  mocks.detail(id); return { product: id ? mocks.product : null, loading: Boolean(id && mocks.loading), unavailable: Boolean(id && mocks.unavailable) };
} }));
const CartProof = () => { const cart = useCart(); return <output aria-label="Cart proof">{JSON.stringify({ count: cart.itemCount, subtotal: cart.subtotal, variant: cart.items[0]?.selectedVariant?.id, product: cart.items[0]?.product.id })}</output>; };
const App = () => <CartProvider><HomePage /><CartProof /></CartProvider>;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Quick View' }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.ready = true; mocks.loading = false; mocks.unavailable = false;
  mocks.product = { id: 'real-product', name: 'Authoritative chair', description: 'Real details', category: 'Chairs', price: 420, images: ['chair.jpg'], inStock: true,
    variants: [{ id: 'linen', name: 'Linen', inStock: true, priceAdjustment: 20 }, { id: 'sold-out', name: 'Velvet', inStock: false, priceAdjustment: 30 }] } as Product;
});
afterEach(cleanup);
describe('homepage real catalog purchase flow', () => {
  it('uses a six-card featured furniture preview and opens authoritative details only on selection', () => {
    render(<App />);
    expect(mocks.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'furniture' }), 'All', true, 'featured', 6);
    expect(mocks.detail).toHaveBeenLastCalledWith(null);
    open(); expect(mocks.detail).toHaveBeenLastCalledWith('real-product');
    expect(within(screen.getByRole('dialog')).getByText('$420.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Velvet' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Linen' }));
    expect(within(screen.getByRole('dialog')).getByText('$440.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(screen.getByLabelText('Cart proof').textContent).toBe(JSON.stringify({ count: 1, subtotal: 440, variant: 'linen', product: 'real-product' }));
  });
  it('clears the variant when closing and reopening a product', () => {
    render(<App />); open(); fireEvent.click(screen.getByRole('button', { name: 'Linen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close product details' }));
    expect(mocks.detail).toHaveBeenLastCalledWith(null); open();
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
  });
  it('invalidates selection when a subscribed variant becomes unavailable', () => {
    const view = render(<App />); open(); fireEvent.click(screen.getByRole('button', { name: 'Linen' }));
    mocks.product = { ...mocks.product!, variants: mocks.product!.variants!.map(v => ({ ...v, inStock: false })) };
    view.rerender(<App />); expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
  });
  it('adds a product without variants at its authoritative price', () => {
    mocks.product = { ...mocks.product!, variants: [] }; render(<App />); open();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(screen.getByLabelText('Cart proof').textContent).toBe(JSON.stringify({ count: 1, subtotal: 420, product: 'real-product' }));
  });
  it('shows loading and deleted-product states without a purchase button', () => {
    mocks.product = null; mocks.loading = true; const view = render(<App />); open();
    expect(screen.getByText('Loading product details…')).toBeTruthy();
    mocks.loading = false; mocks.unavailable = true; view.rerender(<App />);
    expect(screen.getByText('This product is no longer available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(mocks.detail).toHaveBeenLastCalledWith(null);
  });
  it('does not show sample products when the catalog is unavailable', () => {
    mocks.ready = false; render(<App />);
    expect(screen.getByText(/Products are temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Quick View' })).toBeNull();
    expect(mocks.catalog).toHaveBeenLastCalledWith(expect.anything(), 'All', false, 'featured', 6);
  });
});

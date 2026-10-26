import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorePage } from '../StorePage';
import type { Product } from '../../types';
const mocks = vi.hoisted(() => ({ detailProduct: null as Product | null, addToCart: vi.fn(), ready: true, complete: false, products: [] as unknown[], load: vi.fn(), detail: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: (...args: unknown[]) => { mocks.query(...args); return { ready: mocks.ready }; } }));
vi.mock('../../contexts/BlogContext', () => ({ useSite: () => ({ isLoading: false, siteContent: { collections: [{
  id: 'kids', title: 'Kids', subtitle: '', heroImage: '', subcategories: [{ id: 'dresses', title: 'Dresses', image: '' }],
}] } }) }));
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriberWithTags: vi.fn() }) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../SafeImage', () => ({ SafeImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../../contexts/CartContext', () => ({ useCart: () => ({ addToCart: mocks.addToCart }) }));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: (id: string | null) => { mocks.detail(id); return { product: id ? mocks.detailProduct : null, loading: Boolean(id) && !mocks.detailProduct, unavailable: false }; } }));
vi.mock('../useStoreCatalog', () => ({
  useStoreCatalog: (_config: unknown, _category: string, ready: boolean) => ({ products: ready ? mocks.products : [], loading: false,
    complete: ready && mocks.complete, canLoadMore: ready && !mocks.complete, loadingMore: false, loadMore: mocks.load }),
  useStoreCategoryOptions: () => ({ categories: ['All', 'Dresses', 'Legacy beyond first page'], canLoadMore: true, loading: false, loadMore: mocks.load }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.detailProduct = null; mocks.ready = true; mocks.complete = false; mocks.products = []; });
afterEach(cleanup);
describe('store catalog integration', () => {
  it('distinguishes incomplete filtered pages from true emptiness and exposes continuation', () => {
    const view = render(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.queryByText('Coming Soon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more products' })); expect(mocks.load).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Legacy beyond first page' })).toBeTruthy();
    mocks.complete = true; view.rerender(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Email Address'), { target: { value: 'kept@example.com' } });
    view.rerender(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.getByPlaceholderText('Email Address')).toHaveValue('kept@example.com');
  });
  it('opens full details by ID and uses the complete option count on compact cards', () => {
    mocks.products = [{ id: 'late-product', name: 'Late product', images: ['image'], price: 12, category: 'Dresses', isNew: false, variantCount: 150 }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    expect(screen.getByText('Multiple Options')).toBeTruthy();
    fireEvent.click(screen.getByAltText('Late product'));
    expect(mocks.detail).toHaveBeenLastCalledWith('late-product');
    expect(screen.getByText('Loading product details…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(mocks.detail).toHaveBeenLastCalledWith(null);
  });
  it('does not call a single variant multiple options and supports keyboard product opening', () => {
    mocks.products = [{ id: 'single', name: 'One sofa', images: ['image'], price: 2889, category: 'Sofas', isNew: false, variantCount: 1, inStock: true }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    expect(screen.queryByText('Multiple Options')).toBeNull();
    expect(screen.getByText('$2,889')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'View One sofa' }), { key: 'Enter' });
    expect(mocks.detail).toHaveBeenLastCalledWith('single');
  });
  it('shows unavailable state without false Coming Soon or a legacy product subscription', () => {
    mocks.ready = false;
    render(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.getByText(/Products are temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByText('Coming Soon')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more products' })).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});

describe('quick view purchasing', () => {
  const open = (variants: Product['variants']) => {
    mocks.detailProduct = { id: 'sofa', name: 'Test sofa', images: ['image'], price: 2139, category: 'Sofas', collection: 'furniture', description: 'A sofa', inStock: true, fulfillmentProvider: 'ashcroft', variants } as Product;
    mocks.products = [{ ...mocks.detailProduct, variantCount: variants?.length ?? 0 }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    fireEvent.click(screen.getByRole('button', { name: 'View Test sofa' }));
  };
  it('selects the only variant with its price adjustment and passes it to the cart', () => {
    const variant = { id: 'one', name: 'Default Title', inStock: true, priceAdjustment: 100.5 };
    open([variant]);
    expect(screen.queryByText('Default Title')).toBeNull();
    expect(screen.queryByText('Select Option')).toBeNull();
    expect(screen.getByText('$2,239.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(mocks.addToCart).toHaveBeenCalledWith(mocks.detailProduct, 1, variant);
  });
  it('keeps the sole unavailable variant unpurchasable', () => {
    open([{ id: 'one', name: 'Default Title', inStock: false, priceAdjustment: 0 }]);
    expect(screen.getByRole('button', { name: 'Out of Stock' })).toBeDisabled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });
  it('still requires a choice for multiple variants', () => {
    open([{ id: 'a', name: 'Tan', inStock: true, priceAdjustment: 0 }, { id: 'b', name: 'Cream', inStock: true, priceAdjustment: 0 }]);
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cream' }));
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled();
  });
});

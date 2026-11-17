import React from 'react';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorePage } from '../StorePage';
import type { Product } from '../../types';
const mocks = vi.hoisted(() => ({ detailProduct: null as Product | null, detailFailed: false, addToCart: vi.fn(), ready: true as boolean | undefined, complete: false, products: [] as unknown[], load: vi.fn(), detail: vi.fn(), query: vi.fn() }));
vi.mock('../../contexts/useRecoverableQuery', () => ({ useRecoverableQuery: (...args: unknown[]) => { mocks.query(...args); return args[1] === 'skip' ? { status: 'idle', data: undefined } : { status: mocks.ready === undefined ? 'loading' : 'ready', data: mocks.ready === undefined ? undefined : { ready: mocks.ready } }; } }));
vi.mock('../../contexts/BlogContext', () => ({ useSite: () => ({ isLoading: false, siteContentStatus: 'ready', siteContent: { collections: ['kids', 'furniture', 'decor', 'fashion'].map(id => ({
  id, title: id === 'kids' ? 'Kids' : id, subtitle: '', heroImage: '', subcategories: [{ id: 'dresses', title: 'Dresses', image: '' }],
})) } }) }));
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriberWithTags: vi.fn() }) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../SafeImage', () => ({ SafeImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../../contexts/CartContext', () => ({ useCart: () => ({ addToCart: mocks.addToCart }) }));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: (id: string | null) => { mocks.detail(id); return { product: id ? mocks.detailProduct : null, loading: Boolean(id) && !mocks.detailProduct && !mocks.detailFailed, unavailable: false, failed: Boolean(id) && mocks.detailFailed, retry: vi.fn() }; } }));
vi.mock('../useStoreCatalog', () => ({
  useStoreCatalog: (_config: unknown, _category: string, ready: boolean) => ({ products: ready ? mocks.products : [], loading: false,
    complete: ready && mocks.complete, canLoadMore: ready && !mocks.complete, loadingMore: false, loadMore: mocks.load }),
  useStoreCategoryOptions: () => ({ categories: ['All', 'Dresses', 'Legacy beyond first page'], canLoadMore: true, loading: false, loadMore: mocks.load }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.detailProduct = null; mocks.detailFailed = false; mocks.ready = true; mocks.complete = false; mocks.products = []; });
afterEach(cleanup);
describe('store catalog integration', () => {
  it.each(['furniture', 'decor', 'fashion'] as const)('renders verified %s navigation without querying inventory', (collection) => {
    const initial = document.createElement('main'); initial.id = 'lm-collection-document'; document.body.append(initial);
    mocks.ready = undefined;
    const view = render(<StorePage collection={collection} />);
    expect(document.getElementById('lm-collection-document')).toBeNull();
    expect(document.querySelector(`[data-lm-collection-ready="${collection}"]`)).not.toBeNull();
    expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), 'skip');
    expect(screen.queryByText(/Products are temporarily unavailable/)).toBeNull();
    view.rerender(<StorePage collection={collection} forceProductView />);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), {});
    expect(document.querySelector('[data-lm-collection-ready]')).toBeNull();
    mocks.ready = false;
    view.rerender(<StorePage collection={collection} forceProductView />);
    expect(screen.getByText(/Products are temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload products' })).toBeEnabled();
  });
  it('preserves an already-decoded percent sign and supplies a filtered-page heading', async () => {
    render(<StorePage collection="kids" initialCategory="100% cotton" forceProductView />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('100% cotton — Kids');
  });
  it('distinguishes incomplete filtered pages from true emptiness and exposes continuation', async () => {
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
  it('opens full details by ID and uses the complete option count on compact cards', async () => {
    mocks.products = [{ id: 'late-product', name: 'Late product', images: ['image'], price: 12, category: 'Dresses', isNew: false, variantCount: 150 }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    expect(screen.getByText('Multiple Options')).toBeTruthy();
    fireEvent.click(screen.getByAltText('Late product'));
    // Wait for the actual lazy module to mount before inspecting its hook call.
    expect(await screen.findByText('Loading product details…', {}, { timeout: 5000 })).toBeTruthy();
    expect(mocks.detail).toHaveBeenLastCalledWith('late-product');
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps transport failures distinct from missing referral-linked products', async () => {
    mocks.detailFailed = true;
    mocks.products = [{ id: 'single', name: 'One sofa', images: ['image'], price: 2889, category: 'Sofas', variantCount: 1 }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    fireEvent.click(screen.getByRole('button', { name: 'View One sofa' }));
    expect(await screen.findByText('Product details could not be loaded. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('This product is no longer available.')).toBeNull();
  });
  it('does not call a single variant multiple options and supports keyboard product opening', async () => {
    mocks.products = [{ id: 'single', name: 'One sofa', images: ['image'], price: 2889, category: 'Sofas', isNew: false, variantCount: 1, inStock: true }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    expect(screen.queryByText('Multiple Options')).toBeNull();
    expect(screen.getByText('$2,889')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View One sofa' }));
    await waitFor(() => expect(mocks.detail).toHaveBeenLastCalledWith('single'));
  });
  it('shows unavailable state without false Coming Soon or a legacy product subscription', async () => {
    mocks.ready = false;
    render(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.getByText(/Products are temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByText('Coming Soon')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more products' })).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});

describe('quick view purchasing', () => {
  const open = async (variants: Product['variants']) => {
    mocks.detailProduct = { id: 'sofa', name: 'Test sofa', images: ['image'], price: 2139, category: 'Sofas', collection: 'furniture', description: 'A sofa', inStock: true, fulfillmentProvider: 'ashcroft', variants } as Product;
    mocks.products = [{ ...mocks.detailProduct, variantCount: variants?.length ?? 0 }];
    render(<StorePage collection="kids" initialCategory="All" forceProductView />);
    fireEvent.click(screen.getByRole('button', { name: 'View Test sofa' }));
    await waitFor(() => expect(screen.queryByText('Opening product details…')).toBeNull());
  };
  it('selects the only variant with its price adjustment and passes it to the cart', async () => {
    const variant = { id: 'one', name: 'Default Title', inStock: true, priceAdjustment: 100.5 };
    await open([variant]);
    expect(screen.queryByText('Default Title')).toBeNull();
    expect(screen.queryByText('Select Option')).toBeNull();
    expect(screen.getByText('$2,239.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(mocks.addToCart).toHaveBeenCalledWith(mocks.detailProduct, 1, variant);
  });
  it('keeps the sole unavailable variant unpurchasable', async () => {
    await open([{ id: 'one', name: 'Default Title', inStock: false, priceAdjustment: 0 }]);
    expect(screen.getByRole('button', { name: 'Out of Stock' })).toBeDisabled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });
  it('still requires a choice for multiple variants', async () => {
    await open([{ id: 'a', name: 'Tan', inStock: true, priceAdjustment: 0 }, { id: 'b', name: 'Cream', inStock: true, priceAdjustment: 0 }]);
    expect(screen.getByRole('button', { name: 'Select Option First' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cream' }));
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled();
  });
});

it('uses the configured category title for leaf signup copy while retaining the route identity', async () => {
  mocks.complete=true;
  render(<StorePage collection="kids" initialCategory="dresses" forceProductView />);
  expect(screen.getByText(/Receive 24-hour early access/)).toHaveTextContent('Dresses drops');
  expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Dresses — Kids');
});

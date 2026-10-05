import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorePage } from '../StorePage';
const mocks = vi.hoisted(() => ({ ready: true, complete: false, products: [] as unknown[], load: vi.fn(), detail: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: (...args: unknown[]) => { mocks.query(...args); return { ready: mocks.ready }; } }));
vi.mock('../../contexts/BlogContext', () => ({ useSite: () => ({ isLoading: false, siteContent: { collections: [{
  id: 'kids', title: 'Kids', subtitle: '', heroImage: '', subcategories: [{ id: 'dresses', title: 'Dresses', image: '' }],
}] } }) }));
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriberWithTags: vi.fn() }) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../SafeImage', () => ({ SafeImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../cart', () => ({ AddToCartButton: () => <button>Add to cart</button> }));
vi.mock('../useStorefrontProductDetail', () => ({ useStorefrontProductDetail: (id: string | null) => { mocks.detail(id); return { product: null, loading: Boolean(id), unavailable: false }; } }));
vi.mock('../useStoreCatalog', () => ({
  useStoreCatalog: (_config: unknown, _category: string, ready: boolean) => ({ products: ready ? mocks.products : [], loading: false,
    complete: ready && mocks.complete, canLoadMore: ready && !mocks.complete, loadingMore: false, loadMore: mocks.load }),
  useStoreCategoryOptions: () => ({ categories: ['All', 'Dresses', 'Legacy beyond first page'], canLoadMore: true, loading: false, loadMore: mocks.load }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.ready = true; mocks.complete = false; mocks.products = []; });
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
  it('shows unavailable state without false Coming Soon or a legacy product subscription', () => {
    mocks.ready = false;
    render(<StorePage collection="kids" initialCategory="Dresses" />);
    expect(screen.getByText(/Products are temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByText('Coming Soon')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more products' })).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});

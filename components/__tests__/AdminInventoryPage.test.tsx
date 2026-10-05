import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminPage } from '../AdminPage';
const mocks = vi.hoisted(() => ({ demand: vi.fn(), loadDetail: vi.fn(), batch: vi.fn(),
  inventory: { products: [] as unknown[], loading: false, unavailable: false, complete: false,
    loadingMore: false, canLoadMore: true, updating: false, loadMore: vi.fn() },
  site: { isAuthenticated: true, isAuthLoading: false, posts: [], products: [],
    siteContent: { collections: [], customPages: [], navLinks: [] } },
}));
vi.mock('../useAdminInventoryPage', () => ({ useAdminInventoryPage: () => mocks.inventory }));
vi.mock('../../contexts/BlogContext', () => ({ useSite: () => mocks.site }));
vi.mock('../../contexts/AdminCatalogDemand', () => ({ useAdminCatalog: (...args: unknown[]) => mocks.demand(...args) }));
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletterAdmin: () => ({ subscribers: [], campaigns: [], stats: {} }) }));
vi.mock('convex/react', () => ({ useMutation: () => vi.fn(), useAction: () => vi.fn() }));
vi.mock('../useAdminProductDetail', () => ({ useAdminProductDetail: () => ({ load: mocks.loadDetail, cancel: vi.fn(), loadingId: null, error: null }) }));
vi.mock('../useAdminDescriptionBatch', () => ({ useAdminDescriptionBatch: () => ({ busy: false, previews: [], setPreviews: vi.fn(), run: mocks.batch }) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem('admin-active-tab', 'products');
  Object.assign(mocks.inventory, { products: [], loading: false, unavailable: false, complete: false, loadingMore: false, canLoadMore: true, updating: false });
});

it('offers continuation for an empty partial search and keeps the legacy catalog subscription off', () => {
  render(<AdminPage />);
  expect(mocks.demand).toHaveBeenCalledWith(false);
  expect(screen.queryByText('No products found in this collection.')).not.toBeInTheDocument();
  expect(screen.getByText(/0 matching items loaded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more inventory' }));
  expect(mocks.inventory.loadMore).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Launch queued products' })).toBeInTheDocument();
});

it('distinguishes loading, unavailable and exhausted empty inventory', () => {
  mocks.inventory.loading = true;
  const view = render(<AdminPage />);
  expect(screen.getByText('Loading inventory…')).toBeInTheDocument();
  expect(screen.queryByText('No products found in this collection.')).not.toBeInTheDocument();
  mocks.inventory.loading = false; mocks.inventory.unavailable = true; view.rerender(<AdminPage />);
  expect(screen.getByText(/Inventory is temporarily unavailable/)).toBeInTheDocument();
  mocks.inventory.unavailable = false; mocks.inventory.complete = true; view.rerender(<AdminPage />);
  expect(screen.getByText('No products found in this collection.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more inventory' })).not.toBeInTheDocument();
});

it('uses full summary counts/status and opens details or batch generation by loaded ID', () => {
  mocks.inventory.products = [{ id: 'beyond-500', name: 'Complete Chair', category: 'chairs', collection: 'furniture', price: 90,
    images: [], imageCount: 40, variantCount: 150, variantImageCount: 125,
    connectionStatus: { state: 'ready', label: 'Synced & ready', detail: 'All 150 options ready',
      isApproved: true, isMappingComplete: true, mappedVariantCount: 150, sellableVariantCount: 150 } }];
  render(<AdminPage />);
  expect(screen.getByText('40 images')).toBeInTheDocument();
  expect(screen.getByText('125 variant images')).toBeInTheDocument();
  expect(screen.getByText('150/150 sellable variants mapped')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Complete Chair' }));
  expect(mocks.loadDetail).toHaveBeenCalledWith('beyond-500');
  fireEvent.click(screen.getByRole('button', { name: 'Smart Preview (loaded items)' }));
  expect(mocks.batch).toHaveBeenCalledWith(['beyond-500']);
});

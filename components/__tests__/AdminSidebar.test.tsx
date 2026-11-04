import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminPage } from '../AdminPage';

const mocks = vi.hoisted(() => ({
  inventory: { products: [] as unknown[], loading: false, unavailable: false, complete: true,
    loadingMore: false, canLoadMore: false, updating: false, loadMore: vi.fn() },
  site: { isAuthenticated: true, isAuthLoading: false, posts: [], products: [], updateCustomPage: vi.fn(),
    siteContent: {
      collections: [{ id: 'furniture', title: 'Furniture', subcategories: [{ id: 'chairs', title: 'Furniture Chairs' }] }],
      customPages: [] as unknown[], navLinks: [],
    } },
  inventoryArgs: vi.fn(),
}));
vi.mock('../useAdminInventoryPage', () => ({ useAdminInventoryPage: (_enabled: boolean, args: unknown) => { mocks.inventoryArgs(args); return mocks.inventory; } }));
vi.mock('../AdminProductPicker', () => ({ AdminProductPicker: () => null }));
vi.mock('../RichTextEditor', () => ({ RichTextEditor: () => null }));
vi.mock('../AdminOrders', () => ({ AdminOrders: () => <p>Orders view</p> }));
vi.mock('../CJControlRoom', () => ({ CJControlRoom: () => <p>Control room view</p> }));
vi.mock('../CJSettings', () => ({ CJSettings: () => <p>CJ settings view</p> }));
vi.mock('../../contexts/BlogContext', () => ({ useSite: () => mocks.site }));
vi.mock('../../contexts/AdminCatalogDemand', () => ({ useAdminCatalog: () => undefined }));
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletterAdmin: () => ({ subscribers: [], campaigns: [], stats: {} }) }));
vi.mock('convex/react', () => ({ useMutation: () => vi.fn(), useAction: () => vi.fn(), useQuery: () => undefined }));
vi.mock('../useAdminProductDetail', () => ({ useAdminProductDetail: () => ({ load: vi.fn(), cancel: vi.fn(), loadingId: null, error: null }) }));
vi.mock('../useAdminDescriptionBatch', () => ({ useAdminDescriptionBatch: () => ({ busy: false, previews: [], setPreviews: vi.fn(), run: vi.fn() }) }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => { vi.clearAllMocks(); localStorage.setItem('admin-active-tab', 'dashboard'); });

const sidebar = () => within(screen.getByRole('complementary', { name: 'Admin navigation' }));

it('shows six primary destinations with tools folded away until asked for', () => {
  render(<AdminPage />);
  for (const label of ['Overview', 'Orders', 'Products', 'Journal', 'Pages', 'Newsletter']) {
    expect(sidebar().getByRole('button', { name: label })).toBeInTheDocument();
  }
  expect(sidebar().getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  expect(sidebar().queryByRole('button', { name: 'CJ control room' })).not.toBeInTheDocument();
  expect(sidebar().queryByRole('button', { name: 'Furniture' })).not.toBeInTheDocument();

  fireEvent.click(sidebar().getByRole('button', { name: 'Sourcing' }));
  fireEvent.click(sidebar().getByRole('button', { name: 'CJ control room' }));
  expect(screen.getByText('Control room view')).toBeInTheDocument();
  expect(sidebar().getByRole('button', { name: 'Sourcing' })).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(sidebar().getByRole('button', { name: 'Settings' }));
  fireEvent.click(sidebar().getByRole('button', { name: 'CJ connection' }));
  expect(screen.getByText('CJ settings view')).toBeInTheDocument();
});

it('moves collection and category browsing into the Products view', () => {
  render(<AdminPage />);
  fireEvent.click(sidebar().getByRole('button', { name: 'Products' }));
  fireEvent.click(screen.getByRole('button', { name: 'Furniture' }));
  expect(screen.getByRole('button', { name: 'Furniture' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Chairs' }));
  expect(mocks.inventoryArgs).toHaveBeenLastCalledWith(expect.objectContaining({ collection: 'furniture', category: 'Furniture Chairs' }));
  fireEvent.click(screen.getByRole('button', { name: 'All collections' }));
  expect(mocks.inventoryArgs).toHaveBeenLastCalledWith(expect.objectContaining({ collection: 'all', category: null }));
});

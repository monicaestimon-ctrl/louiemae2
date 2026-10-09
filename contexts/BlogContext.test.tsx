import { convexToJson } from 'convex/values';
import React from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { SiteProvider, useSite } from './BlogContext';
import { useAdminCatalog, useStorefrontCatalog } from './AdminCatalogDemand';

const mocks = vi.hoisted(() => ({ authenticated: true, query: vi.fn(), mutation: vi.fn() }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: false }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => mocks.query(getFunctionName(reference), args),
  useMutation: () => mocks.mutation,
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }));

function View({ admin, storefront = true }: { admin: boolean; storefront?: boolean }) {
  useAdminCatalog(admin);
  useStorefrontCatalog(storefront);
  const { products, isCatalogLoading } = useSite();
  return <output data-loading={isCatalogLoading}>{products.map(product => product.name).join(',')}</output>;
}

beforeEach(() => {
  mocks.authenticated = true;
  mocks.query.mockReset();
  mocks.mutation.mockReset();
  mocks.query.mockImplementation((name: string, args: unknown) => {
    if (args === 'skip') return undefined;
    if (name === 'products:list') return [{ _id: 'private', name: 'Private product' }];
    if (name === 'products:listForStorefront') return [{ _id: 'public', name: 'Published product' }];
    if (name === 'siteContent:get') return {};
    if (name === 'blogPosts:listAdmin') return [{ _id: 'post', title: 'Post' }];
    return [];
  });
});
afterEach(cleanup);

describe('SiteProvider catalog isolation', () => {
  it('skips both catalogs on unrelated screens and restores/releases public demand on navigation', () => {
    const view = render(<SiteProvider><View admin={false} storefront={false} /></SiteProvider>);
    const catalogCalls = () => mocks.query.mock.calls.filter(([name]) => ['products:list', 'products:listForStorefront'].includes(name));
    expect(catalogCalls().every(([, args]) => args === 'skip')).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(mocks.mutation).not.toHaveBeenCalled();
    view.rerender(<SiteProvider><View admin={false} storefront /></SiteProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Published product');
    expect(screen.getByRole('status')).toHaveAttribute('data-loading', 'false');
    mocks.query.mockClear();
    view.rerender(<SiteProvider><View admin={false} storefront={false} /></SiteProvider>);
    expect(catalogCalls().filter(([name]) => name === 'products:listForStorefront').at(-1)?.[1]).toBe('skip');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it('keeps public demand while another consumer remains mounted', () => {
    const view = render(<React.StrictMode><SiteProvider><View admin={false} /><View admin={false} /></SiteProvider></React.StrictMode>);
    view.rerender(<React.StrictMode><SiteProvider><View admin={false} storefront={false} /><View admin={false} /></SiteProvider></React.StrictMode>);
    expect(mocks.query.mock.calls.filter(([name]) => name === 'products:listForStorefront').at(-1)?.[1]).toEqual({});
    view.rerender(<React.StrictMode><SiteProvider><View admin={false} storefront={false} /><View admin={false} storefront={false} /></SiteProvider></React.StrictMode>);
    expect(mocks.query.mock.calls.filter(([name]) => name === 'products:listForStorefront').at(-1)?.[1]).toBe('skip');
  });
  it('uses public products for authenticated browsing and releases private reads after navigation', () => {
    const view = render(<SiteProvider><View admin={false} /></SiteProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Published product');
    expect(mocks.query.mock.calls.filter(([name]) => name === 'products:list').every(([, args]) => args === 'skip')).toBe(true);
    view.rerender(<SiteProvider><View admin /></SiteProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Private product');
    mocks.query.mockClear();
    view.rerender(<SiteProvider><View admin={false} /></SiteProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Published product');
    expect(mocks.query.mock.calls.filter(([name]) => name === 'products:list').at(-1)?.[1]).toBe('skip');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it('never subscribes to private products without authentication, even with a requesting view', () => {
    mocks.authenticated = false;
    render(<SiteProvider><View admin /></SiteProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Published product');
    expect(mocks.query.mock.calls.filter(([name]) => name === 'products:list').every(([, args]) => args === 'skip')).toBe(true);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});

it('serializes supplier labels at create, batch-create and edit mutation boundaries', async () => {
  const { result } = renderHook(() => useSite(), { wrapper: SiteProvider });
  mocks.mutation.mockImplementation(async args => { convexToJson(args); return 'saved'; });
  const product = { name: 'Imported chair', price: 90, description: '', images: [], category: 'Chairs', collection: 'furniture', sourceProperties: { '材质': '白蜡木' } } as Parameters<ReturnType<typeof useSite>['addProduct']>[0];
  await result.current.addProduct(product);
  await result.current.addProducts([product]);
  await result.current.updateProduct('product-id', { sourceProperties: product.sourceProperties, productRevision: 1 });
  const expected = [{ key: '材质', value: '白蜡木' }];
  expect(mocks.mutation.mock.calls[0][0].sourceProperties).toEqual(expected);
  expect(mocks.mutation.mock.calls[1][0].products[0].sourceProperties).toEqual(expected);
  expect(mocks.mutation.mock.calls[2][0].sourceProperties).toEqual(expected);
});
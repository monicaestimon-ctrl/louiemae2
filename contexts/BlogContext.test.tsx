import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { SiteProvider, useSite } from './BlogContext';
import { useAdminCatalog } from './AdminCatalogDemand';

const mocks = vi.hoisted(() => ({ authenticated: true, query: vi.fn(), mutation: vi.fn() }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: false }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => mocks.query(getFunctionName(reference), args),
  useMutation: () => mocks.mutation,
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }));

function View({ admin }: { admin: boolean }) {
  useAdminCatalog(admin);
  const { products } = useSite();
  return <output>{products.map(product => product.name).join(',')}</output>;
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

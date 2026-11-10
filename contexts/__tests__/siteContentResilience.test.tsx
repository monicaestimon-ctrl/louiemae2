import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { SiteProvider, useSite } from '../BlogContext';
import { ContentStatusPage } from '../../components/ContentStatusPage';

const mocks = vi.hoisted(() => ({ settings: undefined as unknown, pages: undefined as unknown, session: { owner: true } as unknown, mutate: vi.fn() }));
vi.mock('convex/react', () => ({
  useQueries: () => ({ settings: mocks.settings, pages: mocks.pages, posts: [], session: mocks.session }),
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => args === 'skip' ? undefined
    : getFunctionName(query) === 'cjAdminAccess:session' ? { owner: true } : [{ _id: 'existing' }],
  useMutation: () => mocks.mutate,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }));
function Probe() {
  const site = useSite();
  return <><nav>{site.siteContent.collections.map(collection => <a key={collection.id} href={`#collection/${collection.id}`}>{collection.title}</a>)}</nav>
    <span data-testid="settings">{site.siteContentStatus}</span>
    <span data-testid="loading">{String(site.isLoading)}</span>
    <span data-testid="account">{site.accountStatus}</span>
    <ContentStatusPage status={site.customPagesStatus} /></>;
}
beforeEach(() => { mocks.settings = undefined; mocks.pages = undefined; mocks.session = { owner: true }; mocks.mutate.mockReset(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('public site content resilience', () => {
  it('retains public navigation and cannot seed when signed-in account access fails', () => {
    mocks.session = new Error('private account diagnostic'); mocks.settings = null; mocks.pages = [];
    render(<SiteProvider><Probe /></SiteProvider>);
    expect(screen.getByRole('link', { name: 'Furniture' })).toBeTruthy();
    expect(screen.getByTestId('account')).toHaveTextContent('unavailable');
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('private account diagnostic')).toBeNull();
  });
  it('prevents fallback configuration from being saved over unknown supplier-independent site settings', async () => {
    mocks.settings = new Error('offline'); mocks.pages = new Error('offline');
    const { result } = renderHook(() => useSite(), { wrapper: SiteProvider });
    await expect(result.current.updateNavigation([])).rejects.toThrow('Site settings are unavailable');
    await expect(result.current.updateSiteContent('home', {})).rejects.toThrow('Site settings are unavailable');
    await expect(result.current.deleteCustomPage('page')).rejects.toThrow('Custom pages are unavailable');
    await expect(result.current.deleteCollection('furniture')).rejects.toThrow('Site settings are unavailable');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('keeps default navigation and does not seed over failed settings, even for an owner', () => {
    mocks.settings = new Error('private settings error'); mocks.pages = new Error('private page error');
    render(<SiteProvider><Probe /></SiteProvider>);
    expect(screen.getByRole('link', { name: 'Furniture' })).toBeTruthy();
    expect(screen.getByTestId('settings').textContent).toBe('unavailable');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByRole('heading').textContent).toBe('Page temporarily unavailable');
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('private settings error')).toBeNull();
  });
  it('bounds each pending source and recovers without reseeding or showing a false not-found state', () => {
    const view = render(<SiteProvider><Probe /></SiteProvider>);
    expect(screen.getByRole('heading').textContent).toBe('Loading page…');
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('heading').textContent).toBe('Page temporarily unavailable');
    expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.settings = {}; mocks.pages = [];
    view.rerender(<SiteProvider><Probe /></SiteProvider>);
    expect(screen.getByTestId('settings').textContent).toBe('ready');
    expect(screen.getByRole('heading').textContent).toBe('Page not found');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

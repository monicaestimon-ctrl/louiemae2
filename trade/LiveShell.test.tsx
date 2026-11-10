import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveShell, TradeBoundary } from './LiveShell';

const mocks = vi.hoisted(() => ({ me: undefined as { signedIn: boolean; verified?: boolean } | undefined, authLoading: false, authenticated: undefined as boolean | undefined, failed: false, rows: [] as unknown[], status: 'LoadingFirstPage', loadMore: vi.fn(), install: vi.fn() }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isLoading: mocks.authLoading, isAuthenticated: mocks.authenticated ?? Boolean(mocks.me?.signedIn) }),
  useQuery: () => { if (mocks.failed) throw new Error('account unavailable'); return mocks.me; },
  usePaginatedQuery: () => ({ results: mocks.rows, status: mocks.status, loadMore: mocks.loadMore }),
}));
vi.mock('./catalog', () => ({ liveProducts: (rows: unknown[]) => rows }));
vi.mock('./app', () => ({ App: () => <main className="home">Verified catalog</main>, setProducts: (rows: unknown[]) => mocks.install(rows) }));
beforeEach(() => {
  mocks.me = undefined; mocks.authLoading = false; mocks.authenticated = undefined; mocks.failed = false; mocks.rows = []; mocks.status = 'LoadingFirstPage'; mocks.loadMore.mockReset(); mocks.install.mockReset();
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const shell = document.createElement('div'); shell.id = 'holm-shell'; shell.textContent = 'Startup hero'; document.body.append(shell);
});
afterEach(() => { cleanup(); document.getElementById('holm-shell')?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('replaces an indefinite startup hero with recovery links after ten seconds and recovers on data arrival', () => {
  const view = render(<LiveShell />);
  expect(screen.getByText('Startup hero')).toBeTruthy();
  act(() => vi.advanceTimersByTime(10_000));
  expect(document.getElementById('holm-shell')).toBeNull();
  expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/#support/contact');
  expect(screen.queryByText('Verified catalog')).toBeNull();
  expect(mocks.install).not.toHaveBeenCalled();
  mocks.me = { signedIn: false }; mocks.rows = [{ id: 'verified' }]; mocks.status = 'Exhausted';
  view.rerender(<LiveShell />);
  expect(screen.getByText('Verified catalog')).toBeTruthy();
});
it('does not display partial or unresolved account pricing', () => {
  mocks.me = { signedIn: false };
  mocks.rows = [{ id: 'partial' }]; mocks.status = 'CanLoadMore';
  const view = render(<LiveShell />);
  expect(mocks.loadMore).toHaveBeenCalledWith(50);
  expect(mocks.install).not.toHaveBeenCalled();
  mocks.status = 'Exhausted'; mocks.me = undefined; view.rerender(<LiveShell />);
  expect(screen.queryByText('Verified catalog')).toBeNull();
  expect(mocks.install).not.toHaveBeenCalled();
});
it('removes the startup hero on query errors and retries without presenting stale products', () => {
  mocks.failed = true;
  render(<TradeBoundary><LiveShell /></TradeBoundary>);
  expect(document.getElementById('holm-shell')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Recovery navigation' })).toBeTruthy();
  expect(mocks.install).not.toHaveBeenCalled();
  mocks.failed = false; mocks.me = { signedIn: true, verified: true }; mocks.status = 'Exhausted'; mocks.rows = [{ id: 'current' }];
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Verified catalog')).toBeTruthy();
  expect(mocks.install).toHaveBeenLastCalledWith(mocks.rows);
});
it('distinguishes a confirmed empty catalog from a purchasable trade floor', () => {
  mocks.me = { signedIn: false }; mocks.status = 'Exhausted';
  render(<LiveShell />);
  expect(screen.getByRole('status').textContent).toContain('No products are available');
  expect(document.querySelector('main.home')).toBeNull();
});

it('hides cached account-priced rows while authentication is loading or disagrees with the account query', () => {
  mocks.me = { signedIn: true, verified: true }; mocks.rows = [{ id: 'private' }]; mocks.status = 'Exhausted'; mocks.authLoading = true;
  const view = render(<LiveShell />);
  expect(screen.queryByText('Verified catalog')).toBeNull();
  expect(mocks.install).not.toHaveBeenCalled();
  mocks.authLoading = false; mocks.authenticated = false;
  view.rerender(<LiveShell />);
  expect(screen.queryByText('Verified catalog')).toBeNull();
  expect(mocks.install).not.toHaveBeenCalled();
});

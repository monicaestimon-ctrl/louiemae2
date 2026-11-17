import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { LiveShell, TradeBoundary } from './LiveShell';

const mocks = vi.hoisted(() => ({ me: undefined as { signedIn: boolean; verified?: boolean } | undefined, authLoading: false, authenticated: undefined as boolean | undefined, curated: [] as unknown[] | undefined, failed: false, rows: [] as unknown[], status: 'LoadingFirstPage', loadMore: vi.fn(), install: vi.fn(), references: vi.fn() }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isLoading: mocks.authLoading, isAuthenticated: mocks.authenticated ?? Boolean(mocks.me?.signedIn) }),
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => { if (mocks.failed) throw new Error('account unavailable'); return getFunctionName(query) === 'holm:catalogItems' ? mocks.curated : mocks.me; },
  usePaginatedQuery: () => ({ results: mocks.rows, status: mocks.status, loadMore: mocks.loadMore }),
}));
vi.mock('./catalog', () => ({ liveProducts: (rows: unknown[]) => rows }));
vi.mock('./app', () => ({ App: ({onCatalogIntent}: {onCatalogIntent: () => void}) => <main className="home">Verified catalog<input aria-label="Unsaved project name" /><button onClick={onCatalogIntent}>Discover catalog</button></main>, setProducts: (rows: unknown[], refs: unknown[]) => { mocks.install(rows); mocks.references(refs); } }));
beforeEach(() => {
  window.history.replaceState(null, '', '/trade/');
  mocks.curated=[]; mocks.me = undefined; mocks.authLoading = false; mocks.authenticated = undefined; mocks.failed = false; mocks.rows = []; mocks.status = 'LoadingFirstPage'; mocks.loadMore.mockReset(); mocks.install.mockReset(); mocks.references.mockReset();
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const shell = document.createElement('div'); shell.id = 'holm-shell'; shell.textContent = 'Startup hero'; document.body.append(shell);
});
afterEach(() => { cleanup(); document.getElementById('holm-shell')?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps an existing draft mounted but inaccessible during an empty same-viewer refresh', () => {
  mocks.me = { signedIn: false }; mocks.status = 'Exhausted'; mocks.rows = [{ id: 'one' }];
  const view = render(<LiveShell />);
  const input = screen.getByLabelText('Unsaved project name');
  fireEvent.change(input, { target: { value: 'Unfinished project' } });
  mocks.rows = []; view.rerender(<LiveShell />);
  expect(input.closest('[hidden]')).not.toBeNull();
  expect(input.closest('[inert]')).not.toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('No products are available');
  mocks.status = 'LoadingMore'; view.rerender(<LiveShell />);
  expect(input.closest('[hidden]')).not.toBeNull();
  mocks.status = 'Exhausted'; mocks.rows = [{ id: 'two' }]; view.rerender(<LiveShell />);
  expect(screen.getByLabelText('Unsaved project name')).toBe(input);
  expect(input).toHaveValue('Unfinished project');
});

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
it('shows a verified first page but clears it when account identity becomes unresolved', () => {
  mocks.me = { signedIn: false };
  mocks.rows = [{ id: 'partial' }]; mocks.status = 'CanLoadMore';
  const view = render(<LiveShell />);
  expect(mocks.loadMore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discover catalog' }));
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
  expect(mocks.install).toHaveBeenLastCalledWith(mocks.rows);
  expect(screen.getByText('Verified catalog')).toBeTruthy();
  mocks.status = 'Exhausted'; mocks.me = undefined; view.rerender(<LiveShell />);
  expect(screen.queryByText('Verified catalog')).toBeNull();
  expect(mocks.install).toHaveBeenLastCalledWith([]);
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

it('preserves the mounted project UI across same-viewer catalog refreshes', () => {
  mocks.me = { signedIn: false }; mocks.rows = [{ id: 'first' }]; mocks.status = 'Exhausted';
  const view = render(<LiveShell />);
  const input = screen.getByLabelText('Unsaved project name');
  fireEvent.change(input, { target: { value: 'Client lounge' } });
  mocks.rows = [{ id: 'replacement' }];
  view.rerender(<LiveShell />);
  expect(screen.getByLabelText('Unsaved project name')).toBe(input);
  expect(input).toHaveValue('Client lounge');
  expect(mocks.install).toHaveBeenLastCalledWith(mocks.rows);
  expect(mocks.install.mock.calls.some(([rows]) => rows.length === 0)).toBe(false);
  view.unmount();
  expect(mocks.install).toHaveBeenLastCalledWith([]);
});

it('clears the previous viewer catalog and remounts UI when the pricing role changes', () => {
  mocks.me = { signedIn: true, verified: true }; mocks.rows = [{ id: 'trade' }]; mocks.status = 'Exhausted';
  const view = render(<LiveShell />);
  const input = screen.getByLabelText('Unsaved project name');
  mocks.me = { signedIn: true, verified: false }; mocks.rows = [{ id: 'retail' }];
  view.rerender(<LiveShell />);
  expect(screen.getByLabelText('Unsaved project name')).not.toBe(input);
  expect(mocks.install.mock.calls.some(([rows]) => rows.length === 0)).toBe(true);
  expect(mocks.install).toHaveBeenLastCalledWith(mocks.rows);
});

it('waits for verified curated references and passes completion separately from first-page readiness', () => {
  mocks.me={signedIn:false};mocks.status='CanLoadMore';mocks.rows=[{id:'first'}];mocks.curated=undefined;
  const view=render(<LiveShell/>);
  expect(screen.queryByText('Verified catalog')).toBeNull();
  window.history.replaceState(null, '', '/trade/');
  mocks.curated=[];view.rerender(<LiveShell/>);
  expect(screen.getByText('Verified catalog')).toBeTruthy();
  const input=screen.getByLabelText('Unsaved project name');fireEvent.change(input,{target:{value:'Keep during pagination'}});
  mocks.status='LoadingMore';view.rerender(<LiveShell/>);
  expect(screen.getByLabelText('Unsaved project name')).toBe(input);
  mocks.rows=[{id:'first'},{id:'second'}];mocks.status='Exhausted';view.rerender(<LiveShell/>);
  expect(input).toHaveValue('Keep during pagination');
});
it('continues past empty candidate pages without claiming an empty catalog', () => {
  mocks.me={signedIn:false};mocks.status='CanLoadMore';mocks.rows=[];
  render(<LiveShell/>);
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
  expect(mocks.install).not.toHaveBeenCalled();
  expect(screen.queryByText(/No products are available/)).toBeNull();
});

it('installs first and complete datasets without reinstalling every intermediate page', () => {
  mocks.me={signedIn:false};mocks.status='CanLoadMore';const first=[{id:'first'}];mocks.rows=first;
  const view=render(<LiveShell/>);expect(mocks.install).toHaveBeenLastCalledWith(first);
  const count=mocks.install.mock.calls.length;
  mocks.rows=[...first,{id:'intermediate'}];view.rerender(<LiveShell/>);
  expect(mocks.install.mock.calls.length).toBe(count);
  mocks.status='Exhausted';view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith(mocks.rows);
});

it('applies price corrections and withdrawals to installed rows and references before loading completes', () => {
  mocks.me={signedIn:false};mocks.status='CanLoadMore';mocks.rows=[{id:'first',price:10}];mocks.curated=[{productId:'curated',item:{id:'curated',price:20}}];
  const view=render(<LiveShell/>);
  mocks.status='LoadingMore';mocks.rows=[{id:'first',price:11},{id:'later',price:30}];mocks.curated=[{productId:'curated',item:{id:'curated',price:21}}];view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith([{id:'first',price:11}]);
  expect(mocks.references).toHaveBeenLastCalledWith([{id:'curated',price:21}]);
  mocks.rows=[{id:'later',price:30}];mocks.curated=[{productId:'curated',item:null}];view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith([]);expect(mocks.references).toHaveBeenLastCalledWith([]);
  expect(screen.queryByText(/No products are available/)).toBeNull();
  mocks.status='Exhausted';mocks.rows=[];view.rerender(<LiveShell/>);
  expect(screen.getByText(/No products are available/)).toBeTruthy();
});

it('starts full loading for a direct discovery route and retains demand after returning home', () => {
  window.history.replaceState(null, '', '/trade/#discover');
  mocks.me={signedIn:false};mocks.rows=[{id:'first'}];mocks.status='CanLoadMore';
  const view=render(<LiveShell/>);
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
  act(()=>{window.history.replaceState(null,'','/trade/#home');window.dispatchEvent(new Event('hashchange'));});
  mocks.status='LoadingMore';view.rerender(<LiveShell/>);
  mocks.loadMore.mockClear();mocks.status='CanLoadMore';view.rerender(<LiveShell/>);
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
});
it('requests full discovery on hash navigation without replacing an unsaved project', () => {
  mocks.me={signedIn:false};mocks.rows=[{id:'first'}];mocks.status='CanLoadMore';
  render(<LiveShell/>);
  const input=screen.getByLabelText('Unsaved project name');fireEvent.change(input,{target:{value:'Keep this draft'}});
  expect(mocks.loadMore).not.toHaveBeenCalled();
  act(()=>{window.history.replaceState(null,'','/trade/#studio');window.dispatchEvent(new Event('hashchange'));});
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
  expect(screen.getByLabelText('Unsaved project name')).toBe(input);
  expect(input).toHaveValue('Keep this draft');
});

it('does not carry home-page discovery demand into another viewer session', () => {
  mocks.me={signedIn:true,verified:true};mocks.rows=[{id:'trade'}];mocks.status='CanLoadMore';
  const view=render(<LiveShell/>);
  fireEvent.click(screen.getByRole('button',{name:'Discover catalog'}));
  expect(mocks.loadMore).toHaveBeenCalledWith(24);
  mocks.loadMore.mockClear();mocks.me={signedIn:false};mocks.rows=[{id:'public'}];
  view.rerender(<LiveShell/>);
  expect(mocks.loadMore).not.toHaveBeenCalled();
  expect(mocks.install).toHaveBeenLastCalledWith([{id:'public'}]);
});

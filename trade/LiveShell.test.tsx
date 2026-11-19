import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { LiveShell, TradeBoundary } from './LiveShell';

const mocks = vi.hoisted(() => ({ me: undefined as { signedIn: boolean; verified?: boolean; admin?: boolean; email?:string } | undefined, authLoading: false, authenticated: undefined as boolean | undefined, curated: [] as unknown[] | undefined, failed: false, rows: [] as unknown[], status: 'LoadingFirstPage', ensure:vi.fn().mockResolvedValue(null), savedDraft:vi.fn(), catalogQueries:vi.fn(), loadMore: vi.fn(), install: vi.fn(), references: vi.fn() }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isLoading: mocks.authLoading, isAuthenticated: mocks.authenticated ?? Boolean(mocks.me?.signedIn) }),
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => { if (mocks.failed) throw new Error('account unavailable'); return getFunctionName(query) === 'holm:catalogItems' ? mocks.curated : mocks.me; },
  useMutation:()=>mocks.ensure,
  usePaginatedQuery: () => {mocks.catalogQueries();return { results: mocks.rows, status: mocks.status, loadMore: mocks.loadMore };},
}));
vi.mock('./admin/HouseStaffGate',()=>({HouseStaffGate:({admin}:{admin:boolean})=><main>{admin?<><h1>Staff management</h1><input aria-label='Staff draft'/></>:<h1>Team only</h1>}</main>}));
vi.mock('@convex-dev/auth/react',()=>({useAuthActions:()=>({signIn:vi.fn()})}));
vi.mock('./catalog', () => ({ liveProducts: (rows: unknown[]) => rows }));
vi.mock('./app', () => ({ Turntable: () => null, App: function DraftOwner({onCatalogIntent,suspended}: {onCatalogIntent: () => void;suspended?:boolean}) {
  const [draft,setDraft]=useState('');
  const [snapshot,setSnapshot]=useState('');
  useEffect(()=>{if(!draft)return;const timer=setTimeout(()=>mocks.savedDraft(draft),1500);return()=>clearTimeout(timer)},[draft]);
  return <main className="home">Verified catalog<input aria-label="Unsaved project name" value={draft} onChange={e=>setDraft(e.target.value)}/><output aria-label="Saved snapshot">{snapshot}</output>{!suspended&&<FinalSnapshot save={setSnapshot}/>}<button onClick={onCatalogIntent}>Discover catalog</button></main>;
}, setProducts: (rows: unknown[], refs: unknown[]) => { mocks.install(rows); mocks.references(refs); } }));
function FinalSnapshot({save}:{save:(value:string)=>void}) {
  useEffect(()=>()=>save('Final Studio edit'),[save]);
  return <span>Studio editor</span>;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/trade/');
  mocks.curated=[]; mocks.me = undefined; mocks.authLoading = false; mocks.authenticated = undefined; mocks.failed = false; mocks.rows = []; mocks.status = 'LoadingFirstPage'; mocks.savedDraft.mockReset();mocks.catalogQueries.mockReset();mocks.loadMore.mockReset(); mocks.install.mockReset(); mocks.references.mockReset();
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

it('recovers a withdrawn home selection from a settled replacement page and stops idle pagination', () => {
  mocks.me={signedIn:false};mocks.status='CanLoadMore';mocks.rows=[{id:'first'}];
  const view=render(<LiveShell/>);
  const input=screen.getByLabelText('Unsaved project name');fireEvent.change(input,{target:{value:'Keep recovery draft'}});
  expect(mocks.loadMore).not.toHaveBeenCalled();
  mocks.rows=[];view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith([]);
  expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  mocks.status='LoadingMore';view.rerender(<LiveShell/>);
  const replacement=Array.from({length:30},(_,i)=>({id:`replacement-${i}`}));
  mocks.rows=replacement;mocks.status='CanLoadMore';view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith(replacement.slice(0,24));
  expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Unsaved project name')).toBe(input);
  expect(input).toHaveValue('Keep recovery draft');
  const installed=mocks.install.mock.calls.length;
  mocks.rows=[...replacement,{id:'later'}];view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenCalledTimes(installed);
  expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  mocks.rows=[{id:'later'}];view.rerender(<LiveShell/>);
  expect(mocks.install).toHaveBeenLastCalledWith([{id:'later'}]);
  expect(mocks.loadMore).toHaveBeenCalledTimes(1);
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

it('opens staff management without any catalog subscription when the catalog is empty',()=>{
  window.history.replaceState(null,'','/trade/#admin');
  mocks.me={signedIn:true,verified:true,admin:true,email:'staff@example.test'};
  mocks.status='Exhausted';mocks.curated=undefined;
  render(<LiveShell/>);
  expect(screen.getByRole('heading',{name:'Staff management'})).toBeTruthy();
  expect(mocks.catalogQueries).not.toHaveBeenCalled();
  expect(mocks.install).not.toHaveBeenCalled();
  expect(document.getElementById('holm-shell')).toBeNull();
});
it('denies anonymous staff entry without requesting a catalog and restores catalog recovery on home navigation',()=>{
  window.history.replaceState(null,'','/trade/#admin');mocks.me={signedIn:false};mocks.status='Exhausted';
  render(<LiveShell/>);
  expect(screen.getByRole('heading',{name:'Team only'})).toBeTruthy();expect(mocks.catalogQueries).not.toHaveBeenCalled();
  act(()=>{window.history.replaceState(null,'','/trade/#home');window.dispatchEvent(new HashChangeEvent('hashchange'))});
  expect(screen.queryByRole('heading',{name:'Team only'})).toBeNull();
  expect(mocks.catalogQueries).toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('No products are available');
});
it('requires settled account identity and discards staff drafts on role loss',()=>{
  window.history.replaceState(null,'','/trade/#admin');mocks.me={signedIn:true,verified:true,admin:true,email:'staff@example.test'};mocks.authLoading=true;
  const view=render(<LiveShell/>);expect(screen.queryByRole('heading',{name:'Staff management'})).toBeNull();
  mocks.authLoading=false;view.rerender(<LiveShell/>);
  fireEvent.input(screen.getByLabelText('Staff draft'),{target:{value:'Private draft'}});
  mocks.me={...mocks.me,admin:false};view.rerender(<LiveShell/>);
  expect(screen.queryByLabelText('Staff draft')).toBeNull();expect(screen.getByRole('heading',{name:'Team only'})).toBeTruthy();
  mocks.me={...mocks.me,admin:true};view.rerender(<LiveShell/>);expect(screen.getByLabelText('Staff draft')).toHaveValue('');
  expect(mocks.catalogQueries).not.toHaveBeenCalled();
});

it('offers catalog-independent staff sign-in and keeps admin destination after password authentication',()=>{
  window.history.replaceState(null,'','/trade/#admin');mocks.me={signedIn:false};mocks.status='Exhausted';
  const view=render(<LiveShell/>);
  fireEvent.click(screen.getByRole('button',{name:'Sign in to staff account'}));
  expect(screen.getByRole('heading',{name:'Sign in to House management'})).toBeTruthy();
  expect(screen.getByLabelText(/email/i)).toBeTruthy();
  expect(mocks.catalogQueries).not.toHaveBeenCalled();
  mocks.me={signedIn:true,verified:true,admin:true,email:'staff@example.test'};view.rerender(<LiveShell/>);
  expect(screen.getByRole('heading',{name:'Staff management'})).toBeTruthy();
  expect(window.location.hash).toBe('#admin');
  expect(mocks.catalogQueries).not.toHaveBeenCalled();
});

it.each(['welcome','account'])('opens %s without catalog subscriptions or stale products',route=>{
 window.history.replaceState(null,'',`/trade/#${route}`);mocks.me={signedIn:false};mocks.status='Exhausted';
 render(<LiveShell/>);
 expect(screen.getByRole('navigation',{name:'Account navigation'})).toBeTruthy();
 expect(mocks.catalogQueries).not.toHaveBeenCalled();expect(mocks.install).not.toHaveBeenCalled();
 expect(document.getElementById('holm-shell')).toBeNull();
 expect(screen.queryByText('Verified catalog')).toBeNull();
});

it.each(['account','welcome','admin'])('preserves pending saves and child cleanup snapshots across %s',route=>{
 mocks.me={signedIn:false};mocks.rows=[{id:'one'}];mocks.status='Exhausted';
 render(<LiveShell/>);
 fireEvent.change(screen.getByLabelText('Unsaved project name'),{target:{value:'Latest board edit'}});
 act(()=>{window.history.replaceState(null,'',`/trade/#${route}`);window.dispatchEvent(new HashChangeEvent('hashchange'))});
 expect(screen.getByLabelText('Unsaved project name').closest('[hidden]')).not.toBeNull();
 expect(screen.getByLabelText('Saved snapshot')).toHaveTextContent('Final Studio edit');
 act(()=>vi.advanceTimersByTime(1500));
 expect(mocks.savedDraft).toHaveBeenCalledExactlyOnceWith('Latest board edit');
 act(()=>{window.history.replaceState(null,'','/trade/#home');window.dispatchEvent(new HashChangeEvent('hashchange'))});
 expect(screen.getByLabelText('Unsaved project name')).toHaveValue('Latest board edit');
 expect(screen.getByLabelText('Saved snapshot')).toHaveTextContent('Final Studio edit');
});

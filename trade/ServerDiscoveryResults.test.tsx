import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiveItem } from './catalog';
import type { DiscoveryRequest } from '../lib/holmDiscoveryFilters';
import { ServerDiscoveryResults } from './ServerDiscoveryResults';
import { productsById, setProducts } from './catalogStore';
const mock = vi.hoisted(() => ({ read: vi.fn(), state: { items: [] as LiveItem[], pending: false, error: null as Error | null, unavailable: false, nextCursor: null as string | null, loadMore: vi.fn(), retry: vi.fn() } }));
vi.mock('./useDiscoveryPages', () => ({ useDiscoveryPages: (request: DiscoveryRequest, viewer: string, enabled: boolean) => { mock.read(request, viewer, enabled); return mock.state; } }));
const request: DiscoveryRequest = { query: '', type: 'all', materials: [], tones: [], photoPalette: [], maximumMinor: null, inStock: false, sort: 'priceAsc', channel: 'retail' };
const row = (id: string, name: string): LiveItem => ({ id, name, description: '', category: 'Chair', facts: '', images: [], inStock: true,
  variants: [{ id: 'v', name: '', minimum: 1, increment: 1, retail: 10000, trade: null }] });
function View({ query = '' }: { query?: string }) { return <ServerDiscoveryResults request={{ ...request, query }} viewerKey="anonymous" searching={false} resetFilters={() => {}} renderProducts={items => <ul>{items.map(item => <li key={item.lid}>{item.full}</li>)}</ul>} />; }
afterEach(() => { cleanup(); vi.useRealTimers(); setProducts([]); mock.state.items = []; mock.state.pending = false; mock.state.error = null; mock.state.unavailable = false; mock.state.nextCursor = null; vi.clearAllMocks(); });
it('preserves server order and installs only current display references', () => {
  mock.state.items = [row('z', 'Zebra Chair'), row('a', 'Amber Chair')];
  const view = render(<View />);
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Zebra Chair', 'Amber Chair']);
  expect([...productsById.values()].map(item => item.lid)).toEqual(['z', 'a']);
  mock.state.items = [row('a', 'Amber Chair')]; view.rerender(<View />);
  expect([...productsById.values()].map(item => item.lid)).toEqual(['a']);
  view.unmount(); expect(productsById.size).toBe(0);
});
it('keeps empty candidate pages navigable without claiming no matches', () => {
  mock.state.nextCursor = 'next'; render(<View />);
  expect(screen.queryByText('Nothing matches all of that')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));
  expect(mock.state.loadMore).toHaveBeenCalledOnce();
});
it('removes references on an error and offers a manual retry', () => {
  mock.state.items = [row('z', 'Zebra Chair')]; const view = render(<View />);
  mock.state.error = new Error('Access changed'); view.rerender(<View />);
  expect(screen.queryByRole('list')).toBeNull(); expect(productsById.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mock.state.retry).toHaveBeenCalledOnce();
});

it('debounces typing without showing the previous search results', () => {
  vi.useFakeTimers(); mock.state.items = [row('z', 'Zebra Chair')];
  const view = render(<View />); view.rerender(<View query="amber" />);
  expect(mock.read.mock.lastCall?.[2]).toBe(false);
  expect(screen.queryByRole('list')).toBeNull();
  act(() => vi.advanceTimersByTime(199)); expect(mock.read.mock.lastCall?.[2]).toBe(false);
  act(() => vi.advanceTimersByTime(1)); expect(mock.read.mock.lastCall?.[2]).toBe(true);
});

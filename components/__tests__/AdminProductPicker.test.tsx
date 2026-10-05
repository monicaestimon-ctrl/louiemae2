import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { AdminProductPicker } from '../AdminProductPicker';
const mocks = vi.hoisted(() => ({ ready: undefined as unknown, selected: undefined as unknown, query: vi.fn(), pages: vi.fn(),
  page: { results: [] as Array<{ id: string; name: string }>, status: 'LoadingFirstPage', loadMore: vi.fn() } }));
vi.mock('convex/react', () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => { const name = getFunctionName(ref); mocks.query(name, args); return name === 'catalogReadiness:status' ? mocks.ready : mocks.selected; },
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => { mocks.pages(getFunctionName(ref), args); return mocks.page; },
}));
beforeEach(() => { vi.clearAllMocks(); mocks.ready = undefined; mocks.selected = undefined; mocks.page.results = []; mocks.page.status = 'LoadingFirstPage'; });

it('skips unverified options and distinguishes readiness loading from unavailable', () => {
  const change = vi.fn();
  const view = render(<AdminProductPicker value="saved" onChange={change} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByText('Loading products…')).toBeInTheDocument();
  expect(mocks.pages.mock.lastCall).toEqual(['catalog:adminOptionsPage', 'skip']);
  mocks.ready = { ready: false }; view.rerender(<AdminProductPicker value="saved" onChange={change} />);
  expect(screen.getByText('Product selection is temporarily unavailable.')).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});

it('keeps an off-page selection pinned through searches without silently changing it', () => {
  mocks.ready = { ready: true }; mocks.page.status = 'CanLoadMore';
  mocks.page.results = [{ id: 'first', name: 'First product' }];
  mocks.selected = { id: 'beyond-500', name: 'Saved product' };
  const change = vi.fn();
  render(<AdminProductPicker value="beyond-500" onChange={change} />);
  expect(screen.getByRole('combobox')).toHaveValue('beyond-500');
  expect(screen.getByRole('option', { name: 'Saved product' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  New search  ' } });
  expect(mocks.pages.mock.lastCall).toEqual(['catalog:adminOptionsPage', { search: 'New search' }]);
  expect(screen.getByRole('combobox')).toHaveValue('beyond-500');
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'first' } });
  expect(change).toHaveBeenCalledWith('first');
});

it('continues empty filtered pages and prevents duplicate selected options', () => {
  mocks.ready = { ready: true }; mocks.page.status = 'CanLoadMore';
  const view = render(<AdminProductPicker value="saved" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));
  expect(mocks.page.loadMore).toHaveBeenCalledWith(25);
  mocks.page.results = [{ id: 'saved', name: 'Selected' }, { id: 'saved', name: 'Selected' }]; mocks.page.status = 'Exhausted';
  view.rerender(<AdminProductPicker value="saved" onChange={vi.fn()} />);
  expect(screen.getAllByRole('option', { name: 'Selected' })).toHaveLength(1);
  expect(screen.getByText('1 matching products loaded · All matches loaded')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
});

it('preserves deleted selections and ignores stale selected-product names', () => {
  mocks.ready = { ready: true }; mocks.page.status = 'Exhausted'; mocks.selected = null;
  const change = vi.fn();
  const view = render(<AdminProductPicker value="deleted" onChange={change} />);
  expect(screen.getByRole('option', { name: 'Selected product unavailable' })).toHaveValue('deleted');
  expect(change).not.toHaveBeenCalled();
  mocks.selected = { id: 'old', name: 'Wrong old name' }; view.rerender(<AdminProductPicker value="new" onChange={change} />);
  expect(screen.queryByRole('option', { name: 'Wrong old name' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('new');
});

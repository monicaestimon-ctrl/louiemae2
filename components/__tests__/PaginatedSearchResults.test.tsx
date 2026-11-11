import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => ({
  results: [] as Array<{
    _id: string;
    url: string;
    name: string;
    category: string;
    price: number;
    currency: string;
    image: null;
    alt: string;
    availability: string;
  }>,
  status: 'CanLoadMore',
  loadMore: vi.fn(),
  calls: vi.fn(),
  error: null as Error | null,
}));
vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => {
    query.calls(...args);
    if (query.error) throw query.error;
    return query;
  },
}));
import { PaginatedSearchResults } from '../PaginatedSearchResults';
beforeEach(() => {
  query.results = [];
  query.status = 'CanLoadMore';
  query.error = null;
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps empty candidate pages traversable and renders native product links', () => {
  const select = vi.fn();
  const view = render(<PaginatedSearchResults term="chair" onSelect={select} />);
  expect(screen.getByText(/No available matches on this page/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));
  expect(query.loadMore).toHaveBeenCalledWith(20);
  query.results = [
    {
      _id: 'chair',
      name: 'Rowan Chair',
      category: 'Chair',
      price: 120,
      currency: 'USD',
      image: null,
      alt: 'Chair',
      url: '/products/chair',
      availability: 'available',
    },
  ];
  query.status = 'Exhausted';
  view.rerender(<PaginatedSearchResults term="chair" onSelect={select} />);
  expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
  const link = screen.getByRole('link', { name: /Rowan Chair/ });
  expect(link).toHaveAttribute('href', '/products/chair');
  fireEvent.click(link, { ctrlKey: true });
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(select).toHaveBeenCalledWith('chair');
});
it('bounds pending first pages and allows a clean retry without losing the term', () => {
  query.status = 'LoadingFirstPage';
  render(<PaginatedSearchResults term="lamp" onSelect={vi.fn()} />);
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText(/Your search has been kept/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Searching…')).toBeInTheDocument();
  expect(query.calls.mock.lastCall?.[1]).toEqual({ term: 'lamp' });
});

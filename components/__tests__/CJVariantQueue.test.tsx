import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CJVariantQueue } from '../CJVariantQueue';

const mocks = vi.hoisted(() => ({
  ready: true as boolean | undefined,
  results: [] as Array<Record<string, unknown>>,
  status: 'CanLoadMore', loadMore: vi.fn(), paginated: vi.fn(),
}));
vi.mock('convex/react', () => ({
  useQuery: () => mocks.ready === undefined ? undefined : { ready: mocks.ready },
  usePaginatedQuery: (...args: unknown[]) => {
    mocks.paginated(...args);
    return { results: mocks.results, status: mocks.status, loadMore: mocks.loadMore };
  },
}));
vi.mock('../CJVariantManager', () => ({ CJVariantManager: ({ targetProductId, detailOnly }: { targetProductId?: string; detailOnly: boolean }) =>
  <div data-testid="workspace">{detailOnly ? targetProductId : 'legacy'}</div>,
}));
beforeEach(() => { vi.clearAllMocks(); mocks.ready = true; mocks.results = []; mocks.status = 'CanLoadMore'; });
afterEach(cleanup);

describe('compact CJ variant queue', () => {
  it('continues past empty filtered pages without reporting an empty global queue', () => {
    render(<CJVariantQueue />);
    expect(screen.getByText(/no matches in the products checked so far/i)).toBeInTheDocument();
    expect(screen.queryByText('No products match this queue view.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));
    expect(mocks.loadMore).toHaveBeenCalledWith(25);
  });
  it('distinguishes exhausted, loading, and unverified results', () => {
    mocks.status = 'Exhausted';
    const view = render(<CJVariantQueue />);
    expect(screen.getByText('No products match this queue view.')).toBeInTheDocument();
    mocks.status = 'LoadingFirstPage'; view.rerender(<CJVariantQueue />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading matching');
    mocks.ready = false; view.rerender(<CJVariantQueue />);
    expect(screen.getByRole('status')).toHaveTextContent('being prepared');
    expect(mocks.paginated.mock.lastCall?.[1]).toBe('skip');
    expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
  });
  it('opens off-page targets and sends filters/search to bounded pagination', () => {
    render(<CJVariantQueue targetProductId="off-page" />);
    expect(screen.getByTestId('workspace')).toHaveTextContent('off-page');
    fireEvent.click(screen.getByRole('button', { name: 'All CJ products' }));
    fireEvent.change(screen.getByLabelText('Search products and variants'), { target: { value: ' rare sku ' } });
    expect(mocks.paginated.mock.lastCall?.[1]).toEqual({ filter: 'all', search: 'rare sku' });
  });
  it('shows full summary counts without treating loaded rows as global totals', () => {
    mocks.results = [{ _id: 'selected', name: 'Many options', connectionStatus: { label: 'Setup needed' },
      mappingSummary: { customerVariantCount: 150, cjVariantCount: 175, unmappedVariantCount: 130 } }];
    render(<CJVariantQueue />);
    expect(screen.getByText(/150 customer options · 175 CJ options · 130 unmapped/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 matching products loaded');
    fireEvent.click(screen.getByRole('button', { name: /many options/i }));
    expect(screen.getByTestId('workspace')).toHaveTextContent('selected');
  });
});

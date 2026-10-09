import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductHealthPanel } from '../ProductHealthPanel';
const { page, loadMore } = vi.hoisted(() => ({ page: vi.fn(), loadMore: vi.fn() }));
vi.mock('convex/react', () => ({ usePaginatedQuery: (...args: unknown[]) => page(...args) }));
const summary = { ready: true, phase: 'ready', verifiedAt: 1, inventoryCounts: {}, totalProducts: 600, productsWithIssues: 535, productsWithCjIssues: 530, productsMissingCjVariants: 12 };
beforeEach(() => { page.mockReset(); loadMore.mockReset(); page.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore }); });
describe('bounded product health panel', () => {
  it.each([undefined, { ...summary, ready: false, phase: 'backfill' }, { ...summary, ready: false, phase: 'failed' }])('never reads issue pages or reports clear before verified activation', state => {
    render(<ProductHealthPanel summary={state} />);
    expect(page).toHaveBeenCalledWith(expect.anything(), 'skip', { initialNumItems: 5 });
    expect(screen.queryByText('CJ mappings and inventory snapshots are clear.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 CJ issues')).not.toBeInTheDocument();
  });
  it('uses the exact total rather than the loaded page and allows every issue to be reached', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ productId: `p${i}`, name: `Chair ${i}`, problems: ['No images', 'Missing CJ variant mapping'] }));
    page.mockReturnValue({ results: rows, status: 'CanLoadMore', loadMore });
    render(<ProductHealthPanel summary={summary} />);
    expect(screen.getByText('530 CJ issues')).toBeInTheDocument();
    expect(screen.getByText('Showing 7 of 530 affected products.')).toBeInTheDocument();
    expect(screen.getByText('Chair 6')).toBeInTheDocument();
    expect(screen.getAllByText('Missing CJ variant mapping')).toHaveLength(7);
    expect(screen.queryByText('No images')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more issues' }));
    expect(loadMore).toHaveBeenCalledWith(25);
  });
  it.each(['LoadingFirstPage', 'Exhausted'])('does not mistake an empty %s issue page for zero total issues', status => {
    page.mockReturnValue({ results: [], status, loadMore });
    render(<ProductHealthPanel summary={summary} />);
    expect(screen.getByText('530 CJ issues')).toBeInTheDocument();
    expect(screen.queryByText('CJ mappings and inventory snapshots are clear.')).not.toBeInTheDocument();
  });
  it('shows clear only for a verified zero total and disables repeated page requests', () => {
    page.mockReturnValue({ results: [], status: 'LoadingMore', loadMore });
    const { rerender } = render(<ProductHealthPanel summary={summary} />);
    expect(screen.getByRole('button', { name: 'Loading more issues...' })).toBeDisabled();
    rerender(<ProductHealthPanel summary={{ ...summary, productsWithCjIssues: 0 }} />);
    expect(screen.getByText('CJ mappings and inventory snapshots are clear.')).toBeInTheDocument();
  });
});

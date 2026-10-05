import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CJSettings } from '../CJSettings';
const { query, paginated, action } = vi.hoisted(() => ({ query: vi.fn(), paginated: vi.fn(), action: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: (...args: unknown[]) => query(...args), usePaginatedQuery: (...args: unknown[]) => paginated(...args), useAction: () => action, useMutation: () => vi.fn() }));
vi.mock('../CJVariantManager', () => ({ CJVariantManager: () => null }));
vi.mock('../CJPricingReview', () => ({ CJPricingReview: () => null }));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const summary = { ready: true, phase: 'ready', totalProducts: 535, productsWithIssues: 12, productsWithCjIssues: 12, productsMissingCjVariants: 12 };
function setup(health: typeof summary | { ready: false; phase: string }, pending: unknown[] | undefined = []) {
  query.mockImplementation(ref => {
    switch (getFunctionName(ref)) {
      case 'productHealth:status': return health;
      case 'products:getPendingSourcing': return pending;
      case 'products:getRecentlyApproved':
      case 'products:getRejectedProducts': return [];
      default: return undefined;
    }
  });
}
beforeEach(() => { query.mockReset(); paginated.mockReset(); action.mockReset(); action.mockResolvedValue(null); paginated.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() }); });
describe('CJ dashboard health integration', () => {
  it('subscribes to summaries, retains exact diagnostic counts before issue pages load, and never starts a full audit', async () => {
    setup(summary);
    await act(async () => { render(<CJSettings />); });
    const names = query.mock.calls.map(([ref]) => getFunctionName(ref));
    expect(names).toContain('productHealth:status');
    expect(names).not.toContain('products:auditProductHealth');
    expect(screen.getByRole('button', { name: 'Reconcile All' })).toBeInTheDocument();
    expect(screen.getByText(/12 approved item\(s\) need CJ variant verification/)).toBeInTheDocument();
    expect(screen.getByText('12 CJ issues')).toBeInTheDocument();
  });
  it('shows unverified health without claiming all clear and keeps manual reconciliation available', async () => {
    setup({ ready: false, phase: 'not_started' });
    await act(async () => { render(<CJSettings />); });
    expect(screen.getByText('Checks unavailable')).toBeInTheDocument();
    expect(screen.queryByText('All cleared')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile All' })).toBeInTheDocument();
    expect(paginated).toHaveBeenCalledWith(expect.anything(), 'skip', expect.anything());
  });
  it('does not label a still-loading pending query as cleared when health already reports zero issues', async () => {
    setup({ ...summary, productsWithIssues: 0, productsWithCjIssues: 0, productsMissingCjVariants: 0 });
    query.mockImplementation(ref => getFunctionName(ref) === 'productHealth:status' ? { ...summary, productsWithCjIssues: 0, productsMissingCjVariants: 0 } : undefined);
    await act(async () => { render(<CJSettings />); });
    expect(screen.getByText('Loading pending products...')).toBeInTheDocument();
    expect(screen.queryByText('All cleared')).not.toBeInTheDocument();
  });
});

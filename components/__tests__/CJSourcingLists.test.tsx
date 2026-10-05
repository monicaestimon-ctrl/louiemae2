import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFunctionName } from 'convex/server';
import { CJSettings } from '../CJSettings';

const mocks = vi.hoisted(() => ({
  ready: true as boolean | undefined, status: 'CanLoadMore', approved: [] as Array<{ _id: string; name: string }>, jobs: [] as unknown[],
  query: vi.fn(), paginated: vi.fn(), loadMore: vi.fn(), action: vi.fn(async () => null), mutation: vi.fn(),
}));
vi.mock('convex/react', () => ({
  useAction: () => mocks.action, useMutation: () => mocks.mutation,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref); mocks.query(name, args);
    if (name === 'catalogReadiness:status') return mocks.ready === undefined ? undefined : { ready: mocks.ready };
    if (name === 'products:auditProductHealth') return { totalProducts: 0, issues: [] };
    return undefined;
  },
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref); mocks.paginated(name, args);
    return { results: args === 'skip' ? [] : name === 'catalog:recentApprovalsPage' ? mocks.approved : name === 'cjSourcingJobs:adminJobsPage' ? mocks.jobs : [],
      status: args === 'skip' ? 'LoadingFirstPage' : mocks.status, loadMore: mocks.loadMore };
  },
}));
vi.mock('../FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../CJPricingReview', () => ({ CJPricingReview: () => null }));
vi.mock('../CJVariantManager', () => ({ CJVariantManager: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.ready = true; mocks.status = 'CanLoadMore'; mocks.approved = []; mocks.jobs = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function renderSettings() {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<CJSettings />); });
  return view!;
}

describe('paginated sourcing dashboard', () => {
  it('keeps reconciliation and continuation available through empty partial pages', async () => {
    await renderSettings();
    expect(screen.queryByText('No pending sourcing products')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent approvals')).not.toBeInTheDocument();
    expect(screen.queryByText('No issues found')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile All' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load more pending products' }));
    expect(mocks.loadMore).toHaveBeenCalledWith(25);
    expect(mocks.query.mock.calls.some(([name]) => ['products:getPendingSourcing', 'products:getRecentlyApproved', 'products:getRejectedProducts'].includes(name))).toBe(false);
  });
  it('shows unavailable and loading states separately from exhausted queues', async () => {
    mocks.ready = false;
    const view = await renderSettings();
    expect(screen.getAllByText(/are temporarily unavailable/)).toHaveLength(4);
    expect(mocks.paginated.mock.calls.every(([, args]) => args === 'skip')).toBe(true);
    mocks.ready = true; mocks.status = 'LoadingFirstPage'; view.rerender(<CJSettings />);
    expect(screen.getByText('Loading pending products…')).toBeInTheDocument();
    expect(screen.queryByText('No pending sourcing products')).not.toBeInTheDocument();
    mocks.status = 'Exhausted'; view.rerender(<CJSettings />);
    expect(screen.getByText('No pending sourcing products')).toBeInTheDocument();
    expect(screen.getByText('No recent approvals')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more pending products' })).not.toBeInTheDocument();
  });
  it('shows all loaded approvals and keeps the cutoff stable until explicit refresh', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T00:00:00Z'));
    mocks.approved = Array.from({ length: 4 }, (_, i) => ({ _id: `approval-${i}`, name: `Approval ${i}` }));
    const view = await renderSettings();
    expect(screen.getByText('Approval 3')).toBeInTheDocument();
    expect(screen.getByText(/Approved since/)).toHaveTextContent('Newest first');
    const first = mocks.paginated.mock.calls.find(([name]) => name === 'catalog:recentApprovalsPage')?.[1];
    view.rerender(<CJSettings />);
    expect(mocks.paginated.mock.calls.filter(([name]) => name === 'catalog:recentApprovalsPage').at(-1)?.[1]).toEqual(first);
    fireEvent.click(screen.getByRole('button', { name: 'Load more approvals' }));
    expect(mocks.loadMore).toHaveBeenCalledWith(25);
    expect(screen.getByRole('button', { name: 'Refresh seven-day window' })).toBeEnabled();
    clock.mockReturnValue(Date.parse('2026-10-06T00:00:00Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh seven-day window' }));
    expect(mocks.paginated.mock.calls.filter(([name]) => name === 'catalog:recentApprovalsPage').at(-1)?.[1])
      .toEqual({ since: '2026-09-29T00:00:00.000Z' });
  });
  it('paginates older job history without duplicate legacy hydration and preserves reconcile IDs', async () => {
    mocks.ready = undefined;
    const view = await renderSettings();
    expect(screen.getByText('Loading sourcing jobs…')).toBeInTheDocument();
    expect(screen.queryByText('No durable sourcing jobs yet.')).not.toBeInTheDocument();
    mocks.ready = true; view.rerender(<CJSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more sourcing jobs' }));
    expect(mocks.loadMore).toHaveBeenCalledWith(5);
    expect(mocks.query.mock.calls.find(([name]) => name === 'cjSourcingJobs:getAdminOperations')?.[1]).toEqual({ includeJobs: false });
    mocks.jobs = [{ id: 'job-130', productId: 'product-130', productName: 'Older job product', state: 'rejected', updatedAt: 1, attemptCount: 1, transientFailureCount: 0 }];
    view.rerender(<CJSettings />);
    expect(screen.getByText('Older job product')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconcile' })); });
    expect(mocks.action).toHaveBeenCalledWith({ productId: 'product-130' });
    mocks.jobs = []; mocks.status = 'Exhausted'; view.rerender(<CJSettings />);
    expect(screen.getByText('No durable sourcing jobs yet.')).toBeInTheDocument();
  });
});

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogMediaReview from './CatalogMediaReview';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), verify: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({
  useAction: () => mocks.prepare,
  useMutation: () => mocks.verify,
  useConvex: () => ({ query: mocks.query }),
  usePaginatedQuery: () => ({ status: 'Exhausted', loadMore: vi.fn(), results: [{
    variantId: 'variant', productId: 'product', sku: 'FIXTURE', packId: 'pair', piecesPerPack: 2,
    color: 'Oak', name: 'Fixture chair', hasStagedSource: true, mediaHold: true, rightsHold: true,
    assets: [{ id: 'asset', role: 'hero', status: 'pending', altText: '', widths: [640, 1280], url: 'https://example.com/fixture.webp',
      rights: { basis: 'Source evidence only', evidenceRef: 'fixture source' }, rejectReason: null }],
  }] }),
}));
afterEach(cleanup);
beforeEach(() => { mocks.prepare.mockReset().mockResolvedValue({ widths: [640, 1280] }); mocks.verify.mockReset().mockResolvedValue(null); mocks.query.mockReset(); });

describe('catalog photo review', () => {
  it('requires explicit visual confirmation and description, and sends the displayed SKU and pack', async () => {
    render(<CatalogMediaReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier image preparation and review' }));
    fireEvent.click(screen.getByText(/FIXTURE · Fixture chair/));
    const approve = screen.getByRole('button', { name: 'Save visual approval' });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Accurate image description'), { target: { value: 'Oak dining chair in the supplier photograph' } });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ assetId: 'asset', approve: true,
      altText: 'Oak dining chair in the supplier photograph', sku: 'FIXTURE', pack: 'pair', color: 'Oak' }));
    expect(await screen.findByText(/Visual review saved/)).toBeVisible();
    expect(screen.getByText(/Publication rights still require review/)).toBeVisible();
  });
  it('keeps source preparation separate from visual approval', async () => {
    render(<CatalogMediaReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier image preparation and review' }));
    fireEvent.click(screen.getByText(/FIXTURE · Fixture chair/));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare uploaded source image' }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith({ variantId: 'variant' }));
    expect(await screen.findByText(/Prepared 640, 1280 pixel/)).toBeVisible();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('prepares every page sequentially while preserving exclusions and review requirements', async () => {
    mocks.query.mockResolvedValueOnce({ page: [{ variantId: 'one', sku: 'ONE', hasStagedSource: true },
      { variantId: 'excluded', sku: 'EXCLUDED', hasStagedSource: false }], isDone: false, continueCursor: 'next' })
      .mockResolvedValueOnce({ page: [{ variantId: 'two', sku: 'TWO', hasStagedSource: true }], isDone: true, continueCursor: '' });
    render(<CatalogMediaReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier image preparation and review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare all included stored sources' }));
    expect(await screen.findByText(/Preparation complete: 2 prepared · 1 excluded/)).toBeVisible();
    expect(mocks.prepare.mock.calls.map(call => call[0])).toEqual([{ variantId: 'one' }, { variantId: 'two' }]);
    expect(mocks.query.mock.calls[1][1]).toEqual({ paginationOpts: { cursor: 'next', numItems: 20 } });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

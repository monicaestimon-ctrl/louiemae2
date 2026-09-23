import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CJPricingReview } from './CJPricingReview';
const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue({ complete: false, repriced: false }),
}));
vi.mock('convex/react', () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
  useAction: () => mocks.refresh,
  usePaginatedQuery: () => ({
    results: [
      {
        _id: 'p',
        name: 'Chair',
        price: 200,
        cjProductId: 'pid',
        cjSourcingStatus: 'approved',
        cjVariantId: 'v',
        cjSku: 's',
      },
    ],
    status: 'Exhausted',
    loadMore: vi.fn(),
  }),
}));
afterEach(cleanup);
describe('CJ price review screen', () => {
  it('links to the sourced listing and never displays missing shipping as zero', async () => {
    render(<CJPricingReview />);
    expect(
      screen.getByRole('link', { name: 'Open CJ product listing', hidden: true })
    ).toHaveAttribute('href', 'https://cjdropshipping.com/product/-p-pid.html');
    expect(
      screen.getByText(
        /confirmed CJ item cost and shipping are required|Refresh CJ prices and shipping before publishing/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh 1 loaded products' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ productId: 'p' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 of 1 products have complete quotes')
    );
  });
});

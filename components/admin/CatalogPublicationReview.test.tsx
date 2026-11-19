import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { CommerceError } from '../../lib/errors';
import CatalogPublicationReview from './CatalogPublicationReview';

const mocks = vi.hoisted(() => ({
  restoreStockExcludedDraft: vi.fn(),
  releaseManualReview: vi.fn(),
  verifyCanonicalIdentity: vi.fn(),
  advance: vi.fn(),
  publish: vi.fn(),
  data: {
    stockExcluded: false,
    stage: 'imported_draft',
    holds: ['MANUAL'],
    gates: { ready: [] as string[] },
    variants: [{ id: 'variant', sku: 'CHAIR', availability: 'in_stock', holds: ['MANUAL'] }],
  },
}));
vi.mock('convex/react', () => ({
  useQuery: () => mocks.data,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    mocks[getFunctionName(ref).split(':')[1] as 'publish'],
  usePaginatedQuery: () => ({
    status: 'Exhausted',
    loadMore: vi.fn(),
    results: [
      {
        productId: 'one',
        name: 'First chair',
        stage: 'imported_draft',
        holds: ['MANUAL'],
        included: true,
      },
      {
        productId: 'two',
        name: 'Second chair',
        stage: 'imported_draft',
        holds: ['MANUAL'],
        included: true,
      },
      {
        productId: 'excluded',
        name: 'Excluded chair',
        stage: 'imported_draft',
        holds: ['MANUAL'],
        included: false,
      },
    ],
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.restoreStockExcludedDraft.mockReset().mockResolvedValue({});
  mocks.releaseManualReview.mockReset().mockResolvedValue({});
  mocks.verifyCanonicalIdentity.mockReset().mockResolvedValue({});
  mocks.advance.mockReset().mockResolvedValue(null);
  mocks.publish.mockReset().mockResolvedValue([]);
  mocks.data = {
    stockExcluded: false,
    stage: 'imported_draft',
    holds: ['MANUAL'],
    gates: { ready: [] },
    variants: [{ id: 'variant', sku: 'CHAIR', availability: 'in_stock', holds: ['MANUAL'] }],
  };
});
function open() {
  render(<CatalogPublicationReview />);
  fireEvent.click(screen.getByRole('button', { name: 'Product review and publication' }));
  fireEvent.click(screen.getByRole('button', { name: /First chair/ }));
}

it('requires explicit variants and a review note, without automatically publishing', async () => {
  open();
  const button = screen.getByRole('button', { name: 'Complete manual review' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Completed review and evidence references'), {
    target: { value: 'Source records and current product checks reviewed.' },
  });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /CHAIR/ }));
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.releaseManualReview).toHaveBeenCalledWith({
      productId: 'one',
      variantIds: ['variant'],
      reason: 'Source records and current product checks reviewed.',
    })
  );
  expect(await screen.findByText('Manual review saved. No product was published.')).toBeVisible();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Excluded chair/ })).toBeDisabled();
});

it('verifies only explicitly selected identities without releasing manual review or publishing', async () => {
  open();
  const button = screen.getByRole('button', { name: 'Verify retail and HOLM identity' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /CHAIR/ }));
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.verifyCanonicalIdentity).toHaveBeenCalledWith({
      productId: 'one',
      variantIds: ['variant'],
    })
  );
  expect(mocks.releaseManualReview).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('requires explicit destinations and sends both atomically for a ready product', async () => {
  mocks.data.stage = 'ready';
  mocks.data.holds = [];
  open();
  const button = screen.getByRole('button', { name: 'Publish reviewed product' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Louie Mae retail' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'HOLM trade' }));
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.publish).toHaveBeenCalledWith({
      productIds: ['one'],
      channels: ['retail', 'house'],
    })
  );
});

it('resets the selected variants and note when switching products and reports failed reviews', async () => {
  mocks.releaseManualReview.mockRejectedValue(
    new CommerceError('COST_REVIEW_REQUIRED', 'Current cost evidence is incomplete')
  );
  open();
  fireEvent.change(screen.getByLabelText('Completed review and evidence references'), {
    target: { value: 'Review note for first product' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /CHAIR/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Complete manual review' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Current cost evidence is incomplete');
  fireEvent.click(screen.getByRole('button', { name: /Second chair/ }));
  expect(screen.getByLabelText('Completed review and evidence references')).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: /CHAIR/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Complete manual review' })).toBeDisabled();
});

it('restores a verified restock only through an explicit selected draft action', async () => {
  mocks.data.stockExcluded = true;
  open();
  const button = screen.getByRole('button', { name: 'Restore verified restock to draft review' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /CHAIR/ }));
  fireEvent.change(screen.getByLabelText('Completed review and evidence references'), {
    target: { value: 'Verified current available-to-sell feed' },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.restoreStockExcludedDraft).toHaveBeenCalledWith({
      productId: 'one',
      variantIds: ['variant'],
      reason: 'Verified current available-to-sell feed',
    })
  );
  expect(mocks.releaseManualReview).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

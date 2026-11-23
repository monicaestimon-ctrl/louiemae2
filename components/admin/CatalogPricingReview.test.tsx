import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import CatalogPricingReview from './CatalogPricingReview';
const mock = vi.hoisted(() => ({
  call: vi.fn(),
  query: vi.fn(),
  data: {} as Record<string, unknown>,
}));
vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mock.query(args);
    return mock.data;
  },
  useMutation: (ref: unknown) => (args: unknown) => mock.call(getFunctionName(ref as never), args),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  mock.query.mockClear();
  mock.call.mockReset().mockResolvedValue('approved-price');
  mock.data = {
    reviewHash: 'a'.repeat(64),
    canApprove: true,
    name: 'Fixture bench',
    supplierCode: 'ashcroft',
    category: 'furniture',
    variant: {
      _id: 'variant',
      productId: 'product',
      supplierSku: 'BENCH',
      marginPolicyKey: 'ashcroft-20',
      referralEligible: false,
    },
    cost: {
      wholesaleMinor: 30000,
      wholesaleUnitBasis: 'selling_unit',
      mapApplicability: 'not_applicable',
    },
    prices: { retail: { packPriceMinor: 80000 }, trade: { packPriceMinor: 60000 } },
    published: [{ channel: 'retail', published: true, pricingMode: 'legacy', amountMinor: 50000 }],
    policies: [{ key: 'ashcroft-20', targetBps: 2000, eligible: true, requiresDocumentRef: false }],
    economics: {
      ok: true,
      result: {
        minimumRetailMinor: 70000,
        minimumBaseTradeMinor: 55000,
        scenarios: [
          {
            name: 'retail_direct',
            priceMinor: 80000,
            contributionMinor: 20000,
            contributionBps: 2500,
            passes: true,
          },
        ],
      },
    },
    freshness: { ok: true, result: { availability: 'in_stock', holds: [] } },
    commission: {
      ok: true,
      rates: ['base', 'active', 'top', 'elite'].map((tierKey) => ({ tierKey, rateBps: 1000 })),
    },
    exceptions: [],
    exceptionHistoryTruncated: false,
  };
});
const view = (id = 'variant') => <CatalogPricingReview variantId={id as Id<'catVariants'>} />;
function priceFields() {
  fireEvent.change(screen.getByLabelText(/Reason and evidence references/), {
    target: { value: 'Reviewed supplier evidence' },
  });
  fireEvent.change(screen.getByLabelText(/Final merchandise price/), {
    target: { value: '850.25' },
  });
}
it('submits exact cents with the displayed review hash and keeps publication explicit', async () => {
  render(view());
  priceFields();
  expect(screen.getByText(/legacy base; not a final v2 price/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Approve final price' }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith('catPricing:approvePrice', {
      variantId: 'variant',
      expectedReviewHash: 'a'.repeat(64),
      channel: 'retail',
      packPriceMinor: 85025,
      reason: 'Reviewed supplier evidence',
    })
  );
  expect(await screen.findByText(/Price approved. Refresh and republish/)).toBeInTheDocument();
  expect(mock.call).toHaveBeenCalledTimes(1);
});
it('freezes a stale form until explicit refresh and clears cross-variant draft prices', () => {
  const { rerender } = render(view());
  priceFields();
  mock.data = { ...mock.data, reviewHash: 'b'.repeat(64) };
  rerender(view());
  expect(screen.getByRole('alert')).toHaveTextContent('changed while');
  expect(screen.getByRole('button', { name: 'Approve final price' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh pricing review' }));
  expect(screen.getByLabelText(/Final merchandise price/)).toHaveValue('');
  priceFields();
  rerender(view('second'));
  expect(screen.getByRole('status')).toHaveTextContent('Loading pricing review');
  mock.data = { ...mock.data, variant: { ...(mock.data.variant as object), _id: 'second' } };
  rerender(view('second'));
  expect(screen.getByLabelText(/Final merchandise price/)).toHaveValue('');
  expect(mock.call).not.toHaveBeenCalled();
});
it('keeps finance read-only and displays server rejection without success', async () => {
  mock.data = { ...mock.data, canApprove: false };
  const { rerender } = render(view());
  expect(screen.getByRole('button', { name: 'Approve final price' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save visible exception' })).toBeDisabled();
  mock.data = {
    ...mock.data,
    canApprove: true,
    variant: { ...(mock.data.variant as object), _id: 'other' },
  };
  rerender(view('other'));
  priceFields();
  mock.call.mockRejectedValueOnce(new Error('Fixture rejected'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve final price' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText(/Price approved. Refresh/)).toBeNull();
});
it('submits an explicit four-tier product exception bound to this review', async () => {
  render(view());
  for (const tier of ['base', 'active', 'top', 'elite'])
    fireEvent.change(screen.getByLabelText(`${tier} commission percent`), {
      target: { value: '5.25' },
    });
  fireEvent.change(screen.getByLabelText('Note shown to partners'), {
    target: { value: 'Visible product exception' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save visible exception' }));
  await waitFor(() =>
    expect(mock.call).toHaveBeenCalledWith(
      'prgLinks:createException',
      expect.objectContaining({
        productId: 'product',
        reviewVariantId: 'variant',
        expectedReviewHash: 'a'.repeat(64),
        rates: ['base', 'active', 'top', 'elite'].map((tierKey) => ({ tierKey, rateBps: 525 })),
        visibleNote: 'Visible product exception',
      })
    )
  );
});

it('requests a new server review on manual refresh and scheduled time boundaries', () => {
  vi.useFakeTimers();
  const now = Date.now();
  mock.data = { ...mock.data, nextRefreshAt: now + 1000 };
  render(view());
  const original = mock.query.mock.lastCall![0].refreshKey;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh pricing review' }));
  expect(mock.query.mock.lastCall![0].refreshKey).toBe(original + 1);
  act(() => vi.advanceTimersByTime(1001));
  expect(mock.query.mock.lastCall![0].refreshKey).toBe(original + 2);
});

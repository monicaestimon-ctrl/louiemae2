import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OriginalOrderRecovery from './OriginalOrderRecovery';
import type { Id } from '../../convex/_generated/dataModel';

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  data: {
    fingerprint: 'original',
    canApprove: true,
    status: 'open',
    totalMinor: 50000,
    creditMinor: 1000,
    shippingAddress: { line1: '1 Main St', city: 'Stockton', state: 'CA', postalCode: '95206' },
    serviceTerms: { label: 'Curbside delivery' },
    lines: [
      {
        lineKey: 'line-1',
        name: 'Fixture chair',
        sku: 'SKU-1',
        supplierCode: 'zuo',
        packs: 2,
        pieces: 4,
        originZip: '95206',
        service: 'curbside',
      },
    ],
  },
}));
vi.mock('convex/react', () => ({ useQuery: () => mock.data, useMutation: () => mock.save }));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('order-1');
  mock.data.fingerprint = 'original';
});
const props = {
  id: 'exception-1' as Id<'ordPaidExceptions'>,
  verificationId: 'proof-1' as Id<'ordPaymentVerifications'>,
  eligible: true,
};
it('requires supplier evidence and explicit original-service/cost confirmation without editable prices', async () => {
  render(<OriginalOrderRecovery {...props} />);
  expect(screen.getByText(/Accepted cash total/)).toHaveTextContent('$500.00');
  expect(screen.getByRole('button', { name: 'Recover original paid order' })).toBeDisabled();
  expect(screen.getByLabelText('Available selling packs for SKU-1')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Supplier confirmation source for SKU-1'), {
    target: { value: 'Verified supplier stock source' },
  });
  fireEvent.change(screen.getByLabelText('Confirmation time for SKU-1'), {
    target: { value: '2026-11-08T10:00' },
  });
  fireEvent.change(screen.getByLabelText('Available selling packs for SKU-1'), {
    target: { value: '2' },
  });
  fireEvent.change(screen.getByLabelText('Customer agreement to original fulfillment'), {
    target: { value: 'Customer support case confirms original terms' },
  });
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'Recover original paid order' }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFingerprint: 'original',
        verificationId: 'proof-1',
        acceptedCostRisk: true,
        noPriorSupplierHandoff: true,
        confirmations: [expect.objectContaining({ lineKey: 'line-1', availablePacks: 2 })],
      })
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent('No new payment was created');
});
it('keeps notes but blocks stale order or payment inputs until an explicit reload', () => {
  const view = render(<OriginalOrderRecovery {...props} />);
  fireEvent.change(screen.getByLabelText('Customer agreement to original fulfillment'), {
    target: { value: 'Unsaved recovery notes' },
  });
  mock.data.fingerprint = 'changed';
  view.rerender(<OriginalOrderRecovery {...props} eligible={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Payment or order inputs changed');
  expect(screen.getByLabelText('Customer agreement to original fulfillment')).toHaveValue(
    'Unsaved recovery notes'
  );
  expect(screen.getByRole('button', { name: 'Recover original paid order' })).toBeDisabled();
  view.rerender(
    <OriginalOrderRecovery {...props} verificationId={'proof-2' as Id<'ordPaymentVerifications'>} />
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload recovery form (discard edits)' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Customer agreement to original fulfillment')).toHaveValue('');
});

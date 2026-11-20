import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '../../convex/_generated/dataModel';
import { InvoiceEditor } from './DeliveryOperations';
import LegacyFreightReview from './LegacyFreightReview';

const mock = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => mock.save,
  useConvex: () => ({}),
  usePaginatedQuery: () => ({}),
  useQuery: () => ({
    orderNumber: 'LM-FIXTURE',
    supplierCode: 'fixture',
    customerDeliveryMinor: 4999,
    estimatedFreightMinor: null,
    actualFreightMinor: null,
    freightVarianceMinor: null,
    note: 'Fixture',
    invoices: [],
    legacyFreight: [],
    shipments: [],
  }),
}));
afterEach(cleanup);
beforeEach(() => mock.save.mockReset().mockResolvedValue('saved'));

describe('freight accounting forms', () => {
  it('requires explicitly confirmed zero expenses before recording an invoice', async () => {
    render(<InvoiceEditor id={'order' as Id<'ordSupplierOrders'>} approver={false} />);
    const save = screen.getByRole('button', { name: 'Record invoice' });
    expect(save).toBeDisabled();
    for (const [label, value] of [
      ['reference', 'INV-1'],
      ['carrier', 'Fixture'],
      ['base ($)', '10.00'],
      ['evidence', 'Reviewed fixture'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(save).toBeDisabled();
    for (const label of ['fuel ($)', 'accessorial ($)', 'supplierFee ($)', 'credit ($)']) {
      expect(screen.getByLabelText(label)).toHaveValue('');
      fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });
    }
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          baseMinor: 1000,
          fuelMinor: 0,
          accessorialMinor: 0,
          supplierFeeMinor: 0,
          creditMinor: 0,
        })
      )
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Customer total remains unchanged');
  });

  const row = {
    _id: 'legacy',
    invoiceRef: 'OLD-1',
    actualMinor: 1000,
    review: null,
  } as unknown as React.ComponentProps<typeof LegacyFreightReview>['row'];
  it('keeps historical review decisions unavailable to finance-only staff', () => {
    render(<LegacyFreightReview row={row} invoices={[]} approver={false} />);
    expect(screen.getByText('An approver must resolve this historical entry.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('requires evidence and explanation for excluding a historical duplicate', async () => {
    render(<LegacyFreightReview row={row} invoices={[]} approver />);
    fireEvent.change(screen.getByLabelText('Resolution'), {
      target: { value: 'duplicate_or_invalid' },
    });
    const save = screen.getByRole('button', { name: 'Record historical review' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Review evidence'), {
      target: { value: 'Source fixture' },
    });
    fireEvent.change(screen.getByLabelText('Decision explanation'), {
      target: { value: 'Duplicate confirmed' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(mock.save).toHaveBeenCalledWith({
        legacyId: 'legacy',
        resolution: 'duplicate_or_invalid',
        invoiceIds: [],
        evidence: 'Source fixture',
        note: 'Duplicate confirmed',
      })
    );
  });
});

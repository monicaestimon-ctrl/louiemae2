import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import FulfillmentShipments from './FulfillmentShipments';

const mock = vi.hoisted(() => ({
  ship: vi.fn(),
  issue: vi.fn(),
  other: vi.fn(),
  data: {
    supplierOrder: {
      _id: 'supplier-1',
      status: 'submitted',
      service: 'curbside',
      submission: { handoffAt: 1 },
    },
    number: 'LM-fixture',
    address: {
      line1: '1 Fixture Street',
      line2: 'Unit 2',
      city: 'Stockton',
      state: 'CA',
      postalCode: '95206',
      country: 'US',
    },
    serviceTerms: { label: 'Curbside delivery' },
    items: [
      {
        allocationId: 'allocation-1',
        name: 'Fixture chair',
        sku: 'SKU-1',
        pieces: 4,
        shippedPieces: 1,
        remainingPieces: 3,
        status: 'open',
      },
    ],
    shipments: [
      {
        _id: 'shipment-1',
        carrier: 'Fixture carrier',
        trackingNumber: 'T-1',
        status: 'shipped',
        items: [{ name: 'Fixture chair', pieces: 1 }],
      },
    ],
  },
}));
vi.mock('convex/react', () => ({
  useQuery: () => mock.data,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return name.endsWith(':recordShipment')
      ? mock.ship
      : name.endsWith(':recordShipmentIssue')
        ? mock.issue
        : mock.other;
  },
}));
beforeEach(() => {
  mock.ship.mockReset().mockResolvedValue('shipment-2');
  mock.issue.mockReset().mockResolvedValue(undefined);
  mock.other.mockReset().mockResolvedValue(undefined);
  mock.data.items[0].shippedPieces = 1;
  mock.data.items[0].remainingPieces = 3;
});
afterEach(cleanup);
const id = 'supplier-1' as Id<'ordSupplierOrders'>;

it('locks an uncertain shipment payload and retries the same request without discarding quantities', async () => {
  mock.ship.mockRejectedValueOnce(new Error('Transport unavailable'));
  render(<FulfillmentShipments supplierOrderId={id} />);
  expect(screen.getByText(/Unit 2/)).toBeInTheDocument();
  const quantity = screen.getByLabelText('Pieces shipped: Fixture chair');
  expect(quantity).toHaveAttribute('max', '3');
  fireEvent.change(quantity, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record shipment and queue update' }));
  const retry = await screen.findByRole('button', { name: 'Retry exact shipment record' });
  expect(quantity).toBeDisabled();
  expect(quantity).toHaveValue(2);
  expect(mock.ship).toHaveBeenCalledWith(
    expect.objectContaining({
      supplierOrderId: id,
      requestKey: expect.any(String),
      items: [{ allocationId: 'allocation-1', pieces: 2 }],
    })
  );
  fireEvent.click(retry);
  await waitFor(() => expect(mock.ship).toHaveBeenCalledTimes(2));
  expect(mock.ship.mock.calls[1][0]).toEqual(mock.ship.mock.calls[0][0]);
  await waitFor(() => expect(quantity).toHaveValue(null));
});

it('separates customer updates from internal evidence and leaves email unselected', async () => {
  render(<FulfillmentShipments supplierOrderId={id} />);
  expect(
    screen.getByRole('checkbox', { name: 'Queue this update for the customer by email' })
  ).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Customer-facing update'), {
    target: { value: 'Carrier has delayed this shipment.' },
  });
  fireEvent.change(screen.getByLabelText('Internal carrier or support evidence'), {
    target: { value: 'Private carrier case reference' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));
  await waitFor(() =>
    expect(mock.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'shipment-1',
        kind: 'delayed',
        message: 'Carrier has delayed this shipment.',
        evidence: 'Private carrier case reference',
        notifyCustomer: false,
        requestKey: expect.any(String),
      })
    )
  );
  expect(mock.ship).not.toHaveBeenCalled();
});

it('offers cancellation only for an entirely unshipped allocation and requires evidence', async () => {
  mock.data.items[0].shippedPieces = 0;
  mock.data.items[0].remainingPieces = 4;
  render(<FulfillmentShipments supplierOrderId={id} />);
  const submit = screen.getByRole('button', { name: 'Record cancellation and queue notice' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Fixture chair — all 4 piece(s)' }));
  fireEvent.change(screen.getByLabelText('Supplier cancellation confirmation and reason'), {
    target: { value: 'Supplier confirmed cancellation, case fixture' },
  });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mock.other).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierOrderId: id,
        allocationIds: ['allocation-1'],
        requestKey: expect.any(String),
        reason: 'Supplier confirmed cancellation, case fixture',
      })
    )
  );
  expect(mock.ship).not.toHaveBeenCalled();
});

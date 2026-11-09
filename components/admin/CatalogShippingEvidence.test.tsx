import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CatalogShippingEvidence from './CatalogShippingEvidence';

const mock = vi.hoisted(() => ({ save: vi.fn(), data: {} as Record<string, unknown> }));
vi.mock('convex/react', () => ({
  useMutation: () => mock.save,
  useQuery: () => mock.data,
  usePaginatedQuery: () => ({
    results: [{ id: 'variant', sku: 'SKU-1', piecesPerPack: 2, availability: 'in_stock' }],
    status: 'Exhausted',
    loadMore: vi.fn(),
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('saved-observation');
  mock.data = {
    variant: { id: 'variant', sku: 'SKU-1', supplierId: 'supplier', piecesPerPack: 2 },
    warehouse: null,
    warehouses: [],
    cartons: [],
    history: [],
    fingerprint: 'first',
    canApprove: false,
  };
});
function open() {
  const view = render(<CatalogShippingEvidence />);
  fireEvent.click(screen.getByText('Warehouse and shipping carton evidence'));
  fireEvent.click(screen.getByRole('button', { name: 'SKU-1 · 2 piece(s) · in_stock' }));
  return view;
}
it('keeps shipping inputs unknown and records raw carton units without multiplying by pack pieces', async () => {
  open();
  expect(screen.queryByText('Approve warehouse evidence')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Supplier routing')).toHaveValue('unknown');
  expect(screen.getByLabelText('Fulfillment warehouse')).toHaveValue('');
  for (const [label, value] of [
    ['length', '24'],
    ['width', '20'],
    ['height', '36'],
    ['Gross weight', '30'],
    ['Shipping source reference', 'Supplier shipping sheet'],
    ['Shipping observed at (local time)', '2026-11-01T10:00'],
    ['Shipping review note', 'Verified one carton for this two-piece pack'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save shipping evidence' }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: null,
        expectedFingerprint: 'first',
        cartons: [
          {
            count: 1,
            length: '24',
            width: '20',
            height: '36',
            weight: '30',
            dimensionsUnit: 'in',
            weightUnit: 'lb',
            supplierMethod: 'unknown',
          },
        ],
      })
    )
  );
  expect(await screen.findByText(/Shipping evidence saved/)).toHaveTextContent('Prices are unchanged');
});
it('retains edited measurements on a concurrent change and requires explicit reload', () => {
  const { rerender } = open();
  fireEvent.change(screen.getByLabelText('length'), { target: { value: '40' } });
  mock.data = { ...mock.data, fingerprint: 'second' };
  rerender(<CatalogShippingEvidence />);
  expect(screen.getByRole('alert')).toHaveTextContent('Your edits are retained');
  expect(screen.getByLabelText('length')).toHaveValue('40');
  expect(screen.getByRole('button', { name: 'Save shipping evidence' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload shipping evidence (discard edits)' }));
  expect(screen.getByLabelText('length')).toHaveValue('');
});
it('offers the separately protected warehouse form only to approvers', () => {
  mock.data.canApprove = true;
  open();
  expect(screen.getByText('Approve warehouse evidence')).toBeInTheDocument();
  expect(screen.getByLabelText('IANA timezone')).toHaveValue('');
  expect(screen.getByLabelText('ground dispatch documented')).not.toBeChecked();
  expect(screen.getByLabelText('ltl dispatch documented')).not.toBeChecked();
});

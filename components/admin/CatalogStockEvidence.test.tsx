import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Id } from '../../convex/_generated/dataModel';
import CatalogStockEvidence from './CatalogStockEvidence';
const mock = vi.hoisted(() => ({ save: vi.fn(), data: {} as Record<string, unknown> }));
vi.mock('convex/react', () => ({ useMutation: () => mock.save, useQuery: () => mock.data }));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('stock-revision');
  mock.data = {
    variant: {
      id: 'variant',
      sku: 'SKU-1',
      piecesPerPack: 2,
      warehouseId: 'warehouse',
      availability: 'unknown',
    },
    warehouse: { code: 'CA', originZip: '95206' },
    warehouseFingerprint: 'warehouse-v1',
    current: null,
    history: [],
    canReactivate: false,
  };
});
const view = () => <CatalogStockEvidence variantId={'variant' as Id<'catVariants'>} />;
function open() {
  const result = render(view());
  fireEvent.click(screen.getByText('Warehouse stock evidence · SKU-1'));
  return result;
}
it('starts unverified and never infers count units or zero stock', async () => {
  open();
  expect(screen.getByLabelText('Stock source meaning')).toHaveValue('unknown');
  expect(screen.getByLabelText('Stock quantity basis')).toHaveValue('unknown');
  expect(screen.getByLabelText('Supplier stock quantity (blank means unknown)')).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  for (const [label, value] of [
    ['Stock source reference', 'Supplier warehouse feed'],
    ['Stock observed at (local time)', '2026-11-01T10:00'],
    ['Stock review note', 'Quantity basis not established'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save stock evidence' }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: null,
        unitBasis: 'unknown',
        kind: 'unknown',
        confirmed: false,
        expectedWarehouseFingerprint: 'warehouse-v1',
      })
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Original exclusions and manual release holds remain'
  );
});
it('retains edits and rejects stale origin evidence even when the warehouse ID is unchanged', () => {
  const { rerender } = open();
  fireEvent.change(screen.getByLabelText('Supplier stock quantity (blank means unknown)'), {
    target: { value: '20' },
  });
  mock.data = { ...mock.data, warehouseFingerprint: 'warehouse-v2' };
  rerender(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Your edits are retained');
  expect(screen.getByRole('button', { name: 'Save stock evidence' })).toBeDisabled();
  expect(screen.getByLabelText('Supplier stock quantity (blank means unknown)')).toHaveValue('20');
});
it('makes binary status explicitly quantity-free', () => {
  open();
  fireEvent.change(screen.getByLabelText('Supplier stock quantity (blank means unknown)'), {
    target: { value: '20' },
  });
  fireEvent.change(screen.getByLabelText('Stock source meaning'), { target: { value: 'binary' } });
  expect(screen.getByLabelText('Supplier stock quantity (blank means unknown)')).toBeDisabled();
  expect(screen.getByLabelText('Supplier stock quantity (blank means unknown)')).toHaveValue('');
});

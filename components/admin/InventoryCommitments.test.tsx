import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InventoryCommitments from './InventoryCommitments';
import type { Id } from '../../convex/_generated/dataModel';

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  data: {
    canReconcile: true,
    currentRevisionId: 'stock-1' as string | null,
    currentAshcroftFeedId: null as string | null,
    supplierCode: 'zuo',
    ashcroftSource: null as { source: string; observedAt: number; validUntil: number; quantity: number | null } | null,
    hasMore: false,
    rows: [
      {
        id: 'reservation-1',
        intentId: 'intent-1',
        packs: 2,
        warehouseId: 'warehouse-1',
        piecesPerPack: 2,
        inventoryBasis: null as string | null,
        supplierSku: null as string | null,
      },
    ],
  },
}));
vi.mock('convex/react', () => ({ useMutation: () => mock.save, useQuery: () => mock.data }));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('reservation-1');
  mock.data.currentRevisionId = 'stock-1';
  mock.data.currentAshcroftFeedId = null;
  mock.data.supplierCode = 'zuo';
  mock.data.ashcroftSource = null;
  mock.data.rows[0].inventoryBasis = null;
  mock.data.rows[0].supplierSku = null;
  mock.data.canReconcile = true;
});

it('uses Ashcroft selling-unit feed evidence without inventing a warehouse revision', async () => {
  mock.data.supplierCode = 'ashcroft';
  mock.data.currentRevisionId = null;
  mock.data.currentAshcroftFeedId = 'feed-1';
  mock.data.rows[0].inventoryBasis = 'ashcroft_selling_unit';
  mock.data.rows[0].supplierSku = 'BEN123';
  view();
  expect(screen.getByText(/2 selling unit\(s\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation reservation-1' }));
  fireEvent.change(screen.getByLabelText('Supplier allocation evidence reference'), { target: { value: 'Supplier acknowledgement fixture' } });
  fireEvent.change(screen.getByLabelText('Reconciliation note'), { target: { value: 'New selling-unit count includes this paid order' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile supplier allocation' }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  expect(mock.save.mock.calls[0][0]).toMatchObject({ expectedAshcroftFeedId: 'feed-1', confirmed: true });
  expect(mock.save.mock.calls[0][0]).not.toHaveProperty('expectedRevisionId');
});

it('retains notes and requires a new review when the Ashcroft feed changes', () => {
  mock.data.supplierCode = 'ashcroft';
  mock.data.currentRevisionId = null;
  mock.data.currentAshcroftFeedId = 'feed-1';
  const result = view();
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation reservation-1' }));
  fireEvent.change(screen.getByLabelText('Reconciliation note'), { target: { value: 'Keep this note' } });
  mock.data.currentAshcroftFeedId = 'feed-2';
  result.rerender(<InventoryCommitments variantId={'variant' as Id<'catVariants'>} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Stock or allocation changed');
  expect(screen.getByLabelText('Reconciliation note')).toHaveValue('Keep this note');
  expect(screen.getByRole('button', { name: 'Reconcile supplier allocation' })).toBeDisabled();
});
const view = () => render(<InventoryCommitments variantId={'variant' as Id<'catVariants'>} />);
it.each([null, 0])('distinguishes unknown from zero supplier quantity (%s)', quantity => {
  mock.data.supplierCode = 'ashcroft';
  mock.data.ashcroftSource = { source: 'Fixture supplier feed', observedAt: 1795392000000, validUntil: 1795651200000, quantity };
  view();
  expect(screen.getByText(/Latest supplier feed:/)).toHaveTextContent(`supplier count: ${quantity ?? 'Unknown'} selling units before our commitments`);
});
it('requires explicit confirmation and binds evidence to the selected stock revision', async () => {
  view();
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation reservation-1' }));
  const save = screen.getByRole('button', { name: 'Reconcile supplier allocation' });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Supplier allocation evidence reference'), {
    target: { value: 'Supplier PO confirmation' },
  });
  fireEvent.change(screen.getByLabelText('Reconciliation note'), {
    target: { value: 'Verified new ATS excludes this paid allocation' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'reservation-1',
        expectedRevisionId: 'stock-1',
        confirmed: true,
      })
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Supplier allocation reconciled');
});
it('retains staff notes but blocks stale stock evidence, and hides approval actions from operations', () => {
  const result = view();
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation reservation-1' }));
  fireEvent.change(screen.getByLabelText('Reconciliation note'), {
    target: { value: 'Unsaved review note' },
  });
  mock.data.currentRevisionId = 'stock-2';
  result.rerender(<InventoryCommitments variantId={'variant' as Id<'catVariants'>} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Stock or allocation changed');
  expect(screen.getByLabelText('Reconciliation note')).toHaveValue('Unsaved review note');
  expect(screen.getByRole('button', { name: 'Reconcile supplier allocation' })).toBeDisabled();
  mock.data.canReconcile = false;
  result.rerender(<InventoryCommitments variantId={'variant' as Id<'catVariants'>} />);
  expect(screen.queryByRole('button', { name: /Review allocation/ })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Reconcile supplier allocation' })
  ).not.toBeInTheDocument();
});

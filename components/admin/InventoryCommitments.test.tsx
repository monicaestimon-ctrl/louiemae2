import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InventoryCommitments from './InventoryCommitments';
import type { Id } from '../../convex/_generated/dataModel';

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  data: {
    canReconcile: true,
    currentRevisionId: 'stock-1',
    hasMore: false,
    rows: [
      {
        id: 'reservation-1',
        intentId: 'intent-1',
        packs: 2,
        warehouseId: 'warehouse-1',
        piecesPerPack: 2,
      },
    ],
  },
}));
vi.mock('convex/react', () => ({ useMutation: () => mock.save, useQuery: () => mock.data }));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('reservation-1');
  mock.data.currentRevisionId = 'stock-1';
  mock.data.canReconcile = true;
});
const view = () => render(<InventoryCommitments variantId={'variant' as Id<'catVariants'>} />);
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

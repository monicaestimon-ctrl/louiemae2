import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Id } from '../../convex/_generated/dataModel';
import CatalogCostEvidence from './CatalogCostEvidence';

const mock = vi.hoisted(() => ({ save: vi.fn(), data: {} as Record<string, unknown> }));
vi.mock('convex/react', () => ({ useMutation: () => mock.save, useQuery: () => mock.data }));
afterEach(cleanup);
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue('revision-two');
  mock.data = {
    variant: { _id: 'variant', supplierSku: 'SKU-1', piecesPerPack: 2 },
    current: {
      _id: 'revision-one',
      wholesaleMinor: 11500,
      dutiesMinor: null,
      inboundFreightMinor: null,
      supplierFeesMinor: null,
      mapApplicability: 'unknown',
      mapUnitBasis: 'piece',
    },
    history: [],
    canApproveMap: false,
  };
});
const view = () => <CatalogCostEvidence variantId={'variant' as Id<'catVariants'>} />;
function completeSource() {
  fireEvent.change(screen.getByLabelText('Evidence reference'), {
    target: { value: 'Reviewed supplier SKU sheet' },
  });
  fireEvent.change(screen.getByLabelText('Source observation time (your local time)'), {
    target: { value: '2026-11-01T10:00' },
  });
  fireEvent.change(screen.getByLabelText('Review note / basis for zero expenses'), {
    target: { value: 'Domestic price includes duty' },
  });
}
it('does not silently verify costs or turn unknown expenses into zero', async () => {
  render(view());
  expect(screen.getByLabelText('Duties per pack')).toHaveValue('unknown');
  expect(screen.getByLabelText('Inbound freight per pack')).toHaveValue('unknown');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  completeSource();
  fireEvent.change(screen.getByLabelText('Duties per pack'), {
    target: { value: 'confirmed_zero' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save evidence revision' }));
  await waitFor(() =>
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionId: 'revision-one',
        verified: false,
        duties: { state: 'confirmed_zero' },
        inbound: { state: 'unknown' },
        fees: { state: 'unknown' },
        map: { state: 'unknown' },
      })
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Prices are unchanged');
});
it('retains edits when the server revision changes and requires an explicit reload', () => {
  const { rerender } = render(view());
  const label = 'Wholesale USD per piece (blank means unknown)';
  fireEvent.change(screen.getByLabelText(label), { target: { value: '120.00' } });
  mock.data = {
    ...mock.data,
    current: { _id: 'revision-two', wholesaleMinor: 11900, mapApplicability: 'unknown' },
  };
  rerender(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Your edits are retained');
  expect(screen.getByLabelText(label)).toHaveValue('120.00');
  expect(screen.getByRole('button', { name: 'Save evidence revision' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest evidence (discard edits)' }));
  expect(screen.getByLabelText(label)).toHaveValue('119.00');
});
it('reuses the exact retry key after an uncertain save and changes it when input changes', async () => {
  mock.save.mockRejectedValue(new Error('Network unavailable'));
  render(view());
  completeSource();
  const button = screen.getByRole('button', { name: 'Save evidence revision' });
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  expect(mock.save.mock.calls[0][0].requestKey).toBe(mock.save.mock.calls[1][0].requestKey);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Wholesale USD per piece (blank means unknown)'), {
    target: { value: '116' },
  });
  fireEvent.click(button);
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(3));
  expect(mock.save.mock.calls[2][0].requestKey).not.toBe(mock.save.mock.calls[0][0].requestKey);
});

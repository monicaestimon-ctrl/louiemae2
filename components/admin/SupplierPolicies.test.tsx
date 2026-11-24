import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SupplierPolicies from './SupplierPolicies';
const mock = vi.hoisted(() => ({ save: vi.fn(), records: [] as unknown[], query: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => mock.save, useQuery: (_ref: unknown, args: unknown) => { mock.query(args); return mock.records; } }));
beforeEach(() => { mock.save.mockReset(); mock.query.mockClear(); mock.records = []; });
afterEach(cleanup);
function fill() {
  fireEvent.change(screen.getByLabelText('Evidence status'), { target: { value: 'documented' } });
  fireEvent.change(screen.getByLabelText('Supplier SKUs (one per line)'), { target: { value: 'A\nB\nA' } });
  fireEvent.change(screen.getByLabelText('Policy summary'), { target: { value: 'Supplier permits these images.' } });
  fireEvent.change(screen.getByLabelText('Source references (one per line)'), { target: { value: 'Dealer packet, image section\n' } });
}
it('saves only the selected supplier and scope, blocks repeated saves, and confirms completion', async () => {
  let complete!: () => void;
  mock.save.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  render(<SupplierPolicies canApprove />); fill();
  const button = screen.getByRole('button', { name: 'Save supplier policy' });
  fireEvent.click(button);
  expect(mock.save).toHaveBeenCalledWith({ supplierCode: 'zuo', kind: 'media', status: 'documented', summary: 'Supplier permits these images.', evidenceRefs: ['Dealer packet, image section'], scope: { skus: ['A', 'B'] } });
  expect(screen.getByLabelText('Supplier')).toBeDisabled();
  fireEvent.submit(button.closest('form')!);
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  expect(screen.getByRole('status')).toHaveTextContent('Supplier policy saved.');
});
it('shows failures and preserves input for retry, then clears evidence when switching suppliers', async () => {
  mock.save.mockRejectedValueOnce({ data: { message: 'Approval permission changed.' } });
  render(<SupplierPolicies canApprove />); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Save supplier policy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Approval permission changed.');
  expect(screen.getByLabelText('Policy summary')).toHaveValue('Supplier permits these images.');
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ashcroft' } });
  expect(screen.getByLabelText('Policy summary')).toHaveValue('');
  expect(screen.getByLabelText('Source references (one per line)')).toHaveValue('');
  expect(mock.query).toHaveBeenLastCalledWith({ supplierCode: 'ashcroft' });
});
it('keeps readers read-only and lets approvers revise recorded evidence', async () => {
  mock.records = [{ _id: 'p', kind: 'media', status: 'documented', summary: 'Existing permission', evidenceRefs: ['Letter'], scope: { all: true }, createdAt: 1, createdBy: 'owner' }];
  const view = render(<SupplierPolicies canApprove={false} />);
  expect(screen.queryByRole('button', { name: 'Save supplier policy' })).not.toBeInTheDocument();
  expect(screen.getByText('Existing permission')).toBeInTheDocument();
  view.rerender(<SupplierPolicies canApprove />);
  fireEvent.click(screen.getByRole('button', { name: 'Revise Product images policy' }));
  expect(screen.getByLabelText('Policy summary')).toHaveValue('Existing permission');
  expect(screen.getByLabelText('Applies to all supplier products')).toBeChecked();
  expect(screen.queryByLabelText('Supplier SKUs (one per line)')).not.toBeInTheDocument();
});
it('rejects incomplete documented evidence before sending any command', async () => {
  render(<SupplierPolicies canApprove />);
  fireEvent.change(screen.getByLabelText('Evidence status'), { target: { value: 'documented' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save supplier policy' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('include source references'));
  expect(mock.save).not.toHaveBeenCalled();
});

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PaidExceptionReview from './PaidExceptionReview';

const mock = vi.hoisted(() => ({
  verify: vi.fn(),
  close: vi.fn(),
  data: {
    exception: { status: 'open', paymentStateVersion: 0 },
    canApprove: true,
    proof: {
      _id: 'proof-1',
      captured: true,
      disputed: false,
      currency: 'usd',
      amountMinor: 10000,
      succeededRefundMinor: 10000,
      pendingRefundMinor: 0,
      validUntil: Date.now() + 300000,
      paymentStateVersion: 0,
    },
  },
}));
vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: { id?: string }) =>
    args.id
      ? mock.data
      : [{ _id: 'exception-1', reason: 'stock_failed', paymentIntentId: 'pi_fixture' }],
  useAction: () => mock.verify,
  useMutation: () => mock.close,
}));
afterEach(cleanup);
beforeEach(() => {
  mock.verify.mockReset().mockResolvedValue('proof-1');
  mock.close.mockReset().mockResolvedValue('exception-1');
  mock.data.canApprove = true;
  mock.data.proof._id = 'proof-1';
  mock.data.proof.pendingRefundMinor = 0;
  mock.data.proof.succeededRefundMinor = 10000;
  mock.data.proof.paymentStateVersion = 0;
  mock.data.exception.paymentStateVersion = 0;
});
function open() {
  const result = render(<PaidExceptionReview />);
  fireEvent.click(screen.getByRole('button', { name: 'stock_failed · pi_fixture' }));
  return result;
}
it('keeps notes and blocks a previously verified proof after a provider update', async () => {
  const view = open();
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing payment and refunds' }));
  await waitFor(() => expect(mock.verify).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Customer agreement reference and note'), { target: { value: 'Keep these support notes' } });
  mock.data.exception.paymentStateVersion = 1;
  view.rerender(<PaidExceptionReview />);
  expect(screen.getByText(/provider reported a payment change/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record completed refund resolution' })).toBeDisabled();
  expect(screen.getByLabelText('Customer agreement reference and note')).toHaveValue('Keep these support notes');
  expect(mock.close).not.toHaveBeenCalled();
});
it('requires read-only verification, customer agreement and supplier confirmation before recording refund closure', async () => {
  open();
  const close = screen.getByRole('button', { name: 'Record completed refund resolution' });
  expect(close).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing payment and refunds' }));
  await waitFor(() => expect(mock.verify).toHaveBeenCalledWith({ id: 'exception-1' }));
  expect(mock.close).not.toHaveBeenCalled();
  expect(close).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Customer agreement reference and note'), {
    target: { value: 'Customer support case approved cancellation' },
  });
  fireEvent.change(screen.getByLabelText('Supplier cancellation or verified no-handoff evidence'), {
    target: { value: 'No supplier handoff occurred' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(close);
  await waitFor(() =>
    expect(mock.close).toHaveBeenCalledWith(
      expect.objectContaining({ verificationId: 'proof-1', noOutstandingFulfillment: true })
    )
  );
});
it('blocks pending and changed proof while retaining notes, and hides approval from finance-only staff', async () => {
  mock.data.proof.pendingRefundMinor = 10000;
  mock.data.proof.succeededRefundMinor = 0;
  const result = open();
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing payment and refunds' }));
  await screen.findByText('Read-only verification saved. Review the result below.');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Record completed refund resolution' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Customer agreement reference and note'), {
    target: { value: 'Unsaved case notes' },
  });
  mock.data.proof._id = 'proof-2';
  mock.data.proof.pendingRefundMinor = 0;
  mock.data.proof.succeededRefundMinor = 10000;
  result.rerender(<PaidExceptionReview />);
  expect(screen.getByLabelText('Customer agreement reference and note')).toHaveValue(
    'Unsaved case notes'
  );
  expect(screen.getByRole('button', { name: 'Record completed refund resolution' })).toBeDisabled();
  mock.data.canApprove = false;
  result.rerender(<PaidExceptionReview />);
  expect(
    screen.queryByRole('button', { name: 'Record completed refund resolution' })
  ).not.toBeInTheDocument();
});

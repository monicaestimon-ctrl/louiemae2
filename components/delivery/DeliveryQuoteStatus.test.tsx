import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import DeliveryQuoteStatus from './DeliveryQuoteStatus';

const state = vi.hoisted(() => ({ value: null as unknown, close: vi.fn(), other: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: () => state.value,
  useMutation: (ref: unknown) =>
    getFunctionName(ref as never).endsWith(':closeRequest') ? state.close : state.other,
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => null }));
const request = {
  id: 'request-fixture' as Id<'dlvQuoteRequests'>,
  guestCapability: 'a'.repeat(64),
};
beforeEach(() => {
  state.close.mockReset();
  state.other.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('private delivery request lifecycle UI', () => {
  it('bounds pending quote status without accepting or preparing any payment', () => {
    vi.useFakeTimers(); state.value = undefined;
    render(<DeliveryQuoteStatus request={request} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(/Quote status temporarily unavailable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload quote' })).toBeTruthy();
    expect(state.other).not.toHaveBeenCalled();
  });
  it('closes a request with its private capability and shows a saved result', async () => {
    state.value = {
      status: 'requested',
      orderPlaced: false,
      quote: null,
      lines: [],
      message: null,
    };
    state.close.mockResolvedValue({ status: 'cancelled' });
    render(<DeliveryQuoteStatus request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    await screen.findByText('Your request is closed. No payment was made.');
    expect(state.close).toHaveBeenCalledWith(
      expect.objectContaining({ ...request, outcome: 'cancelled' })
    );
    expect(state.other).not.toHaveBeenCalled();
  });
  it('offers retry after a failed close and never shows a false success', async () => {
    state.value = {
      status: 'requested',
      orderPlaced: false,
      quote: null,
      lines: [],
      message: null,
    };
    state.close.mockRejectedValue(new Error('Network failed'));
    render(<DeliveryQuoteStatus request={request} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel this request' })).toBeEnabled()
    );
    expect(
      screen.queryByText('Your request is closed. No payment was made.')
    ).not.toBeInTheDocument();
  });
  it('shows converted orders without acceptance, cancellation or payment actions', () => {
    state.value = { status: 'converted', orderPlaced: true, quote: null, lines: [], message: null };
    render(<DeliveryQuoteStatus request={request} />);
    expect(screen.getByText(/Your quote has become an order/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

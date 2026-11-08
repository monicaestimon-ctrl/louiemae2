import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutSuccess from './CheckoutSuccess';
import { cartLines, checkoutAccess, rememberCheckout } from '../../lib/delivery/checkoutReturn';
import type { CartItem } from '../../contexts/CartContext';

const mock = vi.hoisted(() => ({
  result: undefined as any,
  clear: vi.fn(),
  items: [] as CartItem[],
  query: vi.fn(),
}));
vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mock.query(args);
    return mock.result;
  },
}));
vi.mock('../../contexts/CartContext', () => ({
  useCart: () => ({ items: mock.items, clearCart: mock.clear }),
}));
beforeEach(() => {
  mock.clear.mockReset();
  mock.query.mockReset();
  mock.result = undefined;
  mock.items = [{ product: { id: 'p', variants: [{ id: 'v' }] }, quantity: 1 } as CartItem];
  sessionStorage.clear();
  window.location.hash = '#checkout/success?session_id=cs_fixture';
});
describe('verified checkout return', () => {
  it('does not confirm or clear for loading, pending, review, failed or inaccessible payment', () => {
    rememberCheckout('cs_fixture', 'a'.repeat(64), cartLines(mock.items));
    const view = render(<CheckoutSuccess />);
    expect(mock.clear).not.toHaveBeenCalled();
    for (const state of ['pending', 'review_required', 'not_completed', 'unavailable']) {
      mock.result = { state };
      view.rerender(<CheckoutSuccess />);
      expect(screen.queryByText('Order confirmed')).not.toBeInTheDocument();
      expect(mock.clear).not.toHaveBeenCalled();
    }
    expect(mock.query).toHaveBeenCalledWith({
      sessionId: 'cs_fixture',
      guestCapability: 'a'.repeat(64),
    });
  });
  it('clears a matching cart once only after confirmation, shows separate shipments and truthful email status', () => {
    rememberCheckout('cs_fixture', 'a'.repeat(64), cartLines(mock.items));
    const view = render(<CheckoutSuccess />);
    mock.result = {
      state: 'confirmed',
      emailStatus: 'pending',
      order: {
        number: 'LM-TEST',
        statusLabel: 'Order confirmed',
        totals: {
          merchandise: 10000,
          delivery: 4999,
          tax: 1000,
          total: 15999,
          credit: 0,
          discount: 0,
        },
        disclosure: 'Your order will arrive in separate shipments.',
        shipments: [],
        serviceTerms: null,
      },
    };
    view.rerender(<CheckoutSuccess />);
    expect(mock.clear).toHaveBeenCalledTimes(1);
    expect(checkoutAccess('cs_fixture')?.cart).toBeUndefined();
    expect(screen.getByText(/queued for sending/)).toBeInTheDocument();
    expect(screen.getByText(/will arrive in separate shipments/)).toBeInTheDocument();
    mock.result = { ...mock.result, emailStatus: 'accepted' };
    view.rerender(<CheckoutSuccess />);
    expect(screen.getByText(/accepted by our email provider/)).toBeInTheDocument();
    expect(mock.clear).toHaveBeenCalledTimes(1);
  });
  it('preserves a changed cart and carts not associated with the checkout (including quote payments)', () => {
    rememberCheckout('cs_fixture', undefined, cartLines(mock.items));
    mock.items = [{ ...mock.items[0], quantity: 2 }];
    mock.result = { state: 'legacy_confirmed', disclosure: 'May arrive separately.' };
    const view = render(<CheckoutSuccess />);
    expect(mock.clear).not.toHaveBeenCalled();
    view.unmount();
    rememberCheckout('cs_fixture', 'a'.repeat(64));
    render(<CheckoutSuccess />);
    expect(mock.clear).not.toHaveBeenCalled();
    expect(screen.getByText(/Email delivery is not verified/)).toBeInTheDocument();
  });
  it('explains delayed confirmation without inviting another payment', () => {
    vi.useFakeTimers();
    try {
      mock.result = { state: 'pending' };
      const view = render(<CheckoutSuccess />);
      act(() => vi.advanceTimersByTime(30000));
      expect(screen.getByText(/do not pay again/)).toBeInTheDocument();
      expect(mock.clear).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

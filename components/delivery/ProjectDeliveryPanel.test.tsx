import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ flags: { tradeCheckout: true, delivery: true }, pending: false, failed: false }));
vi.mock('convex/react', () => ({ useQueries: (queries: object) => Object.keys(queries).length ? { result: state.failed ? new Error('Unavailable') : state.pending ? undefined : state.flags } : {} }));
vi.mock('./CheckoutV2', () => ({ DeliveryCheckout: ({ lines }: { lines: unknown[] }) => <div>Checkout {JSON.stringify(lines)}</div> }));
vi.mock('./DeliveryQuoteRequest', () => ({ default: ({ lines }: { lines: unknown[] }) => <div>Quote {JSON.stringify(lines)}</div> }));
import ProjectDeliveryPanel from './ProjectDeliveryPanel';
const lines = [{ productId: 'zuo', variantId: 'exact-variant', packs: 3 }];
beforeEach(() => { state.flags = { tradeCheckout: true, delivery: true }; state.pending = false; state.failed = false; });
afterEach(() => vi.useRealTimers());

describe('project delivery route', () => {
  it('blocks checkout after a timeout and allows a manual recovery', () => {
    vi.useFakeTimers(); state.pending = true;
    render(<ProjectDeliveryPanel lines={lines} automatic approved />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText(/Project checkout availability could not be verified/)).toBeInTheDocument();
    expect(screen.queryByText(/^Checkout /)).toBeNull();
    state.pending = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry checkout availability' }));
    expect(screen.getByText(`Checkout ${JSON.stringify(lines)}`)).toBeInTheDocument();
  });
  it('does not show checkout or quote controls on a settings error', () => {
    state.failed = true;
    render(<ProjectDeliveryPanel lines={lines} automatic approved />);
    expect(screen.getByText(/Project checkout availability could not be verified/)).toBeInTheDocument();
    expect(screen.queryByText(/^Checkout /)).toBeNull();
    expect(screen.queryByText(/^Quote /)).toBeNull();
  });
  it('requires approved trade membership', () => {
    render(<ProjectDeliveryPanel lines={lines} automatic approved={false} />);
    expect(screen.getByText(/Sign in with an approved trade account/)).toBeTruthy();
    expect(screen.queryByText(/^Checkout /)).toBeNull();
  });
  it('passes exact packs into checkout when enabled', () => {
    render(<ProjectDeliveryPanel lines={lines} automatic approved />);
    expect(screen.getByText(`Checkout ${JSON.stringify(lines)}`)).toBeTruthy();
  });
  it('keeps every supplier in a mixed-project quote', () => {
    const mixed = [...lines, { productId: 'ashcroft', variantId: 'supplier-variant', packs: 2 }];
    render(<ProjectDeliveryPanel lines={mixed} automatic={false} approved />);
    expect(screen.getByText(`Quote ${JSON.stringify(mixed)}`)).toBeTruthy();
    expect(screen.queryByText(/^Checkout /)).toBeNull();
  });
  it('respects the checkout kill switch', () => {
    state.flags.tradeCheckout = false;
    render(<ProjectDeliveryPanel lines={lines} automatic approved />);
    expect(screen.queryByText(/^Checkout /)).toBeNull();
    expect(screen.queryByText(/^Quote /)).toBeNull();
  });
});

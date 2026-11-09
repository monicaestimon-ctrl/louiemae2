import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ flags: { tradeCheckout: true, delivery: true } }));
vi.mock('convex/react', () => ({ useQuery: () => state.flags }));
vi.mock('./CheckoutV2', () => ({ DeliveryCheckout: ({ lines }: { lines: unknown[] }) => <div>Checkout {JSON.stringify(lines)}</div> }));
vi.mock('./DeliveryQuoteRequest', () => ({ default: ({ lines }: { lines: unknown[] }) => <div>Quote {JSON.stringify(lines)}</div> }));
import ProjectDeliveryPanel from './ProjectDeliveryPanel';
const lines = [{ productId: 'zuo', variantId: 'exact-variant', packs: 3 }];
beforeEach(() => { state.flags = { tradeCheckout: true, delivery: true }; });
describe('project delivery route', () => {
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

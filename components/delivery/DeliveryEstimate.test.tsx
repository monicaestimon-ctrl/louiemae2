import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import ProductDeliveryEstimate from './ProductDeliveryEstimate';

const mock = vi.hoisted(() => ({ estimate: vi.fn(), request: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never).endsWith('.enabled') ||
    getFunctionName(ref as never).endsWith(':enabled')
      ? true
      : getFunctionName(ref as never).includes('productProfile')
        ? { piecesPerPack: 2, minimumPacks: 3, incrementPacks: 2 }
        : undefined,
  useAction: () => mock.estimate,
  useMutation: () => mock.request,
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => null }));
beforeEach(() => {
  mock.estimate.mockReset();
  mock.request.mockReset();
});
const response = (amount: number) => ({
  status: 'ok',
  deliveryChargeMinor: amount,
  serviceName: 'Curbside delivery',
  timingCaveat: 'Delivery timing is confirmed separately.',
  expiresAt: Date.now() + 60000,
});
describe('shared delivery product UI', () => {
  it('uses confirmed pack minimums and physical piece labels', async () => {
    mock.estimate.mockResolvedValue(response(5999));
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    const packs = screen.getByRole('spinbutton');
    expect(packs).toHaveValue(3);
    expect(packs).toHaveAttribute('step', '2');
    expect(screen.getByText(/2 pieces each/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    await screen.findByText('Curbside delivery: $59.99');
    expect(mock.estimate.mock.calls[0][0].lines[0].packs).toBe(3);
  });
  it('does not replace a newer destination result when an older request arrives last', async () => {
    let oldResolve!: (x: unknown) => void;
    mock.estimate
      .mockImplementationOnce(() => new Promise((r) => (oldResolve = r)))
      .mockResolvedValueOnce(response(8999));
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    await waitFor(() => expect(mock.estimate).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '85001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    await screen.findByText('Curbside delivery: $89.99');
    await act(async () => oldResolve(response(5999)));
    expect(screen.queryByText('Curbside delivery: $59.99')).not.toBeInTheDocument();
    expect(screen.getByText('Curbside delivery: $89.99')).toBeInTheDocument();
  });
  it('opens a real quote form for a quote-only destination', async () => {
    mock.estimate.mockResolvedValue({ status: 'quote_required', deliveryChargeMinor: null });
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '99501' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request a delivery quote' }));
    expect(screen.getByLabelText('Quote contact email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send delivery request' })).toBeDisabled();
  });
});

vi.mock('./useDeliveryRequest', () => ({
  useDeliveryRequest: (operation: string) =>
    operation === 'estimate' ? mock.estimate : mock.request,
}));
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import ProductDeliveryEstimate from './ProductDeliveryEstimate';

const mock = vi.hoisted(() => ({ estimate: vi.fn(), request: vi.fn(), enabled: true, missing: false, projectQuote: false }));
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never).endsWith('.enabled') ||
    getFunctionName(ref as never).endsWith(':enabled')
      ? mock.enabled
      : getFunctionName(ref as never).includes('productProfile')
        ? mock.missing ? null : { piecesPerPack: 2, minimumPacks: 3, incrementPacks: 2, requiresProjectQuote: mock.projectQuote }
        : undefined,
  useAction: () => mock.estimate,
  useMutation: () => mock.request,
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => null }));
beforeEach(() => {
  mock.estimate.mockReset();
  mock.request.mockReset();
  mock.enabled = true;
  mock.missing = false;
  mock.projectQuote = false;
});
const response = (amount: number) => ({
  status: 'ok',
  deliveryChargeMinor: amount,
  serviceName: 'Curbside delivery',
  timingCaveat: 'Delivery timing is confirmed separately.',
  expiresAt: Date.now() + 60000,
});
describe('shared delivery product UI', () => {
  it('routes project-only supplier trade delivery to the project quote workflow', () => {
    mock.projectQuote = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" />);
    expect(screen.getByText('Add this item to your project to request confirmed delivery pricing.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estimate delivery' })).not.toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
  it('shows unavailable instead of loading forever for a missing product profile', () => {
    mock.missing = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    expect(screen.getByText('This item is currently unavailable for delivery estimates.')).toBeInTheDocument();
    expect(screen.queryByText('Checking delivery availability…')).not.toBeInTheDocument();
  });
  it('explains the quote fallback without inventing coverage when automation is off', () => {
    mock.enabled = false;
    render(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" disabledMessage="Request confirmed project delivery pricing." />);
    expect(screen.getByText('Request confirmed project delivery pricing.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estimate delivery' })).not.toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
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
    expect(document.querySelector('form form')).toBeNull();
  });
  it('uses the selected trade quantity and discards results after the selection changes', async () => {
    let resolveOld!: (x: unknown) => void;
    mock.estimate.mockImplementationOnce(() => new Promise(r => { resolveOld = r; }));
    const view = render(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={5} />);
    expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    await waitFor(() => expect(mock.estimate).toHaveBeenCalledWith(expect.objectContaining({ channel: 'trade', lines: [{ productId: 'p', variantId: 'v', packs: 5 }] })));
    view.rerender(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={7} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(7);
    await act(async () => resolveOld(response(5999)));
    expect(screen.queryByText('Curbside delivery: $59.99')).not.toBeInTheDocument();
  });
  it('rejects a selected quantity that violates the current server pack profile', async () => {
    render(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={4} />);
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    expect(await screen.findByText('Choose at least 3 packs, in increments of 2.')).toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
});

vi.mock('./useDeliveryRequest', () => ({
  useDeliveryRequest: (operation: string) =>
    operation === 'estimate' ? mock.estimate : mock.request,
}));
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import ProductDeliveryEstimate from './ProductDeliveryEstimate';

const mock = vi.hoisted(() => ({
  estimate: vi.fn(),
  request: vi.fn(),
  enabled: true,
  missing: false,
  projectQuote: false,
  pending: false,
  failed: false,
}));
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never).endsWith('.enabled') ||
    getFunctionName(ref as never).endsWith(':enabled')
      ? mock.enabled
      : getFunctionName(ref as never).includes('productProfile')
        ? mock.missing
          ? null
          : {
              piecesPerPack: 2,
              minimumPacks: 3,
              incrementPacks: 2,
              requiresProjectQuote: mock.projectQuote,
            }
        : undefined,
  useQueries: (queries: Record<string, { query: unknown }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query }]) => [
        key,
        mock.failed
          ? new Error('Unavailable')
          : mock.pending
            ? undefined
            : getFunctionName(query as never).endsWith(':enabled')
              ? mock.enabled
              : mock.missing
                ? null
                : {
                    piecesPerPack: 2,
                    minimumPacks: 3,
                    incrementPacks: 2,
                    requiresProjectQuote: mock.projectQuote,
                  },
      ])
    ),
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
  mock.pending = false;
  mock.failed = false;
});
afterEach(() => vi.useRealTimers());
const response = (amount: number) => ({
  status: 'ok',
  deliveryChargeMinor: amount,
  serviceName: 'Curbside delivery',
  timingCaveat: 'Delivery timing is confirmed separately.',
  expiresAt: Date.now() + 60000,
});
describe('shared delivery product UI', () => {
  it('bounds pending availability without enabling an unverified estimate and supports retry', () => {
    vi.useFakeTimers();
    mock.pending = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    expect(screen.getByText('Checking delivery availability…')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText(/Delivery availability could not be verified/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estimate delivery' })).not.toBeInTheDocument();
    mock.pending = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery availability' }));
    expect(screen.getByRole('button', { name: 'Estimate delivery' })).toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
  it('keeps query failure local instead of treating it as disabled delivery', () => {
    mock.failed = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    expect(screen.getByText(/Delivery availability could not be verified/)).toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
  it('routes project-only supplier trade delivery to the project quote workflow', () => {
    mock.projectQuote = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" channel="trade" />);
    expect(
      screen.getByText('Add this item to your project to request confirmed delivery pricing.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estimate delivery' })).not.toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
  it('shows unavailable instead of loading forever for a missing product profile', () => {
    mock.missing = true;
    render(<ProductDeliveryEstimate productId="p" variantId="v" />);
    expect(
      screen.getByText('This item is currently unavailable for delivery estimates.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Checking delivery availability…')).not.toBeInTheDocument();
  });
  it('explains the quote fallback without inventing coverage when automation is off', () => {
    mock.enabled = false;
    render(
      <ProductDeliveryEstimate
        productId="p"
        variantId="v"
        channel="trade"
        disabledMessage="Request confirmed project delivery pricing."
      />
    );
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
    expect(screen.getByRole('button', { name: 'Send delivery request' })).toBeEnabled();
    expect(document.querySelector('form form')).toBeNull();
  });
  it('uses the selected trade quantity and discards results after the selection changes', async () => {
    let resolveOld!: (x: unknown) => void;
    mock.estimate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        })
    );
    const view = render(
      <ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={5} />
    );
    expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    await waitFor(() =>
      expect(mock.estimate).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'trade',
          lines: [{ productId: 'p', variantId: 'v', packs: 5 }],
        })
      )
    );
    view.rerender(
      <ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={7} />
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(7);
    await act(async () => resolveOld(response(5999)));
    expect(screen.queryByText('Curbside delivery: $59.99')).not.toBeInTheDocument();
  });
  it('rejects a selected quantity that violates the current server pack profile', async () => {
    render(
      <ProductDeliveryEstimate productId="p" variantId="v" channel="trade" selectedPacks={4} />
    );
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
    expect(
      await screen.findByText('Choose at least 3 packs, in increments of 2.')
    ).toBeInTheDocument();
    expect(mock.estimate).not.toHaveBeenCalled();
  });
});

it('associates ZIP and pack errors without dispatching an invalid estimate', () => {
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Estimate delivery' }));
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByLabelText('ZIP code')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
  expect(mock.estimate).not.toHaveBeenCalled();
});
it('gives simultaneous product estimators distinct field IDs', () => {
  render(
    <>
      <ProductDeliveryEstimate productId="p" variantId="v" />
      <ProductDeliveryEstimate productId="p2" variantId="v2" />
    </>
  );
  const fields = screen.getAllByLabelText('ZIP code');
  expect(fields[0].id).not.toBe(fields[1].id);
});

it('retains focus and rejects duplicate submits while the estimate is pending', async () => {
  let resolve!: (value: unknown) => void;
  mock.estimate.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
  const button = screen.getByRole('button', { name: 'Estimate delivery' });
  button.focus();
  const form = screen.getByRole('form', { name: 'Estimate delivery' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mock.estimate).toHaveBeenCalledTimes(1);
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  expect(button).toHaveFocus();
  await act(async () => resolve(response(5999)));
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'false');
});

it('an older settled request cannot unlock the newer pending request', async () => {
  let oldResolve!: (value: unknown) => void;
  let newResolve!: (value: unknown) => void;
  mock.estimate
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          oldResolve = r;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          newResolve = r;
        })
    );
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  const zip = screen.getByLabelText('ZIP code');
  const form = screen.getByRole('form', { name: 'Estimate delivery' });
  fireEvent.change(zip, { target: { value: '95206' } });
  fireEvent.submit(form);
  fireEvent.change(zip, { target: { value: '10001' } });
  fireEvent.submit(form);
  await act(async () => oldResolve(response(5999)));
  fireEvent.submit(form);
  expect(mock.estimate).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Curbside delivery: $59.99')).not.toBeInTheDocument();
  await act(async () => newResolve(response(19999)));
  expect(screen.getByText('Curbside delivery: $199.99')).toBeInTheDocument();
});

it('allows retry after a failed estimate without retaining a stale submission lock', async () => {
  mock.estimate
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce(response(5999));
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
  const form = screen.getByRole('form', { name: 'Estimate delivery' });
  fireEvent.submit(form);
  await screen.findByRole('alert');
  fireEvent.submit(form);
  await screen.findByText('Curbside delivery: $59.99');
  expect(mock.estimate).toHaveBeenCalledTimes(2);
});

it('automatically recalculates selected quantity while preserving ZIP and ignoring stale results', async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: unknown) => void;
  mock.estimate
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        })
    )
    .mockResolvedValueOnce(response(8999));
  const view = render(<ProductDeliveryEstimate productId="p" variantId="v" selectedPacks={5} />);
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(mock.estimate).toHaveBeenCalledTimes(1);
  view.rerender(<ProductDeliveryEstimate productId="p" variantId="v" selectedPacks={7} />);
  expect(screen.getByLabelText('ZIP code')).toHaveValue('95206');
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(mock.estimate.mock.calls[1][0].lines[0].packs).toBe(7);
  await act(async () => resolveOld(response(5999)));
  expect(screen.getByText('Curbside delivery: $89.99')).toBeInTheDocument();
});

it('debounces ZIP edits and does not repeat a completed manual request', async () => {
  vi.useFakeTimers();
  mock.estimate.mockResolvedValue(response(5999));
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '9520' } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(mock.estimate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Estimate delivery' }));
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(mock.estimate).toHaveBeenCalledTimes(1);
});

it('does not automatically request an invalid selected pack quantity', async () => {
  vi.useFakeTimers();
  render(<ProductDeliveryEstimate productId="p" variantId="v" selectedPacks={4} />);
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '95206' } });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mock.estimate).not.toHaveBeenCalled();
});

it('keeps focus after an automatic failure and waits for a manual retry', async () => {
  vi.useFakeTimers();
  mock.estimate
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce(response(5999));
  render(<ProductDeliveryEstimate productId="p" variantId="v" />);
  const zip = screen.getByLabelText('ZIP code');
  zip.focus();
  fireEvent.change(zip, { target: { value: '95206' } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(zip).toHaveFocus();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mock.estimate).toHaveBeenCalledTimes(1);
  fireEvent.submit(screen.getByRole('form', { name: 'Estimate delivery' }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('Curbside delivery: $59.99')).toBeInTheDocument();
});

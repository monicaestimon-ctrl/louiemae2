import type { CheckoutDraftRef } from '../../lib/delivery/checkoutDraft';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DeliveryCheckout } from './CheckoutV2';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
const mocks = vi.hoisted(() => ({ estimate: vi.fn(), quote: vi.fn(), remember: vi.fn() }));
vi.mock('../../lib/delivery/checkoutReturn', () => ({ rememberCheckout: mocks.remember }));
vi.mock('./useDeliveryRequest', () => ({
  useDeliveryRequest: (operation: string) =>
    operation === 'estimate' ? mocks.estimate : mocks.quote,
}));
vi.mock('convex/react', () => ({ useQuery: () => undefined }));
vi.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => null }));
vi.mock('../../lib/partnerLink', () => ({ visitorId: () => 'fixture' }));
beforeEach(() => vi.clearAllMocks());

it('links all invalid address fields and preserves focus while correcting them', () => {
  render(<DeliveryCheckout lines={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  expect(within(summary).getAllByRole('link')).toHaveLength(6);
  expect(mocks.estimate).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(within(summary).getByRole('link', { name: /Recipient name/ }));
  const name = screen.getByLabelText('Recipient name');
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(name, { target: { value: 'Test recipient' } });
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'false');
});

it('announces a mocked estimate without moving focus or starting payment', async () => {
  mocks.estimate.mockResolvedValue({
    estimateId: 'fixture',
    expiresAt: Date.now() + 60000,
    status: 'ok',
    merchandiseMinor: 10000,
    deliveryChargeMinor: 5999,
    taxMinor: 0,
    totalMinor: 15999,
    serviceName: 'Curbside delivery',
    serviceDetails: [],
    timingCaveat: 'Timing to be confirmed.',
  });
  render(<DeliveryCheckout lines={[{ productId: 'fixture', variantId: 'fixture', packs: 1 }]} />);
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206-1234',
    Email: 'test@example.com',
  })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const button = screen.getByRole('button', { name: 'Review delivery and total' });
  button.focus();
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Pay $159.99' });
  expect(button).toHaveFocus();
  expect(mocks.estimate).toHaveBeenCalledWith(
    expect.objectContaining({ zip: '95206', channel: 'retail' })
  );
});

it('rejects a malformed quote email locally and explains missing consent', () => {
  render(<DeliveryQuoteRequest lines={[]} postalCode="95206" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request a delivery quote' }));
  fireEvent.change(screen.getByLabelText('Quote contact name'), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText('Quote contact email'), { target: { value: 'invalid' } });
  expect(screen.getByRole('button', { name: 'Send delivery request' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  expect(mocks.quote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  fireEvent.click(within(summary).getByRole('link', { name: /Email/ }));
  expect(screen.getByLabelText('Quote contact email')).toHaveFocus();
  expect(mocks.quote).not.toHaveBeenCalled();
});

it('reports all missing quote details without sending a request', () => {
  render(<DeliveryQuoteRequest lines={[]} postalCode="" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request a delivery quote' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  expect(within(summary).getAllByRole('link')).toHaveLength(3);
  expect(within(summary).getByText('Enter a valid destination ZIP above.')).toBeInTheDocument();
  expect(mocks.quote).not.toHaveBeenCalled();
});

it('keeps contact inputs in memory across reopening but requires a fresh total review', async () => {
  const draft: CheckoutDraftRef = { current: null };
  mocks.estimate.mockResolvedValue({
    estimateId: 'fixture',
    expiresAt: Date.now() + 60000,
    status: 'ok',
    merchandiseMinor: 10000,
    deliveryChargeMinor: 5999,
    taxMinor: 0,
    totalMinor: 15999,
    serviceName: 'Curbside delivery',
    serviceDetails: [],
    timingCaveat: 'Timing to be confirmed.',
  });
  const lines = [{ productId: 'fixture', variantId: 'fixture', packs: 1 }];
  const view = render(<DeliveryCheckout lines={lines} draftRef={draft} />);
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206',
    Email: 'test@example.com',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  await screen.findByRole('button', { name: 'Pay $159.99' });
  view.rerender(<></>);
  view.rerender(<DeliveryCheckout lines={lines} draftRef={draft} />);
  expect(screen.getByLabelText('Street address')).toHaveValue('123 Test St');
  expect(screen.getByLabelText('Email')).toHaveValue('test@example.com');
  expect(screen.queryByRole('button', { name: 'Pay $159.99' })).toBeNull();
  expect(mocks.estimate).toHaveBeenCalledTimes(1);
  expect(Object.keys(draft.current!).sort()).toEqual(['access', 'address', 'email', 'useCredit']);
});

it('invalidates a previous total on current-product review without erasing address inputs', async () => {
  const lines = [{ productId: 'fixture', variantId: 'fixture', packs: 1 }];
  mocks.estimate.mockResolvedValue({
    estimateId: 'fixture',
    expiresAt: Date.now() + 60000,
    status: 'ok',
    merchandiseMinor: 10000,
    deliveryChargeMinor: 5999,
    taxMinor: 0,
    totalMinor: 15999,
    serviceName: 'Curbside delivery',
    serviceDetails: [],
    timingCaveat: '',
  });
  const view = render(<DeliveryCheckout lines={lines} reviewFingerprint="original" />);
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206',
    Email: 'test@example.com',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  await screen.findByRole('button', { name: 'Pay $159.99' });
  view.rerender(<DeliveryCheckout lines={lines} reviewFingerprint="changed" reviewBlocked />);
  expect(screen.queryByRole('button', { name: 'Pay $159.99' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Review delivery and total' })).toBeDisabled();
  expect(screen.getByLabelText('Street address')).toHaveValue('123 Test St');
  view.rerender(<DeliveryCheckout lines={lines} reviewFingerprint="original" />);
  expect(screen.queryByRole('button', { name: 'Pay $159.99' })).toBeNull();
  expect(mocks.estimate).toHaveBeenCalledTimes(1);
});

it('ignores an in-flight estimate after the same cart identities receive new product evidence', async () => {
  let finish!: (value: unknown) => void;
  mocks.estimate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const lines = [{ productId: 'fixture', variantId: 'fixture', packs: 1 }];
  const view = render(<DeliveryCheckout lines={lines} reviewFingerprint="original" />);
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206',
    Email: 'test@example.com',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  view.rerender(<DeliveryCheckout lines={lines} reviewFingerprint="new-price" />);
  await act(async () =>
    finish({
      estimateId: 'old',
      expiresAt: Date.now() + 60000,
      status: 'ok',
      merchandiseMinor: 10000,
      deliveryChargeMinor: 5999,
      taxMinor: 0,
      totalMinor: 15999,
      serviceName: 'Curbside delivery',
      serviceDetails: [],
      timingCaveat: '',
    })
  );
  expect(
    screen.queryByText('Your cart or address changed. Review delivery and total again.')
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pay $159.99' })).toBeNull();
  expect(screen.getByLabelText('Email')).toHaveValue('test@example.com');
  expect(screen.getByRole('button', { name: 'Review delivery and total' })).toBeEnabled();
});

it('does not resurrect an accepted estimate when ready quantities change away and back', async () => {
  const lines = [{ productId: 'fixture', variantId: 'fixture', packs: 3 }];
  mocks.estimate.mockResolvedValue({
    estimateId: 'fixture',
    expiresAt: Date.now() + 60000,
    status: 'ok',
    merchandiseMinor: 10000,
    deliveryChargeMinor: 5999,
    taxMinor: 0,
    totalMinor: 15999,
    serviceName: 'Curbside delivery',
    serviceDetails: [],
    timingCaveat: '',
  });
  const view = render(<DeliveryCheckout lines={lines} reviewFingerprint="three" />);
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206',
    Email: 'test@example.com',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  await screen.findByRole('button', { name: 'Pay $159.99' });
  view.rerender(<DeliveryCheckout lines={lines} reviewFingerprint="three" />);
  expect(screen.getByRole('button', { name: 'Pay $159.99' })).toBeInTheDocument();
  view.rerender(<DeliveryCheckout lines={[{ ...lines[0], packs: 5 }]} reviewFingerprint="five" />);
  view.rerender(<DeliveryCheckout lines={lines} reviewFingerprint="three" />);
  expect(screen.queryByRole('button', { name: 'Pay $159.99' })).toBeNull();
  expect(screen.getByLabelText('Email')).toHaveValue('test@example.com');
});
it('discards a pending payment response after the checkout instance unmounts', async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
  );
  mocks.estimate.mockResolvedValue({
    estimateId: 'fixture',
    expiresAt: Date.now() + 60000,
    status: 'ok',
    merchandiseMinor: 10000,
    deliveryChargeMinor: 5999,
    taxMinor: 0,
    totalMinor: 15999,
    serviceName: 'Curbside delivery',
    serviceDetails: [],
    timingCaveat: '',
  });
  const view = render(
    <DeliveryCheckout lines={[{ productId: 'fixture', variantId: 'fixture', packs: 1 }]} />
  );
  for (const [label, value] of Object.entries({
    'Recipient name': 'Test recipient',
    'Delivery contact phone': '5555550100',
    'Street address': '123 Test St',
    City: 'Stockton',
    'ZIP code': '95206',
    Email: 'test@example.com',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review delivery and total' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pay $159.99' }));
  view.unmount();
  await act(async () =>
    finish({ ok: true, json: async () => ({ url: '#must-not-redirect', sessionId: 'synthetic' }) })
  );
  expect(mocks.remember).not.toHaveBeenCalled();
  expect(window.location.hash).not.toBe('#must-not-redirect');
  vi.unstubAllGlobals();
});

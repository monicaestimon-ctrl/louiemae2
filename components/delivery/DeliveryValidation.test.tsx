import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DeliveryCheckout } from './CheckoutV2';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
const mocks = vi.hoisted(() => ({ estimate: vi.fn(), quote: vi.fn() }));
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
  expect(screen.getByRole('button', { name: 'Send delivery request' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  fireEvent.click(within(summary).getByRole('link', { name: /Email/ }));
  expect(screen.getByLabelText('Quote contact email')).toHaveFocus();
  expect(mocks.quote).not.toHaveBeenCalled();
});

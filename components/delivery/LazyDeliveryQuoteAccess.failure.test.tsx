import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LazyDeliveryQuoteAccess } from './LazyDeliveryQuoteAccess';
vi.mock('./DeliveryQuoteStatus', () => {
  throw Error('Synthetic private module failure');
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});
it('offers recovery without exposing a private capability when its module fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.history.replaceState(
    {},
    '',
    '/?deliveryQuote=fixture#delivery-access=private-fixture-token'
  );
  render(<LazyDeliveryQuoteAccess />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened');
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled();
  expect(document.body.textContent).not.toContain('private-fixture-token');
  expect(window.location.hash).toBe('#delivery-access=private-fixture-token');
});

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LazyDeliveryQuoteAccess } from './LazyDeliveryQuoteAccess';
const fixture = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release, imports: 0, props: vi.fn() };
});
vi.mock('./DeliveryQuoteStatus', async () => {
  fixture.imports++;
  await fixture.pending;
  return {
    DeliveryQuoteAccess: (props: unknown) => {
      fixture.props(props);
      return <p>Private quote fixture</p>;
    },
  };
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
it('does not load quote controls on ordinary visits and captures a private link before a delayed import', async () => {
  const ordinary = render(<LazyDeliveryQuoteAccess />);
  expect(fixture.imports).toBe(0);
  expect(screen.queryByLabelText('Requested delivery quote')).toBeNull();
  ordinary.unmount();
  window.history.replaceState({}, '', '/?deliveryQuote=original#delivery-access=original-token');
  render(<LazyDeliveryQuoteAccess />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Opening your private delivery quote'
  );
  window.history.replaceState({}, '', '/?deliveryQuote=later#delivery-access=later-token');
  await act(async () => fixture.release());
  expect(await screen.findByText('Private quote fixture')).toBeTruthy();
  expect(fixture.props).toHaveBeenLastCalledWith({
    initialRequest: { id: 'original', guestCapability: 'original-token' },
  });
  expect(document.body.textContent).not.toContain('original-token');
  expect(fixture.imports).toBe(1);
});

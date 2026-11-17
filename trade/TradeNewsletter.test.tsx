import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => subscribe }));
import { TradeNewsletter } from './TradeNewsletter';
beforeEach(() => { subscribe.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function submit(value = ' Person@Example.com ') {
  fireEvent.change(screen.getByLabelText('Email for new arrivals'), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: 'Subscribe' }).closest('form')!);
}
it('validates and focuses the email field before any server command', () => {
  render(<TradeNewsletter />); submit('invalid');
  expect(subscribe).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Email for new arrivals')).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('valid email');
});
it('waits for confirmation, normalizes the email and blocks repeated submissions', async () => {
  let resolve!: (value: string) => void;
  subscribe.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<TradeNewsletter />); submit();
  fireEvent.submit(screen.getByRole('button', { name: 'Saving…' }).closest('form')!);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith({ email: 'person@example.com', tags: ['holm'] });
  expect(screen.getByRole('status')).not.toHaveTextContent('subscribed');
  await act(async () => resolve('fixture-id'));
  expect(screen.getByRole('status')).toHaveTextContent('You’re subscribed');
  expect(screen.getByLabelText('Email for new arrivals')).toHaveValue('');
});
it('does not claim an existing, possibly unsubscribed email is newly subscribed', async () => {
  subscribe.mockResolvedValue(null);
  render(<TradeNewsletter />); await act(async () => submit());
  expect(screen.getByRole('status')).toHaveTextContent('already on file');
  expect(screen.getByRole('status')).not.toHaveTextContent('You’re subscribed');
});
it('retains input after failure and ignores a late result after the confirmation timeout', async () => {
  vi.useFakeTimers();
  let resolve!: (value: string) => void;
  subscribe.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<TradeNewsletter />); submit('person@example.com');
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole('status')).toHaveTextContent('could not confirm');
  expect(screen.getByLabelText('Email for new arrivals')).toHaveValue('person@example.com');
  await act(async () => resolve('late-id'));
  expect(screen.getByRole('status')).not.toHaveTextContent('You’re subscribed');
  subscribe.mockRejectedValue(new Error('Unavailable'));
  await act(async () => submit('person@example.com'));
  expect(screen.getByRole('status')).toHaveTextContent('could not confirm');
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionSignup } from '../CollectionSignup';
const subscribe = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriberWithTags: subscribe }) }));
beforeEach(() => subscribe.mockReset());
afterEach(cleanup);
it('retains an email after a rejected request and only announces confirmed success', async () => {
  subscribe.mockRejectedValueOnce(new Error('Transport failed')).mockResolvedValueOnce(true);
  render(<CollectionSignup category="Accent Chairs" />);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'kept@example.com' } });
  await act(async () => fireEvent.submit(screen.getByRole('form')));
  expect(screen.getByLabelText('Email address')).toHaveValue('kept@example.com');
  expect(screen.getByRole('status')).toHaveTextContent('could not confirm');
  expect(screen.getByRole('button')).toBeEnabled();
  await act(async () => fireEvent.submit(screen.getByRole('form')));
  expect(subscribe).toHaveBeenLastCalledWith('kept@example.com', 'Guest', ['vip', 'early-access', 'category:accent-chairs']);
  expect(screen.getByRole('status')).toHaveTextContent('on the list for Accent Chairs');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByLabelText('Email address')).toHaveValue('');
});
it('does not duplicate a pending request and treats false as unconfirmed', async () => {
  let finish!: (result: boolean) => void;
  subscribe.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<CollectionSignup category="Lighting" />);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.com' } });
  fireEvent.submit(screen.getByRole('form')); fireEvent.submit(screen.getByRole('form'));
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Submitting');
  await act(async () => finish(false));
  expect(screen.getByLabelText('Email address')).toHaveValue('fixture@example.com');
  expect(screen.getByRole('status')).toHaveTextContent('could not confirm');
});
it('gives multiple forms distinct labels and feedback associations', () => {
  render(<><CollectionSignup category="Lighting" /><CollectionSignup category="Sofas" /></>);
  const inputs = screen.getAllByLabelText('Email address');
  expect(inputs[0].id).not.toBe(inputs[1].id);
  for (const input of inputs) expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBeTruthy();
});

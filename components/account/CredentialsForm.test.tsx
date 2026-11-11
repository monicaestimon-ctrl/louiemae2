import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CredentialsForm } from './CredentialsForm';
const mocks = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
beforeEach(() => {
  mocks.signIn.mockReset();
  sessionStorage.clear();
});
it('focuses all validation errors and links corrections without starting authentication', () => {
  render(<CredentialsForm site="trade" />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  expect(within(summary).getAllByRole('link')).toHaveLength(2);
  fireEvent.click(within(summary).getByRole('link', { name: /Work email/ }));
  const email = screen.getByLabelText('Work email');
  expect(email).toHaveFocus();
  fireEvent.change(email, { target: { value: 'fixture@example.com' } });
  expect(email).toHaveFocus();
  expect(email).toHaveAttribute('aria-invalid', 'false');
  expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it('preserves credential values after rejection and blocks duplicate submissions or mode switches while pending', async () => {
  let reject!: (error: Error) => void;
  mocks.signIn.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  render(<CredentialsForm site="creator" />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'FIXTURE@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fireEvent.submit(screen.getByRole('form'));
  expect(mocks.signIn).toHaveBeenCalledTimes(1);
  const data = mocks.signIn.mock.calls[0][1] as FormData;
  expect(data.get('email')).toBe('fixture@example.com');
  expect(data.get('flow')).toBe('signUp');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await act(async () => reject(new Error('Fixture rejection')));
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByLabelText('Password')).toHaveValue('fixture-password');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
});
it.each([
  ['creator', '/', 'lm:after', '#creators'],
  ['trade', '/trade/', 'hol:after', 'projects'],
] as const)(
  'preserves %s OAuth return intent and exposes failed-provider feedback',
  async (site, redirectTo, key, value) => {
    mocks.signIn.mockRejectedValue(new Error('Fixture unavailable'));
    render(<CredentialsForm site={site} googleEnabled afterSignIn="projects" />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(mocks.signIn).toHaveBeenCalledWith('google', { redirectTo });
    expect(sessionStorage.getItem(key)).toBe(value);
    expect(screen.getByLabelText(site === 'trade' ? 'Work email' : 'Email')).toBeEnabled();
  }
);

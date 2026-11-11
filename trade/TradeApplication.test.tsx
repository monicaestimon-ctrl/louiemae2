import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
const mocks = vi.hoisted(() => ({ application: null as unknown, apply: vi.fn(), upload: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: () => mocks.application,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === 'holm:applyTrade' ? mocks.apply : mocks.upload,
}));
import { TradeApplication } from './TradeApplication';
import { applicationErrors, type ApplicationValues } from './application';
const props = { me: { signedIn: true, verified: false }, onNavigate: vi.fn(), onSignIn: vi.fn() };
beforeEach(() => {
  mocks.application = null;
  mocks.apply.mockReset();
  mocks.upload.mockReset();
  props.onNavigate.mockReset();
  props.onSignIn.mockReset();
});
it('keeps application access behind sign-in and verified accounts out of the form', async () => {
  const user = userEvent.setup();
  const view = render(<TradeApplication {...props} me={{ signedIn: false, verified: false }} />);
  await user.click(screen.getByRole('button', { name: 'Sign in or create an account' }));
  expect(props.onSignIn).toHaveBeenCalledWith('trade');
  expect(mocks.apply).not.toHaveBeenCalled();
  view.rerender(<TradeApplication {...props} me={{ signedIn: true, verified: true }} />);
  expect(screen.getByText('Your approved trade prices are available.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
});
it('focuses step errors and the next heading without submitting invalid details', async () => {
  const user = userEvent.setup();
  render(<TradeApplication {...props} />);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('alert')).toHaveFocus();
  await user.click(screen.getByRole('link', { name: /Business type/ }));
  expect(screen.getByRole('group', { name: 'Business type' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: /Interior designer/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('heading', { name: 'Tell us about the business' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('link', { name: /Legal business name/ })).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: /^EIN:/ }));
  expect(screen.getByLabelText('EIN')).toHaveFocus();
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('preserves a rejected application, masks the EIN in review and prevents duplicate dispatch', async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  mocks.apply.mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      })
  );
  render(<TradeApplication {...props} />);
  await user.click(screen.getByRole('button', { name: /Interior designer/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(screen.getByLabelText('Legal business name'), 'Fixture Studio');
  await user.type(screen.getByLabelText('EIN'), '123456789');
  expect(screen.getByLabelText('EIN')).toHaveValue('12-3456789');
  await user.type(screen.getByLabelText('Website or business Instagram'), '@fixturestudio');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(screen.getByLabelText(/Resale certificate, ASID/), 'Fixture portfolio');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('••-•••6789')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('12-3456789')).not.toBeInTheDocument();
  const form = screen.getByRole('form', { name: 'Review and submit' });
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      businessType: 'design',
      businessName: 'Fixture Studio',
      ein: '12-3456789',
      website: '@fixturestudio',
      credential: 'Fixture portfolio',
      taxRequested: false,
    })
  );
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  await act(async () => reject(new Error('Private server detail')));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.queryByText('Private server detail')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText(/Resale certificate, ASID/)).toHaveValue('Fixture portfolio');
});
it('validates project-manager email and oversized optional certificates before upload', () => {
  const values: ApplicationValues = {
    type: 'pm',
    name: 'Fixture',
    state: 'New York',
    ein: '12-3456789',
    web: '@fixture',
    cred: '',
    company: 'Fixture company',
    email: 'invalid@',
    tax: true,
    cert: new File(['fixture'], 'fixture.pdf', { type: 'application/pdf' }),
  };
  Object.defineProperty(values.cert, 'size', { value: 11 * 1024 * 1024 });
  expect(applicationErrors(values)).toEqual({
    email: 'Enter your work email at that company.',
    cert: 'Use a certificate file no larger than 10 MB.',
  });
  expect(applicationErrors({ ...values, email: 'fixture@example.com', tax: false })).toEqual({});
});

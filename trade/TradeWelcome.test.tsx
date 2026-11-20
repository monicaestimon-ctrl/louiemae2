import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TradeWelcome } from './TradeWelcome';
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), signIn: vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => mocks.ensure,
  useQuery: () => ({ google: true }),
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
beforeEach(() => {
  mocks.ensure.mockReset().mockResolvedValue(null);
  mocks.signIn.mockReset();
});
it('renders accessible credentials without creating a profile for a visitor', () => {
  render(<TradeWelcome signedIn={false} onNavigate={vi.fn()} artwork={[]} />);
  expect(screen.getByRole('heading', { level: 1, name: 'House of Louie Mae' })).toBeInTheDocument();
  expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'email');
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it('retains the existing profile assurance and requested route after sign-in', async () => {
  const navigate = vi.fn();
  render(<TradeWelcome signedIn afterSignIn="projects" onNavigate={navigate} artwork={[]} />);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('projects'));
  expect(mocks.ensure).toHaveBeenCalledWith({});
  expect(mocks.signIn).not.toHaveBeenCalled();
});

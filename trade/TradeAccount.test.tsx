import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
const query = vi.hoisted(() => vi.fn());
vi.mock('convex/react', () => ({ useQuery: query }));
import { TradeAccount } from './TradeAccount';
afterEach(() => { cleanup(); query.mockReset(); });
const member: ComponentProps<typeof TradeAccount>['me'] = { signedIn: true, email: 'member@example.test', displayName: 'Member', businessName: 'Studio', tradeStatus: 'approved', verified: true, partner: false, partnerTier: null, refCode: null, admin: false };
it('skips private application reads for anonymous visitors and offers sign-in', () => {
  const navigate = vi.fn();
  render(<TradeAccount me={{ signedIn: false }} onNavigate={navigate} onSignOut={vi.fn()} />);
  expect(query).toHaveBeenLastCalledWith(expect.anything(), 'skip');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(navigate).toHaveBeenCalledWith('welcome');
});
it('shows server membership and preserves account navigation without exposing admin controls', () => {
  const navigate = vi.fn(); const signOut = vi.fn();
  render(<TradeAccount me={member} onNavigate={navigate} onSignOut={signOut} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your account');
  expect(screen.getByText('Trade, with project pricing')).toBeTruthy();
  expect(screen.queryByText('Review trade applications')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quotes and trade pass' }));
  expect(navigate).toHaveBeenCalledWith('hub');
  fireEvent.click(screen.getByRole('button', { name: 'Log out' })); expect(signOut).toHaveBeenCalledOnce();
});
it('shows retail pricing for a pending member without inviting a duplicate application', () => {
  query.mockReturnValue({ businessName: 'Application Studio' });
  render(<TradeAccount me={{ ...member, signedIn: true, businessName: null, verified: false, tradeStatus: 'pending' }} onNavigate={vi.fn()} onSignOut={vi.fn()} />);
  expect(screen.getByText('Application Studio')).toBeTruthy();
  expect(screen.getByText('In review')).toBeTruthy();
  expect(screen.getByText('Retail')).toBeTruthy();
  expect(screen.queryByText('Apply for trade pricing')).toBeNull();
});

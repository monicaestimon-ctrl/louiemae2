import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { answers, commands } = vi.hoisted(() => ({ answers: new Map<string, unknown>(), commands: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown, args: unknown) => (args === 'skip' ? undefined : answers.get(String((ref as { _name?: string })?._name ?? ref))),
  useAction: () => vi.fn(() => Promise.resolve('')),
  useMutation: (ref: unknown) => (args: unknown) => commands(String(ref), args),
}));
vi.mock('../../convex/_generated/api', () => {
  const ref = (name: string) => ({ _name: name, toString: () => name });
  const mod = (m: string, fns: string[]) => Object.fromEntries(fns.map((f) => [f, ref(`${m}.${f}`)]));
  return {
    api: {
      v2Admin: mod('v2Admin', ['publicFlags']),
      prgMemberships: mod('prgMemberships', ['myPrograms', 'creatorStart', 'creatorProfile', 'creatorAcceptTerms', 'activateTradeReferrals', 'myOrganizations', 'inviteMember', 'setMemberRole']),
      prgLinks: mod('prgLinks', ['create']),
      prgTiers: mod('prgTiers', ['myTier']),
      ldgCommissions: mod('ldgCommissions', ['myEarnings']),
      ldgCredits: mod('ldgCredits', ['myCreditV2']),
      retailLaunch: mod('retailLaunch', ['storefrontPage']),
      holmConnect: mod('holmConnect', ['startPayoutSetup']),
    },
  };
});
import ProgramHubV2, { TeamPanel } from '../partner/ProgramHubV2';

const flags = { creatorEnrollment: true, retailLinks: true, ledger: true, credit: true, delivery: false, zuoCheckout: false, tradeOnly: false, payouts: false };
const terms = { _id: 't1', version: 3 };
beforeEach(() => {
  answers.clear();
  commands.mockReset().mockResolvedValue(null);
  answers.set('v2Admin.publicFlags', flags);
});
afterEach(cleanup);

describe('v2 program hub (S33, S34, UX01)', () => {
  it('shows loading, then the join step, then terms with the current version', () => {
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading/);
    cleanup();
    answers.set('prgMemberships.myPrograms', { creator: null, trade: null, beneficiary: null, creatorTerms: terms, referralTerms: terms });
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByRole('heading', { name: 'Join the Creator Program' })).toBeTruthy();
    cleanup();
    answers.set('prgMemberships.myPrograms', { creator: { state: 'terms', reviewReasons: [] }, trade: null, beneficiary: null, creatorTerms: null, referralTerms: null });
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByText(/being finalized/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows review and suspended states clearly', () => {
    answers.set('prgMemberships.myPrograms', { creator: { state: 'review', reviewReasons: [] }, trade: null, beneficiary: null, creatorTerms: terms, referralTerms: terms });
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByText(/review some new accounts by hand/)).toBeTruthy();
    cleanup();
    answers.set('prgMemberships.myPrograms', { creator: { state: 'suspended', reviewReasons: [] }, trade: null, beneficiary: null, creatorTerms: terms, referralTerms: terms });
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByText(/isn't active/)).toBeTruthy();
  });

  it('offers trade referral activation in the same account', () => {
    answers.set('prgMemberships.myPrograms', { creator: null, trade: { state: 'approved', referralActivated: false }, beneficiary: null, creatorTerms: terms, referralTerms: terms });
    render(<ProgramHubV2 site="trade" />);
    expect(screen.getByRole('heading', { name: 'Earn on retail referrals' })).toBeTruthy();
    expect(screen.getByText(/version 3/)).toBeTruthy();
  });

  it('shows link builder, tier, balances and privacy-safe orders for an active partner', () => {
    answers.set('prgMemberships.myPrograms', { creator: { state: 'active', reviewReasons: [] }, trade: null, beneficiary: { tier: 'active', refCode: 'AVA1', payoutReadiness: 'not_started', status: 'active' }, creatorTerms: terms, referralTerms: terms });
    answers.set('prgTiers.myTier', { tier: 'active', qualifyingMinor: 2_000_000, next: 'top', toNextMinor: 3_000_000 });
    answers.set('ldgCommissions.myEarnings', { totals: { pending: 1_000, held: 0, cleared: 6_000, reserved: 0, submitted: 0, transferred: 15_000 }, entries: [{ ref: '…AB12', paidAt: 0, category: 'furniture', rateBps: 1200, basisMinor: 100_000, amountMinor: 12_000, state: 'pending', clearsAt: 0 }] });
    answers.set('ldgCredits.myCreditV2', { availableMinor: 10_000, reservedMinor: 0, pendingAwardMinor: 0, history: [], terms: 'Store credit has no cash value.' });
    answers.set('retailLaunch.storefrontPage', { page: [] });
    render(<ProgramHubV2 site="creators" />);
    expect(screen.getByRole('heading', { name: 'Copy retail referral link' })).toBeTruthy();
    expect(screen.getByText(/\$30,000\.00 more in eligible sales to reach Top/)).toBeTruthy();
    expect(screen.getByText('…AB12')).toBeTruthy();
    expect(screen.getByText('$150.00')).toBeTruthy();
    expect(screen.getByText(/Set up payouts/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/@(?!louiemae\.com)/); // no buyer emails; only our support address
  });

  it('shows the business team to owners only', () => {
    answers.set('prgMemberships.myOrganizations', [{ organizationId: 'o1', name: 'Ava Studio', role: 'owner', members: [{ userId: 'u2', role: 'purchasing', status: 'active', email: 'sam@ava.studio' }] }]);
    render(<TeamPanel />);
    expect(screen.getByText(/your role: Owner/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  });
});


it('validates profile fields locally and preserves a rejected draft without duplicate dispatch', async () => {
  const user = userEvent.setup();
  answers.set('prgMemberships.myPrograms', { creator: { state: 'profile' }, trade: null, beneficiary: null, creatorTerms: terms, referralTerms: terms });
  let reject!: (reason: Error) => void;
  commands.mockImplementation(() => new Promise((_, no) => { reject = no; }));
  render(<ProgramHubV2 site="creators" />);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('alert')).toHaveFocus();
  await user.click(screen.getByRole('link', { name: /^Name or handle:/ }));
  expect(screen.getByLabelText('Name or handle')).toHaveFocus();
  await user.type(screen.getByLabelText('Name or handle'), 'Fixture Creator');
  await user.type(screen.getByLabelText('Your profiles or site (one per line)'), 'javascript:alert(1)');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('link', { name: /^Profiles or website:/ })).toBeInTheDocument();
  expect(commands).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Your profiles or site (one per line)'));
  await user.type(screen.getByLabelText('Your profiles or site (one per line)'), 'https://instagram.com/fixture');
  const form = screen.getByRole('form', { name: 'About you' });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(commands).toHaveBeenCalledTimes(1);
  expect(commands).toHaveBeenCalledWith('prgMemberships.creatorProfile', { displayName: 'Fixture Creator', urls: ['https://instagram.com/fixture'] });
  expect(screen.getByLabelText('Name or handle')).toBeDisabled();
  await act(async () => reject(new Error('Private fixture detail')));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Name or handle')).toHaveValue('Fixture Creator');
  expect(screen.queryByText('Private fixture detail')).not.toBeInTheDocument();
});

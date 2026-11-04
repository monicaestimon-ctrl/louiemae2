import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Answers for each backend query, keyed by its name.
const { answers, join } = vi.hoisted(() => ({ answers: new Map<string, unknown>(), join: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: (ref: unknown, args: unknown) => (args === 'skip' ? undefined : answers.get(String((ref as { _name?: string })?._name ?? ref))),
  useAction: () => vi.fn(() => Promise.resolve(null)),
  useMutation: (ref: unknown) => (String((ref as { _name?: string })?._name ?? ref).endsWith('join') ? join : vi.fn(() => Promise.resolve())),
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('../../convex/_generated/api', () => {
  const ref = (name: string) => ({ _name: name, toString: () => name });
  return {
    api: {
      holm: { me: ref('holm.me'), ensureProfile: ref('holm.ensureProfile'), signInOptions: ref('holm.signInOptions') },
      holmPartners: { hub: ref('holmPartners.hub'), join: ref('holmPartners.join') },
      holmConnect: { startPayoutSetup: ref('holmConnect.startPayoutSetup'), refreshPayoutStatus: ref('holmConnect.refreshPayoutStatus') },
      holmCredit: { myCredit: ref('holmCredit.myCredit'), setCreditAutoApply: ref('holmCredit.setCreditAutoApply') },
    },
  };
});
import CreatorHub from '../CreatorHub';

const hub = {
  refCode: 'STUDIO42', tier: 'active', clicks30: 12, orders: 1, quotes: 0,
  payoutSetup: { enabled: false, connected: false, ready: false, due: 0 }, payoutMinCents: 5_000,
  pendingCents: 20_000, clearedCents: 0, paidCents: 0, creditCents: 0,
  commissions: [{ source: 'storefront_order', baseCents: 200_000, amountCents: 20_000, status: 'pending', clearsAt: Date.now(), createdAt: Date.now(), channel: 'pin', board: null, note: null, lines: [{ type: 'furniture', baseCents: 200_000, rateBps: 1200, amountCents: 20_000, capped: false }] }],
};

beforeEach(() => { answers.clear(); join.mockReset(); });
afterEach(cleanup);

describe('Creator Hub', () => {
  it('shows the real rates by product type and a sign-in form to visitors', () => {
    answers.set('holm.me', { signedIn: false });
    render(<CreatorHub />);
    expect(screen.getByText(/Earn 10%–18% on furniture, 8%–12% on home décor and 5%–8% on clothing/)).toBeTruthy();
    expect(screen.getByText(/as they become available to order/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('asks a signed-in member to accept the terms before joining', () => {
    answers.set('holm.me', { signedIn: true });
    answers.set('holmPartners.hub', null);
    render(<CreatorHub />);
    const button = screen.getByRole('button', { name: 'Join the program' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'partner terms' }).getAttribute('href')).toBe('/trade#partner-terms');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    expect(join).toHaveBeenCalledWith({ acceptTerms: true });
  });

  it("gives a partner their rates, a link for any page and their orders", () => {
    answers.set('holm.me', { signedIn: true });
    answers.set('holmPartners.hub', hub);
    render(<CreatorHub />);
    expect(screen.getByText(/Your rates \(Active\): 12% furniture, 9% décor, 6% clothing/)).toBeTruthy();
    expect(screen.getByText(/\?ref=STUDIO42&ch=link$/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '#collection/decor' } });
    fireEvent.change(screen.getByLabelText("Where you'll share it"), { target: { value: 'pin' } });
    expect(screen.getByText(/\?ref=STUDIO42&ch=pin#collection\/decor$/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Page address on louiemae.com'), { target: { value: 'https://example.com' } });
    expect(screen.getByText('Paste an address on louiemae.com.')).toBeTruthy();
    expect(screen.getByText('Furniture 12%')).toBeTruthy();
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
  });
});

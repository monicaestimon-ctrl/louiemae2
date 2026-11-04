// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const stripe = vi.hoisted(() => ({ accounts: { retrieve: vi.fn() }, transfers: { create: vi.fn(), list: vi.fn() } }));
vi.mock('stripe', () => ({ default: function Stripe() { return stripe; } }));
import { runMonthlyPayouts } from './holmConnect';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

/** A connected partner with cleared commission rows of the given amounts. */
async function partner(t: ReturnType<typeof convexTest>, amounts: number[]) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'partner@studio.com' });
    await ctx.db.insert('holmProfiles', { userId, displayName: 'Studio', tradeStatus: 'none', partnerStatus: 'active', partnerTier: 'base', refCode: 'STUDIO42', stripeAccountId: 'acct_1', createdAt: 0, updatedAt: 0 });
    for (const amountCents of amounts)
      await ctx.db.insert('holmCommissions', { partnerId: userId, source: amountCents < 0 ? 'adjustment' : 'storefront_order', baseCents: 0, rateBps: 0, amountCents, status: 'cleared', clearsAt: 0, createdAt: 0 });
    return userId;
  });
}
const rows = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query('holmCommissions').collect());

describe('monthly payout records', () => {
  it('claims cleared commission (after adjustments) once, and only from $50', async () => {
    const t = convexTest(schema, modules);
    const small = await partner(t, [3_000, 1_000]);
    expect(await t.mutation(internal.holmPayouts.claimPayout, { partnerId: small, period: '2026-11', accountId: 'acct_1' })).toBeNull();
    const t2 = convexTest(schema, modules);
    const userId = await partner(t2, [8_000, -2_000]);
    const claim = await t2.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' });
    expect(claim!.amountCents).toBe(6_000);
    // a retry resumes the same payout instead of claiming again
    expect(await t2.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' })).toEqual(claim);
    await t2.mutation(internal.holmPayouts.completePayout, { payoutId: claim!.payoutId, transferId: 'tr_1' });
    expect((await rows(t2)).every((r) => r.status === 'paid')).toBe(true);
    expect(await t2.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' })).toBeNull();
  });

  it('frees the commission when a transfer fails, for the next run', async () => {
    const t = convexTest(schema, modules);
    const userId = await partner(t, [9_000]);
    const claim = await t.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' });
    await t.mutation(internal.holmPayouts.failPayout, { payoutId: claim!.payoutId, error: 'Insufficient funds' });
    const [r] = await rows(t);
    expect(r.status).toBe('cleared');
    expect(r.payoutId).toBeUndefined();
    const again = await t.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' });
    expect(again!.amountCents).toBe(9_000);
  });

  it('keeps commission in an automatic payout out of a manual one', async () => {
    const t = convexTest(schema, modules);
    const userId = await partner(t, [9_000]);
    await t.mutation(internal.holmPayouts.claimPayout, { partnerId: userId, period: '2026-11', accountId: 'acct_1' });
    const { unpaidCleared } = await import('./holmPayouts');
    expect(await t.run((ctx) => unpaidCleared(ctx as never, userId as Id<'users'>))).toHaveLength(0);
  });
});

describe('monthly payout run', () => {
  const handler = (runMonthlyPayouts as unknown as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
  // The run's calls by what they carry: claims have a period, completions a transferId, failures an error.
  const ctx = (claim: { payoutId: string; amountCents: number } | null, open: any[] = [], completeThrows = false) => ({
    runQuery: vi.fn(async (_ref: unknown, _args: any) => (ctx.calls++ === 0 ? open : [{ userId: 'u1', accountId: 'acct_1' }])),
    runMutation: vi.fn(async (_ref: unknown, args: any) => {
      if ('period' in args) return claim;
      if ('transferId' in args && completeThrows) throw new Error('write conflict');
      return undefined;
    }),
  });
  ctx.calls = 0;
  const failed = (c: ReturnType<typeof ctx>) => c.runMutation.mock.calls.filter(([, a]: any) => 'error' in a);
  const completed = (c: ReturnType<typeof ctx>) => c.runMutation.mock.calls.filter(([, a]: any) => 'transferId' in a);
  const ready = () => stripe.accounts.retrieve.mockResolvedValue({ id: 'acct_1', payouts_enabled: true, capabilities: { transfers: 'active' }, requirements: { currently_due: [] } });
  beforeEach(() => { ctx.calls = 0; stripe.transfers.create.mockReset(); stripe.transfers.list.mockReset(); });

  it('does nothing until automatic payouts are switched on', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', '');
    const c = ctx(null);
    expect(await handler(c, {})).toEqual({ paid: 0, skipped: 'disabled' });
    expect(c.runQuery).not.toHaveBeenCalled();
  });

  it('sends one transfer per payout, keyed so a retry never pays twice', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    stripe.accounts.retrieve.mockResolvedValue({ id: 'acct_1', payouts_enabled: true, capabilities: { transfers: 'active' }, requirements: { currently_due: [] } });
    stripe.transfers.create.mockResolvedValue({ id: 'tr_1' });
    const c = ctx({ payoutId: 'pay_1', amountCents: 6_000 });
    expect(await handler(c, {})).toEqual({ paid: 1 });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6_000, currency: 'usd', destination: 'acct_1' }),
      { idempotencyKey: 'holm-payout:pay_1' }
    );
  });

  it('frees the commission only when Stripe definitely rejected the transfer', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    ready();
    stripe.transfers.create.mockRejectedValue(Object.assign(new Error('Insufficient funds'), { type: 'StripeInvalidRequestError' }));
    const rejected = ctx({ payoutId: 'pay_1', amountCents: 6_000 });
    await handler(rejected, {});
    expect(failed(rejected)).toHaveLength(1);
    ctx.calls = 0;
    stripe.transfers.create.mockRejectedValue(Object.assign(new Error('timeout'), { type: 'StripeConnectionError' }));
    const unclear = ctx({ payoutId: 'pay_1', amountCents: 6_000 });
    await handler(unclear, {});
    expect(failed(unclear)).toHaveLength(0); // stays processing; the next run checks Stripe
  });

  it('never frees the commission when recording a successful transfer fails', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    ready();
    stripe.transfers.create.mockResolvedValue({ id: 'tr_1' });
    const c = ctx({ payoutId: 'pay_1', amountCents: 6_000 }, [], true);
    await expect(handler(c, {})).rejects.toThrow('write conflict');
    expect(failed(c)).toHaveLength(0);
  });

  it('settles an unfinished payout from Stripe before paying anything new', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    ready();
    stripe.transfers.list.mockResolvedValue({ data: [{ id: 'tr_old', metadata: { payoutId: 'pay_0' } }], has_more: false });
    const c = ctx(null, [{ payoutId: 'pay_0', accountId: 'acct_1', startedAt: 0 }, { payoutId: 'pay_9', accountId: 'acct_1', startedAt: 0 }]);
    await handler(c, {});
    expect(completed(c).map(([, a]: any) => a)).toEqual([{ payoutId: 'pay_0', transferId: 'tr_old' }]); // found: paid
    expect(failed(c).map(([, a]: any) => a.payoutId)).toEqual(['pay_9']); // never made: freed
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it('looks through every page of transfers before deciding none was made', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    ready();
    stripe.transfers.list
      .mockResolvedValueOnce({ data: [{ id: 'tr_a', metadata: { payoutId: 'other' } }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'tr_b', metadata: { payoutId: 'pay_0' } }], has_more: false });
    const c = ctx(null, [{ payoutId: 'pay_0', accountId: 'acct_1', startedAt: 0 }]);
    await handler(c, {});
    expect(stripe.transfers.list).toHaveBeenLastCalledWith(expect.objectContaining({ starting_after: 'tr_a' }));
    expect(completed(c).map(([, a]: any) => a)).toEqual([{ payoutId: 'pay_0', transferId: 'tr_b' }]);
    expect(failed(c)).toHaveLength(0);
  });

  it('leaves a payout started in the last hour alone (its request may still be in flight)', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    ready();
    stripe.transfers.list.mockResolvedValue({ data: [], has_more: false });
    const c = ctx(null, [{ payoutId: 'pay_new', accountId: 'acct_1', startedAt: Date.now() - 5 * 60e3 }]);
    await handler(c, {});
    expect(stripe.transfers.list).not.toHaveBeenCalled();
    expect(failed(c)).toHaveLength(0);
  });

  it('skips a partner whose Stripe setup is unfinished', async () => {
    vi.stubEnv('PARTNER_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    stripe.transfers.create.mockClear();
    stripe.accounts.retrieve.mockResolvedValue({ id: 'acct_1', payouts_enabled: false, capabilities: { transfers: 'inactive' }, requirements: { currently_due: ['external_account'] } });
    const c = ctx({ payoutId: 'pay_1', amountCents: 6_000 });
    expect(await handler(c, {})).toEqual({ paid: 0 });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

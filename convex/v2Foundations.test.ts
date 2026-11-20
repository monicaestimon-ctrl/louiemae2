// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { acquireLock, audit, claimKey, rateLimit } from './sysCore';
import { activeConfig } from './sysConfig';
import { applyCommissionEvent, applyCreditEvent, obligationEventTotals } from './ldgCore';
import { isCommerceError } from '../lib/errors';
import { blankCommerceDraft } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';

beforeEach(() => {
  process.env.CJ_ADMIN_EMAILS = ADMIN;
});
afterEach(() => {
  delete process.env.CJ_ADMIN_EMAILS;
});

async function admin(t: ReturnType<typeof convexTest>) {
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN }));
  return t.withIdentity({ subject: `${userId}|s`, email: ADMIN });
}

describe('idempotency, audit, locks and rate limits (S03)', () => {
  it('claims a key once', async () => {
    const t = convexTest(schema, modules);
    const results = await t.run(async (ctx) => [await claimKey(ctx, 'k1', 'test', 'r1'), await claimKey(ctx, 'k1', 'test')]);
    expect(results[0].duplicate).toBe(false);
    expect(results[1]).toEqual({ duplicate: true, resultRef: 'r1' });
  });

  it('keeps one claim across separate concurrent transactions', async () => {
    const t = convexTest(schema, modules);
    const outcomes = await Promise.all([1, 2, 3].map(() => t.run((ctx) => claimKey(ctx, 'race', 'test'))));
    expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query('sysIdempotencyKeys').collect())).toHaveLength(1);
  });

  it('leases a lock and lets it lapse', async () => {
    const t = convexTest(schema, modules);
    const r = await t.run(async (ctx) => [
      await acquireLock(ctx, 'run', 'a', 1_000, 0),
      await acquireLock(ctx, 'run', 'b', 1_000, 500),
      await acquireLock(ctx, 'run', 'b', 1_000, 1_500),
    ]);
    expect(r).toEqual([true, false, true]);
  });

  it('rate-limits with a token bucket and writes audit rows', async () => {
    const t = convexTest(schema, modules);
    const allowed = await t.run(async (ctx) => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push(await rateLimit(ctx, 'clicks:v1', 3, 1, 0));
      out.push(await rateLimit(ctx, 'clicks:v1', 3, 1, 60_000));
      await audit(ctx, { actor: 'test', action: 'x', entityTable: 't', entityId: '1' });
      return out;
    });
    expect(allowed).toEqual([true, true, true, false, true]);
  });
});

describe('config registry and decision register (S02)', () => {
  it('seeds once, refuses proposed values in customer paths and lets the owner approve', async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.sysConfig.seed, {});
    const second = await t.mutation(internal.sysConfig.seed, {});
    expect(first.added).toBe(first.total);
    expect(second.added).toBe(0);
    // approved by the specification
    const sched = await t.run((ctx) => activeConfig<{ ceilingBps: number }>(ctx, 'commissionSchedule', 'commission-schedule'));
    expect(sched.value.ceilingBps).toBe(2300);
    // proposed: blocked unless simulating
    await expect(t.run((ctx) => activeConfig(ctx, 'estimatePolicy', 'estimate-policy'))).rejects.toSatisfy((e) => isCommerceError(e, 'POLICY_NOT_APPROVED'));
    const sim = await t.run((ctx) => activeConfig<{ validityMinutes: number }>(ctx, 'estimatePolicy', 'estimate-policy', { allowProposed: 'simulation' }));
    expect(sim.value.validityMinutes).toBe(30);
    const owner = await admin(t);
    const { records } = await owner.query(api.sysConfig.list, { status: 'proposed' });
    const rec = records.find((r) => r.key === 'estimate-policy')!;
    await owner.mutation(api.sysConfig.approve, { id: rec._id, note: 'D-16 approved' });
    const live = await t.run((ctx) => activeConfig<{ validityMinutes: number }>(ctx, 'estimatePolicy', 'estimate-policy'));
    expect(live.value.validityMinutes).toBe(30);
    const audits = await t.run((ctx) => ctx.db.query('sysAuditEvents').collect());
    expect(audits.some((a) => a.action === 'config.approve' && a.actor === ADMIN)).toBe(true);
  });

  it('validates proposals and rejects non-admins', async () => {
    const t = convexTest(schema, modules);
    const owner = await admin(t);
    await expect(owner.mutation(api.sysConfig.propose, { kind: 'marginPolicy', key: 'bad', value: { targetBps: 99_999 }, note: '' })).rejects.toThrow();
    await expect(owner.mutation(api.sysConfig.propose, { kind: 'nope', key: 'x', value: {}, note: '' })).rejects.toThrow();
    const otherId = await t.run((ctx) => ctx.db.insert('users', { email: 'someone@x.com' }));
    const other = t.withIdentity({ subject: `${otherId}|s`, email: 'someone@x.com' });
    await expect(other.mutation(api.sysConfig.propose, { kind: 'marginPolicy', key: 'x', value: { targetBps: 100 }, note: '' })).rejects.toThrow();
  });
});

describe('ledger core (S06)', () => {
  it('applies commission events exactly once and keeps events equal to the projection', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const b = await ctx.db.insert('prgBeneficiaries', { kind: 'person', displayName: 'P', payoutReadiness: 'not_started', taxReadiness: 'none', tierKey: 'base', status: 'active', createdAt: 0, updatedAt: 0 });
      const earn = await applyCommissionEvent(ctx, {
        eventKey: 'earn:line1',
        type: 'earned',
        amountMinor: 1_000,
        actor: 'test',
        at: 0,
        create: { beneficiaryId: b, source: 'retail_order', rateBps: 1000, basisMinor: 10_000, state: 'pending', clearsAt: 100 },
      });
      const again = await applyCommissionEvent(ctx, { eventKey: 'earn:line1', type: 'earned', amountMinor: 1_000, actor: 'test', create: { beneficiaryId: b, source: 'retail_order', rateBps: 1000, basisMinor: 10_000, state: 'pending', clearsAt: 100 } });
      expect(again.duplicate).toBe(true);
      const id = earn.obligationId!;
      await applyCommissionEvent(ctx, { eventKey: 'refund:r1', obligationId: id, type: 'refund_reversal', amountMinor: -300, actor: 'test', at: 10 });
      await applyCommissionEvent(ctx, { eventKey: 'refund:r1', obligationId: id, type: 'refund_reversal', amountMinor: -300, actor: 'test', at: 10 });
      await expect(applyCommissionEvent(ctx, { eventKey: 'clear:early', obligationId: id, type: 'cleared', amountMinor: 0, actor: 'test', at: 50 })).rejects.toSatisfy((e) => isCommerceError(e, 'PAYMENT_RECONCILIATION_REQUIRED'));
      await applyCommissionEvent(ctx, { eventKey: 'clear', obligationId: id, type: 'cleared', amountMinor: 0, actor: 'test', at: 100 });
      const o = (await ctx.db.get(id))!;
      expect(o).toMatchObject({ earnedMinor: 1_000, reversedMinor: 300, state: 'cleared', clearedAt: 100 });
      const totals = await obligationEventTotals(ctx, id);
      expect(totals).toEqual({ earned: 1_000, reversed: 300, events: 3 });
    });
  });

  it('reserves credit atomically so concurrent carts cannot overspend', async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'm@x.com' }));
    await t.run((ctx) => applyCreditEvent(ctx, { eventKey: 'open', userId, type: 'opening_balance', amountMinor: 10_000, actor: 't' }));
    const tries = await Promise.allSettled(
      [1, 2].map((i) => t.run((ctx) => applyCreditEvent(ctx, { eventKey: `hold:${i}`, userId, type: 'reserved', amountMinor: 7_000, actor: 't' })))
    );
    expect(tries.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const acct = await t.run((ctx) => ctx.db.query('ldgCreditAccounts').first());
    expect(acct).toMatchObject({ availableMinor: 3_000, reservedMinor: 7_000 });
  });
});

describe('backfills (S05, S06)', () => {
  async function legacy(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const partner = await ctx.db.insert('users', { email: 'p@x.com' });
      const both = await ctx.db.insert('users', { email: 'studio@x.com' });
      const noName = await ctx.db.insert('users', { email: 'nn@x.com' });
      await ctx.db.insert('holmProfiles', { userId: partner, displayName: 'Pat', tradeStatus: 'none', partnerStatus: 'active', partnerTier: 'active', refCode: 'PATAAAA', createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('holmProfiles', { userId: both, displayName: 'Studio', businessName: 'Studio LLC', tradeStatus: 'approved', partnerStatus: 'active', partnerTier: 'base', refCode: 'STUDBBBB', stripeAccountId: 'acct_1', payoutsReady: true, w9Status: 'approved', createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('holmProfiles', { userId: noName, displayName: 'NN', tradeStatus: 'approved', createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'storefront_order', baseCents: 10_000, rateBps: 1200, amountCents: 1_200, status: 'pending', clearsAt: 5, createdAt: 1 });
      await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'house_quote', baseCents: 20_000, rateBps: 1000, amountCents: 2_000, status: 'paid', clearsAt: 2, createdAt: 1 });
      await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'adjustment', baseCents: 0, rateBps: 0, amountCents: -500, status: 'cleared', clearsAt: 3, createdAt: 2 });
      await ctx.db.insert('holmCommissions', { partnerId: both, baseCents: 5_000, rateBps: 1000, amountCents: 0, status: 'void', clearsAt: 2, createdAt: 1 });
      await ctx.db.insert('holmCredits', { userId: both, amountCents: 10_000, kind: 'earned', reason: 'r', at: 1 });
      await ctx.db.insert('holmCredits', { userId: both, amountCents: -4_000, kind: 'reserved', ref: 'checkout:1', heldCents: 4_000, reason: 'h', at: 2 });
      return { partner, both };
    });
  }

  it('dry runs write nothing, commits are idempotent, and parity holds (MIG-IDENTITY-01, MIG-LEDGER-01)', async () => {
    const t = convexTest(schema, modules);
    const ids = await legacy(t);
    const dry = await t.mutation(internal.v2Migrations.identityBackfill, { dryRun: true });
    expect(dry.counts).toMatchObject({ profiles: 3, beneficiary_create: 2, creator_create: 2, trade_create: 2, org_create: 1, org_ambiguous: 1 });
    expect(await t.run((ctx) => ctx.db.query('prgBeneficiaries').collect())).toHaveLength(0);
    await t.mutation(internal.v2Migrations.identityBackfill, { dryRun: false });
    await t.mutation(internal.v2Migrations.identityBackfill, { dryRun: false });
    const bens = await t.run((ctx) => ctx.db.query('prgBeneficiaries').collect());
    expect(bens).toHaveLength(2);
    const studio = bens.find((b) => b.legacyUserId === ids.both)!;
    expect(studio).toMatchObject({ payoutReadiness: 'ready', taxReadiness: 'approved', payoutAccountRef: 'acct_1' });
    const memberships = await t.run((ctx) => ctx.db.query('prgMemberships').collect());
    expect(memberships.filter((m) => m.userId === ids.both).map((m) => m.program).sort()).toEqual(['creator', 'trade']); // one identity, two memberships
    expect(await t.run((ctx) => ctx.db.query('sysReviewItems').collect())).toHaveLength(1);

    await t.mutation(internal.v2Migrations.ledgerSnapshot, { dryRun: false });
    await t.mutation(internal.v2Migrations.ledgerSnapshot, { dryRun: false });
    await t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: false });
    await t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: false });
    const obligations = await t.run((ctx) => ctx.db.query('ldgObligations').collect());
    expect(obligations).toHaveLength(4);
    expect(obligations.map((o) => o.state).sort()).toEqual(['cleared', 'pending', 'transferred', 'void']);
    const parity = await t.query(internal.v2Migrations.ledgerParity, {});
    expect(parity.mismatches).toEqual([]);
    const acct = await t.run((ctx) => ctx.db.query('ldgCreditAccounts').first());
    expect(acct).toMatchObject({ availableMinor: 6_000, reservedMinor: 4_000 });
    // legacy rows untouched
    expect((await t.run((ctx) => ctx.db.query('holmCommissions').collect())).map((c) => c.amountCents)).toEqual([1_200, 2_000, -500, 0]);
  });

  it('runs every backfill to completion as a dry run', async () => {
    const t = convexTest(schema, modules);
    await legacy(t);
    const r = await t.action(internal.v2Migrations.runBackfills, {});
    expect(r.dryRun).toBe(true);
    expect(r.steps.identity.counts.beneficiary_create).toBe(2);
    expect(r.steps.ledger.counts.missing_beneficiary).toBe(4);
    expect(await t.run((ctx) => ctx.db.query('ldgObligations').collect())).toHaveLength(0);
  });
});

describe('zuo provider (S04)', () => {
  it('is never orderable or publishable through the legacy paths', async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run((ctx) => ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: 'zuo:1', draft: blankCommerceDraft(), revision: 1, updatedAt: 1 }));
    await expect(t.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v', quantity: 1 }] })).rejects.toThrow(/Coming Soon/);
    process.env.COMMERCE_PUBLISHING_ENABLED = 'true';
    const owner = await admin(t);
    await expect(owner.mutation(api.commerce.publish, { id: productId, revision: 1, channels: ['retail'] })).rejects.toThrow(/catalog review gates/);
    delete process.env.COMMERCE_PUBLISHING_ENABLED;
  });
});

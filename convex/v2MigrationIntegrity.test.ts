// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { applyCommissionEvent, applyCreditEvent } from './ldgCore';
import { settle } from './ldgCredits';
import { CREDIT_LIMIT, COMMISSION_LIMIT, SYNC_LIMIT, completeRows } from './migrationLedgerEvidence';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const NOW = Date.UTC(2026, 10, 23);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval'], now: NOW }); process.env.PAYOUT_EXECUTION_ENABLED = 'true'; process.env.PARTNER_PAYOUTS_ENABLED = 'false'; });
afterEach(() => { vi.useRealTimers(); delete process.env.PAYOUT_EXECUTION_ENABLED; delete process.env.PARTNER_PAYOUTS_ENABLED; });
async function fixture(status: 'pending' | 'cleared' | 'paid' = 'cleared', adjustment = false) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert('users', { email: 'synthetic@example.com' });
    await ctx.db.insert('holmProfiles', { userId, displayName: 'Synthetic', tradeStatus: 'none', partnerStatus: 'active', createdAt: NOW, updatedAt: NOW });
    const commissionId = await ctx.db.insert('holmCommissions', { partnerId: userId, source: adjustment ? 'adjustment' : 'storefront_order', baseCents: adjustment ? 0 : 10000, rateBps: adjustment ? 0 : 1000,
      amountCents: adjustment ? -500 : 1000, status, clearsAt: status === 'pending' ? NOW + 86400000 : NOW, createdAt: NOW });
    return { userId, commissionId };
  });
  await t.mutation(internal.v2Migrations.identityBackfill, { dryRun: false });
  await commitSnapshot(t, 'ledgerSnapshot');
  return { t, ...ids };
}
async function creditFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert('users', { email: 'credit-only@example.com' });
    const earnedId = await ctx.db.insert('holmCredits', { userId, amountCents: 10000, kind: 'earned', reason: 'Synthetic only', at: NOW });
    const holdId = await ctx.db.insert('holmCredits', { userId, amountCents: -4000, heldCents: 4000, kind: 'reserved', ref: 'fixture:hold', reason: 'Synthetic only', at: NOW + 1 });
    return { userId, earnedId, holdId };
  });
  return { t, ...ids };
}
describe('migration financial integrity', () => {
  it.each(['pending', 'cleared', 'paid'] as const)('reconciles repeated refund/restoration cycles for %s without duplicating transitions', async status => {
    const s = await fixture(status);
    const original = (await s.t.run(ctx => ctx.db.query('ldgObligations').first()))!;
    for (const target of [1000, 500, 1000, 500, 0, 1000, 500]) {
      await s.t.run(ctx => ctx.db.patch(s.commissionId, { amountCents: target }));
      await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {});
      const rows = await s.t.run(ctx => ctx.db.query('ldgObligations').collect());
      expect(rows.filter(r => r.state !== 'void').reduce((n, r) => n + r.earnedMinor - r.reversedMinor, 0)).toBe(target);
      const events = await s.t.run(ctx => ctx.db.query('ldgCommissionEvents').collect());
      expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toMatchObject({ adjusted: 0 });
      expect(await s.t.run(ctx => ctx.db.query('ldgCommissionEvents').collect())).toEqual(events);
      expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).mismatches).toEqual([]);
    }
    expect(await s.t.run(ctx => ctx.db.get(original._id))).toMatchObject({ earnedMinor: original.earnedMinor, rateBps: original.rateBps, basisMinor: original.basisMinor });
    if (status === 'paid') expect((await s.t.run(ctx => ctx.db.get(original._id)))!.state).toBe('transferred');
    if (status === 'pending') expect((await s.t.run(ctx => ctx.db.query('ldgObligations').collect())).filter(o => o.state !== 'void').every(o => o.state === 'pending')).toBe(true);
  });
  it('follows signed legacy adjustments without rewriting the opening amount', async () => {
    const s = await fixture('cleared', true);
    for (const target of [-500, -200, -500, 0, -500]) {
      await s.t.run(ctx => ctx.db.patch(s.commissionId, { amountCents: target }));
      await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {});
      expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).mismatches).toEqual([]);
    }
    expect((await s.t.run(ctx => ctx.db.query('ldgObligations').first()))!.earnedMinor).toBe(-500);
  });
  it('includes offsets created by the previous sync format', async () => {
    const s = await fixture('paid');
    await s.t.run(async ctx => {
      const original = (await ctx.db.query('ldgObligations').first())!;
      await applyCommissionEvent(ctx, { eventKey: `sync:${s.commissionId}:500`, type: 'offset', amountMinor: -500, actor: 'sync:legacy',
        create: { beneficiaryId: original.beneficiaryId, source: 'offset', rateBps: 0, basisMinor: 0, state: 'cleared', clearsAt: NOW } });
      await ctx.db.patch(s.commissionId, { amountCents: 500 });
    });
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toMatchObject({ adjusted: 0 });
    await s.t.run(ctx => ctx.db.patch(s.commissionId, { amountCents: 1000 }));
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toMatchObject({ adjusted: 1 });
    expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).mismatches).toEqual([]);
  });
  it('finds credit-only users without profiles or beneficiaries and checks missing accounts', async () => {
    const s = await creditFixture();
    const missing = await s.t.query(internal.v2Migrations.ledgerParity, {});
    expect(missing.scopeComplete).toBe(false); expect(missing.mismatches.join()).toContain('no v2 account');
    await commitSnapshot(s.t, 'creditSnapshot');
    expect(await s.t.query(internal.v2Migrations.ledgerParity, {})).toMatchObject({ scopeComplete: true, mismatches: [] });
  });
  it('preserves native credit activity while checking migrated opening and active hold provenance', async () => {
    const s = await creditFixture();
    await commitSnapshot(s.t, 'creditSnapshot');
    await s.t.run(async ctx => {
      await applyCreditEvent(ctx, { eventKey: 'native:fixture', userId: s.userId, type: 'manual_adjustment', amountMinor: 2000, actor: 'test' });
      await settle(ctx, 'fixture:hold', 'redeemed', 1000);
    });
    expect(await s.t.query(internal.v2Migrations.ledgerParity, {})).toMatchObject({ scopeComplete: true, mismatches: [] });
    const before = await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect());
    await commitSnapshot(s.t, 'creditSnapshot');
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect())).toEqual(before);
    const account = (await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').first()))!;
    expect(account).toMatchObject({ availableMinor: 11000, reservedMinor: 0 });
    await s.t.run(ctx => ctx.db.patch(account._id, { reservedMinor: 1 }));
    expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).mismatches.join()).toContain('reservedMinor');
  });
  it.each(['source-drift', 'missing-fingerprint', 'hold-reference'] as const)('refuses an unsafe credit retry after %s', async change => {
    const s = await creditFixture();
    await commitSnapshot(s.t, 'creditSnapshot');
    await s.t.run(async ctx => {
      if (change === 'source-drift') await ctx.db.patch(s.earnedId, { amountCents: 11000 });
      const events = await ctx.db.query('ldgCreditEvents').collect();
      if (change === 'missing-fingerprint') await ctx.db.patch(events.find(e => e.type === 'opening_balance')!._id, { sourceFingerprint: undefined });
      if (change === 'hold-reference') await ctx.db.patch(events.find(e => e.type === 'reserved')!._id, { ref: 'wrong-owner-reference' });
    });
    const before = await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect());
    await expect(commitSnapshot(s.t, 'creditSnapshot')).rejects.toThrow();
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect())).toEqual(before);
    expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).scopeComplete).toBe(false);
  });
  it.each(['missing-ref', 'duplicate-ref', 'wrong-amount'] as const)('rejects %s legacy holds before committing any money events', async change => {
    const s = await creditFixture();
    await s.t.run(async ctx => {
      if (change === 'missing-ref') await ctx.db.patch(s.holdId, { ref: undefined });
      if (change === 'wrong-amount') await ctx.db.patch(s.holdId, { heldCents: 3000 });
      if (change === 'duplicate-ref') await ctx.db.insert('holmCredits', { userId: s.userId, amountCents: -1000, heldCents: 1000, kind: 'reserved', ref: 'fixture:hold', reason: 'Duplicate fixture', at: NOW + 2 });
    });
    await expect(commitSnapshot(s.t, 'creditSnapshot')).rejects.toThrow(/hold/);
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect())).toEqual([]);
  });
  it.each([false, true])('does not erase negative credit or manufacture hold funding (hold=%s)', async withHold => {
    const s = await creditFixture();
    await s.t.run(async ctx => {
      if (withHold) await ctx.db.patch(s.earnedId, { amountCents: 3000 });
      else {
        await ctx.db.delete(s.holdId);
        await ctx.db.patch(s.earnedId, { amountCents: -1000 });
      }
    });
    await expect(s.t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: true })).rejects.toThrow(/Negative legacy credit/);
    await expect(commitSnapshot(s.t, 'creditSnapshot')).rejects.toThrow(/Negative legacy credit/);
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect())).toEqual([]);
    expect(await s.t.action(internal.v2Migrations.runLedgerParity, {})).toMatchObject({ passed: false, complete: false });
  });
  it('does not import or certify a truncated credit history', async () => {
    const s = await creditFixture();
    await s.t.run(async ctx => { for (let i = 2; i <= CREDIT_LIMIT; i++) await ctx.db.insert('holmCredits', { userId: s.userId, amountCents: 1, kind: 'earned', reason: 'Synthetic boundary', at: NOW + i }); });
    await expect(s.t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: true })).rejects.toThrow(/exceeds/);
    await expect(commitSnapshot(s.t, 'creditSnapshot')).rejects.toThrow(/exceeds/);
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').collect())).toHaveLength(0);
    expect(await s.t.action(internal.v2Migrations.runLedgerParity, {})).toMatchObject({ passed: false, complete: false });
  });
  it('does not certify a truncated legacy commission history', async () => {
    const s = await fixture();
    await s.t.run(async ctx => { for (let i = 1; i <= COMMISSION_LIMIT; i++) await ctx.db.insert('holmCommissions', { partnerId: s.userId, amountCents: 1, baseCents: 10, rateBps: 1000, status: 'cleared', clearsAt: NOW, createdAt: NOW }); });
    expect(await s.t.query(internal.v2Migrations.ledgerParity, {})).toMatchObject({ scopeComplete: false });
  });
  it('requires explicit reconciliation at the sync history limit instead of adjusting a prefix', async () => {
    const s = await fixture();
    await s.t.run(async ctx => { const original = (await ctx.db.query('ldgObligations').first())!;
      for (let i = 0; i <= SYNC_LIMIT; i++) await ctx.db.insert('ldgCommissionEvents', { obligationId: original._id, eventKey: `sync:${s.commissionId}:fixture:${i}`, type: 'refund_reversal', amountMinor: 0, actor: 'fixture', at: NOW });
      await ctx.db.patch(s.commissionId, { amountCents: 500 }); });
    await expect(s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).rejects.toThrow(/exceeds/);
    expect((await s.t.run(ctx => ctx.db.query('ldgObligations').first()))!.reversedMinor).toBe(0);
  });
  it('scans all user pages and reports bounded diagnostics with complete counts', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => { for (let i = 0; i < 55; i++) {
      const userId = await ctx.db.insert('users', { email: `fixture-${i}@example.com` });
      await ctx.db.insert('holmCredits', { userId, amountCents: 10000, kind: 'earned', reason: 'Synthetic', at: NOW });
    } });
    const result = await t.action(internal.v2Migrations.runLedgerParity, { includeDetails: true });
    expect(result).toMatchObject({ passed: false, complete: false, pages: 5, mismatchCount: 55, diagnosticsTruncated: true, counts: { users: 55 } });
    expect(result.mismatches).toHaveLength(50);
  });
  it('reports legacy financial rows whose user was deleted', async () => {
    const s = await creditFixture();
    await s.t.run(ctx => ctx.db.delete(s.userId));
    const report = await s.t.action(internal.v2Migrations.runLedgerParity, { includeDetails: true });
    expect(report.passed).toBe(false);
    expect(report.mismatchCount).toBe(2);
    expect(report.mismatches.join()).toContain('owner is missing');
    const safe = await s.t.action(internal.v2Migrations.runLedgerParity, {});
    expect(safe).toMatchObject({ passed: false, diagnosticsRedacted: true, mismatches: [] });
    expect(JSON.stringify(safe)).not.toContain(s.userId);
  });
  it('refuses duplicate or foreign commission ownership without adjusting money', async () => {
    const s = await fixture();
    await s.t.run(async ctx => {
      const original = (await ctx.db.query('ldgObligations').first())!;
      const beneficiary = (await ctx.db.get(original.beneficiaryId))!;
      const other = await ctx.db.insert('users', { email: 'other@example.com' });
      await ctx.db.patch(beneficiary._id, { userId: other });
      await ctx.db.patch(s.commissionId, { amountCents: 500 });
    });
    await expect(s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).rejects.toThrow(/beneficiary/);
    expect((await s.t.run(ctx => ctx.db.query('ldgObligations').first()))!.reversedMinor).toBe(0);
    expect((await s.t.query(internal.v2Migrations.ledgerParity, {})).scopeComplete).toBe(false);
  });
  it('requires a current reviewed credit page and rolls back an outdated opening', async () => {
    const s = await creditFixture();
    const reviewed = await s.t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: true });
    await expect(s.t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: false })).rejects.toThrow(/dry run/);
    await s.t.run(ctx => ctx.db.patch(s.earnedId, { amountCents: 11000 }));
    await expect(s.t.mutation(internal.v2Migrations.creditSnapshot, { dryRun: false, expectedSourceHash: reviewed.sourceHash })).rejects.toThrow(/dry run/);
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditEvents').collect())).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').collect())).toHaveLength(0);
    await commitSnapshot(s.t, 'creditSnapshot');
    expect((await s.t.run(ctx => ctx.db.query('ldgCreditAccounts').first()))!.availableMinor).toBe(7000);
  });
  it('rolls back new commission openings if the reviewed page changes', async () => {
    const s = await fixture();
    const freshId = await s.t.run(ctx => ctx.db.insert('holmCommissions', { partnerId: s.userId, source: 'storefront_order', amountCents: 1000, baseCents: 10000, rateBps: 1000, status: 'cleared', clearsAt: NOW, createdAt: NOW }));
    const reviewed = await s.t.mutation(internal.v2Migrations.ledgerSnapshot, { dryRun: true });
    await s.t.run(ctx => ctx.db.patch(freshId, { amountCents: 2000 }));
    await expect(s.t.mutation(internal.v2Migrations.ledgerSnapshot, { dryRun: false, expectedSourceHash: reviewed.sourceHash })).rejects.toThrow(/dry run/);
    expect(await s.t.run(ctx => ctx.db.query('ldgObligations').collect())).toHaveLength(1);
    expect(await s.t.run(ctx => ctx.db.query('ldgCommissionEvents').collect())).toHaveLength(1);
    await expect(s.t.action(internal.v2Migrations.runBackfills, { commit: true, only: ['ledger'] })).rejects.toThrow(/expectedSourceHash/);
  });
  it('accepts the exact read boundary and refuses the next record', () => {
    expect(completeRows([1, 2], 2, 'fixture')).toEqual([1, 2]);
    expect(() => completeRows([1, 2, 3], 2, 'fixture')).toThrow(/exceeds/);
  });
});

// Local test review-and-commit harness. Financial production commits remain explicit pages.
async function commitSnapshot(t: ReturnType<typeof convexTest>, name: 'ledgerSnapshot' | 'creditSnapshot') {
  const fn = internal.v2Migrations[name];
  const reviewed = await t.mutation(fn, { dryRun: true });
  return t.mutation(fn, { dryRun: false, expectedSourceHash: reviewed.sourceHash });
}

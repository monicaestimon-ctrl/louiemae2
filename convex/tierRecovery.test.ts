// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { qualifyingMinor, recompute } from './prgTiers';
import { evaluateAlerts } from './sysAlerts';
import { previousLocalDate, tierDateDue } from '../lib/tiers';
import { isCommerceError } from '../lib/errors';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const NOW = Date.UTC(2026, 10, 23, 8, 15);
const ADMIN = 'tier-owner@example.com';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval'], now: NOW }); process.env.CJ_ADMIN_EMAILS = ADMIN; });
afterEach(() => { vi.useRealTimers(); delete process.env.CJ_ADMIN_EMAILS; });
async function setup(count = 1) {
  const t = convexTest(schema, modules);
  const user = await t.run(ctx => ctx.db.insert('users', { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${user}|s`, email: ADMIN });
  await t.mutation(internal.sysConfig.seed, {});
  const { records } = await admin.query(api.sysConfig.list, { status: 'proposed' });
  for (const key of ['tier-policy', 'commission-schedule']) {
    const proposed = records.find(r => r.key === key);
    if (proposed) await admin.mutation(api.sysConfig.approve, { id: proposed._id });
  }
  const beneficiaries = await t.run(async ctx => {
    const ids: Id<'prgBeneficiaries'>[] = [];
    for (let i = 0; i < count; i++) ids.push(await ctx.db.insert('prgBeneficiaries', { kind: 'person', ...(i === 0 ? { userId: user, legacyUserId: user } : {}), displayName: `Partner ${i}`, payoutReadiness: 'not_started', taxReadiness: 'none', tierKey: 'base', status: 'active', createdAt: 0, updatedAt: 0 }));
    return ids;
  });
  const earn = (beneficiaryId: Id<'prgBeneficiaries'>, patch: Partial<Doc<'ldgObligations'>> = {}) => t.run(ctx => ctx.db.insert('ldgObligations', { beneficiaryId, source: 'retail_order', rateBps: 1000, basisMinor: 1500000, earnedMinor: 150000, reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'pending', paidAt: NOW, clearsAt: NOW, currency: 'USD', createdAt: NOW, updatedAt: NOW, ...patch }));
  const runs = () => t.run(ctx => ctx.db.query('prgTierRuns').collect());
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, admin, user, beneficiaries, earn, runs, drain };
}

it('includes current paid sales after more than 10,000 expired records, and honors missing paidAt fallback', async () => {
  const s = await setup(); const b = s.beneficiaries[0];
  for (let batch = 0; batch < 10; batch++) await s.t.run(async ctx => {
    for (let i = 0; i < 1000; i++) await ctx.db.insert('ldgObligations', { beneficiaryId: b, source: 'retail_order', rateBps: 1000, basisMinor: 100, earnedMinor: 10, reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'cleared', paidAt: 0, clearsAt: 0, currency: 'USD', createdAt: 0, updatedAt: 0 });
  });
  await s.earn(b, { createdAt: 0 }); // old creation, current payment
  await s.earn(b, { basisMinor: 200, paidAt: undefined });
  await s.earn(b, { basisMinor: 900, paidAt: NOW - 100 }); // outside requested window
  expect(await s.t.run(ctx => qualifyingMinor(ctx, b, NOW, NOW))).toBe(1500200);
  expect(await s.t.run(ctx => recompute(ctx, b, 'event', 'complete-current-history'))).toMatchObject({ tier: 'active' });
}, 30000);

it('fails closed on incomplete or invalid current evidence without replacing a verified tier', async () => {
  const s = await setup(); const b = s.beneficiaries[0];
  const original = await s.earn(b);
  await s.t.run(ctx => recompute(ctx, b, 'event', 'good'));
  await s.t.run(ctx => ctx.db.patch(original, { refundedBasisMinor: 1500001 }));
  expect(await s.t.run(ctx => recompute(ctx, b, 'event', 'bad'))).toMatchObject({ tier: 'active', reviewRequired: true });
  expect(await s.admin.query(api.prgTiers.myTier, {})).toMatchObject({ tier: 'active', reviewRequired: true });
  await s.t.run(ctx => ctx.db.patch(original, { refundedBasisMinor: 0 }));
  await s.t.run(ctx => recompute(ctx, b, 'event', 'repaired'));
  expect(await s.admin.query(api.prgTiers.myTier, {})).toMatchObject({ reviewRequired: false });
  for (let batch = 0; batch < 10; batch++) await s.t.run(async ctx => {
    for (let i = 0; i < 1000; i++) await ctx.db.insert('ldgObligations', { beneficiaryId: b, source: 'retail_order', rateBps: 1000, basisMinor: 100, earnedMinor: 10, reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'cleared', paidAt: NOW, clearsAt: NOW, currency: 'USD', createdAt: NOW, updatedAt: NOW });
  });
  await expect(s.t.run(ctx => qualifyingMinor(ctx, b, NOW, NOW))).rejects.toSatisfy(e => isCommerceError(e, 'PAYMENT_RECONCILIATION_REQUIRED'));
  expect(await s.t.run(ctx => recompute(ctx, b, 'event', 'oversize'))).toMatchObject({ tier: 'active', reviewRequired: true });
}, 30000);

it('excludes refunds, held/void obligations and adjustments, and rejects unsafe sums', async () => {
  const s = await setup(); const b = s.beneficiaries[0];
  await s.earn(b, { basisMinor: 500, refundedBasisMinor: 100 });
  for (const state of ['held', 'void'] as const) await s.earn(b, { state });
  for (const source of ['adjustment', 'offset'] as const) await s.earn(b, { source });
  expect(await s.t.run(ctx => qualifyingMinor(ctx, b, NOW, NOW))).toBe(400);
  await s.earn(b, { basisMinor: Number.MAX_SAFE_INTEGER });
  await expect(s.t.run(ctx => qualifyingMinor(ctx, b, NOW, NOW))).rejects.toSatisfy(e => isCommerceError(e, 'PAYMENT_RECONCILIATION_REQUIRED'));
});

it('does not call the daily run complete after its first snapshot and handles duplicate continuations', async () => {
  const s = await setup(3); for (const b of s.beneficiaries) await s.earn(b);
  expect(await s.t.mutation(internal.prgTiers.dailyTick, {})).toHaveProperty('started');
  const run = (await s.runs())[0];
  const args = { runId: run._id, generation: run.generation, expectedCursor: null };
  await s.t.mutation(internal.prgTiers.dailyPage, args);
  expect((await s.runs())[0]).toMatchObject({ status: 'running', processed: 1 });
  expect(await s.t.mutation(internal.prgTiers.dailyTick, {})).toMatchObject({ skipped: 'in progress' });
  expect(await s.t.mutation(internal.prgTiers.dailyPage, args)).toMatchObject({ skipped: 'stale continuation' });
  await s.drain();
  expect((await s.runs())[0]).toMatchObject({ status: 'complete', processed: 3, reviewCount: 0 });
  const snapshots = await s.t.run(ctx => ctx.db.query('prgTierSnapshots').collect());
  expect(snapshots).toHaveLength(3);
  expect(await s.t.mutation(internal.prgTiers.dailyTick, {})).toMatchObject({ skipped: 'finished', status: 'complete' });
});

it('resumes an expired lease from its committed cursor and ignores the previous generation', async () => {
  const s = await setup(3);
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  const run = (await s.runs())[0];
  await s.t.mutation(internal.prgTiers.dailyPage, { runId: run._id, generation: 1, expectedCursor: null });
  const cursor = (await s.runs())[0].cursor;
  await s.t.run(ctx => ctx.db.patch(run._id, { leaseUntil: Date.now() - 1 }));
  expect(await s.t.mutation(internal.prgTiers.dailyTick, {})).toHaveProperty('resumed');
  expect(await s.t.mutation(internal.prgTiers.dailyPage, { runId: run._id, generation: 1, expectedCursor: cursor })).toMatchObject({ skipped: 'stale continuation' });
  await s.drain();
  expect((await s.runs())[0]).toMatchObject({ status: 'complete', processed: 3, generation: 2 });
  expect(await s.t.run(ctx => ctx.db.query('prgTierSnapshots').collect())).toHaveLength(3);
});

it('keeps a newer event result and its immutable rates when an older daily worker resumes', async () => {
  const s = await setup(); const b = s.beneficiaries[0];
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  const sale = await s.earn(b);
  vi.setSystemTime(NOW + 1000);
  await s.t.run(ctx => recompute(ctx, b, 'event', 'new-sale'));
  await s.drain();
  expect(await s.t.run(ctx => ctx.db.query('prgTierSnapshots').collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.get(b))).toMatchObject({ tierKey: 'active' });
  expect(await s.t.run(ctx => ctx.db.get(sale))).toMatchObject({ rateBps: 1000 });
  expect((await s.runs())[0]).toMatchObject({ status: 'complete' });
});


it('retains a newer repeated evidence failure when an older daily window would otherwise clear it', async () => {
  const s = await setup(); const b = s.beneficiaries[0];
  const priorQuarter = Date.UTC(2026, 8, 30, 12);
  const earned = await s.earn(b, { paidAt: priorQuarter });
  await s.t.run(ctx => recompute(ctx, b, 'event', 'verified-prior-quarter', priorQuarter));
  await s.t.run(ctx => ctx.db.patch(earned, { refundedBasisMinor: 1500000 }));
  const first = await s.earn(b, { paidAt: NOW + 500, basisMinor: 100, refundedBasisMinor: 101 });
  vi.setSystemTime(NOW + 1000);
  expect(await s.t.run(ctx => recompute(ctx, b, 'event', 'failed-first'))).toMatchObject({ tier: 'active', reviewRequired: true });
  vi.setSystemTime(NOW + 1500);
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  // The same open review sees a later failed attempt; its opening time is insufficient.
  await s.t.run(ctx => ctx.db.patch(first, { state: 'void' }));
  const second = await s.earn(b, { paidAt: NOW + 2000, basisMinor: 100, refundedBasisMinor: 101 });
  vi.setSystemTime(NOW + 3000);
  expect(await s.t.run(ctx => recompute(ctx, b, 'event', 'failed-again'))).toMatchObject({ reviewRequired: true });
  await s.drain();
  expect(await s.admin.query(api.prgTiers.myTier, {})).toMatchObject({ tier: 'active', reviewRequired: true });
  expect(await s.t.run(ctx => ctx.db.get(b))).toMatchObject({ tierEvidenceAttemptAt: NOW + 3000 });
  expect(await s.t.run(ctx => ctx.db.query('prgTierSnapshots').collect())).toHaveLength(1);
  expect((await s.runs())[0]).toMatchObject({ status: 'review', reviewCount: 1 });
  await s.t.run(ctx => ctx.db.patch(second, { refundedBasisMinor: 100 }));
  vi.setSystemTime(NOW + 4000);
  await s.t.run(ctx => recompute(ctx, b, 'event', 'complete-repair'));
  expect(await s.admin.query(api.prgTiers.myTier, {})).toMatchObject({ tier: 'base', reviewRequired: false, qualifyingMinor: 0 });
  expect(await s.t.run(ctx => ctx.db.get(b))).toMatchObject({ tierEvidenceAttemptAt: NOW + 4000 });
});

it('finishes a traversal with review status rather than pretending incomplete evidence succeeded', async () => {
  const s = await setup(2);
  await s.earn(s.beneficiaries[0], { basisMinor: -1 });
  await s.earn(s.beneficiaries[1]);
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  await s.drain();
  expect((await s.runs())[0]).toMatchObject({ status: 'review', processed: 2, reviewCount: 1 });
  expect(await s.t.run(ctx => ctx.db.get(s.beneficiaries[1]))).toMatchObject({ tierKey: 'active' });
});

it('rejects configuration drift during a daily run instead of mixing policies', async () => {
  const s = await setup();
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  const run = (await s.runs())[0];
  await s.t.run(ctx => ctx.db.patch(run.policyId, { status: 'retired' }));
  await s.drain();
  expect((await s.runs())[0]).toMatchObject({ status: 'review', processed: 0, failureReason: 'Approved configuration changed during the run' });
});

it('alerts on partial daily progress until the whole run completes', async () => {
  const s = await setup(2);
  await s.t.mutation(internal.prgTiers.dailyTick, {});
  const run = (await s.runs())[0];
  await s.t.mutation(internal.prgTiers.dailyPage, { runId: run._id, generation: 1, expectedCursor: null });
  expect((await s.t.run(ctx => evaluateAlerts(ctx, NOW + 86400000))).some(a => a.key === 'tier_job_missed_2026-11-23')).toBe(true);
  await s.drain();
  expect((await s.t.run(ctx => evaluateAlerts(ctx, NOW + 86400000))).some(a => a.key === 'tier_job_missed_2026-11-23')).toBe(false);
});

it('uses calendar yesterday across DST and catches up after the first scheduled hour', () => {
  expect(previousLocalDate(Date.parse('2026-11-02T06:30:00Z'), 'America/Chicago')).toBe('2026-11-01');
  expect(previousLocalDate(Date.parse('2026-03-09T05:30:00Z'), 'America/Chicago')).toBe('2026-03-08');
  expect(tierDateDue(Date.parse('2026-11-23T06:14:00Z'), 'America/Chicago', '00:15')).toBeNull();
  expect(tierDateDue(Date.parse('2026-11-23T18:00:00Z'), 'America/Chicago', '00:15')).toBe('2026-11-23');
});

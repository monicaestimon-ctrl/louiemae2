// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { winningFor } from './prgAttribution';
import { ATTRIBUTION_WINDOW_MS, visitorKeyHash } from '../lib/attribution';
import { isCommerceError } from '../lib/errors';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const visitorKey = 'existing-browser-123456';
const now = Date.UTC(2026, 10, 23);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now }); process.env.ATTRIBUTION_V2_ENABLED = 'true'; });
afterEach(() => { vi.useRealTimers(); delete process.env.ATTRIBUTION_V2_ENABLED; });
async function setup() {
  const t = convexTest(schema, modules);
  const hash = await visitorKeyHash(visitorKey);
  const { userId, otherId, beneficiaryId } = await t.run(async ctx => {
    const userId = await ctx.db.insert('users', { email: 'buyer@example.com' });
    const otherId = await ctx.db.insert('users', { email: 'other@example.com' });
    const beneficiaryId = await ctx.db.insert('prgBeneficiaries', { kind: 'person', userId: otherId, displayName: 'Partner', payoutReadiness: 'not_started', taxReadiness: 'none', tierKey: 'base', status: 'active', createdAt: now, updatedAt: now });
    return { userId, otherId, beneficiaryId };
  });
  const as = t.withIdentity({ subject: `${userId}|s`, email: 'buyer@example.com' });
  const insert = (items: { clickId: string; at?: number; eligible?: boolean; expiresAt?: number; userId?: Id<'users'>; visitorKeyHash?: string }[]) => t.run(async ctx => {
    for (const item of items) await ctx.db.insert('prgReferralClicks', { beneficiaryId, membershipSource: 'creator', visitorKeyHash: hash, consent: 'granted', eligible: true, rateSnapshot: { tierKey: 'base', scheduleVersion: 2 }, at: now - 100, expiresAt: now + 1000, ...item });
  });
  return { t, as, userId, otherId, insert };
}

describe('complete newest eligible referral selection', () => {
  it('finds the latest visit beyond 200 old rows and ignores hundreds of ineligible newer rows', async () => {
    const s = await setup();
    await s.insert(Array.from({ length: 250 }, (_, i) => ({ clickId: `old${i}`, at: now - 1000 + i })));
    await s.insert([{ clickId: 'winner', at: now - 10 }, ...Array.from({ length: 250 }, (_, i) => ({ clickId: `bot${i}`, at: now - 1, eligible: false }))]);
    expect((await s.t.run(ctx => winningFor(ctx, visitorKey, undefined)))?.clickId).toBe('winner');
  });
  it('uses the same deterministic tie order across visitor and account candidates', async () => {
    const s = await setup();
    await s.insert([{ clickId: 'a', userId: s.userId }, { clickId: 'z', visitorKeyHash: 'another-browser', userId: s.userId }, { clickId: 'b' }]);
    expect((await s.t.run(ctx => winningFor(ctx, visitorKey, s.userId)))?.clickId).toBe('z');
    expect((await s.t.run(ctx => winningFor(ctx, visitorKey, undefined)))?.clickId).toBe('b');
  });
  it('ignores future, exactly 30-day-old and early-expired visits even with a long stored expiry', async () => {
    const s = await setup();
    await s.insert([{ clickId: 'future', at: now + 1 }, { clickId: 'old', at: now - ATTRIBUTION_WINDOW_MS, expiresAt: now + 9999 }, { clickId: 'expired', expiresAt: now }, { clickId: 'valid', at: now - ATTRIBUTION_WINDOW_MS + 1 }]);
    expect((await s.t.run(ctx => winningFor(ctx, visitorKey, undefined)))?.clickId).toBe('valid');
  });
  it('requires review instead of silently losing attribution beyond the scan bound', async () => {
    const s = await setup();
    await s.insert([{ clickId: 'valid', at: now - 1000 }, ...Array.from({ length: 200 }, (_, i) => ({ clickId: `expired${i}`, at: now - i, expiresAt: now }))]);
    await expect(s.t.run(ctx => winningFor(ctx, visitorKey, undefined))).rejects.toSatisfy(e => isCommerceError(e, 'COST_REVIEW_REQUIRED'));
  });
  it('returns no winner for a completely scanned expired history', async () => {
    const s = await setup(); await s.insert([{ clickId: 'expired', expiresAt: now }]);
    expect(await s.t.run(ctx => winningFor(ctx, visitorKey, undefined))).toBeNull();
  });
});

describe('bounded consent-aware account association', () => {
  it('continues beyond 50 rows without changing another account, future, expired or ineligible clicks', async () => {
    const s = await setup();
    await s.insert(Array.from({ length: 125 }, (_, i) => ({ clickId: `visit${i}`, at: now - i, expiresAt: now + 100000 })));
    await s.insert([{ clickId: 'other', userId: s.otherId }, { clickId: 'ineligible', eligible: false }, { clickId: 'expired', expiresAt: now }, { clickId: 'future', at: now + 10000 }]);
    let result = await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted' });
    let pages = 1, associated = result.associated;
    while (!result.isDone && pages < 10) {
      vi.setSystemTime(Date.now() + 1);
      result = await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted', cursor: result.cursor!, cutoff: result.cutoff!, expectedUserId: result.userId! });
      associated += result.associated; pages++;
    }
    expect(result.isDone).toBe(true); expect(pages).toBeGreaterThan(2); expect(associated).toBe(125);
    const rows = await s.t.run(ctx => ctx.db.query('prgReferralClicks').collect());
    expect(rows.filter(r => r.userId === s.userId)).toHaveLength(125);
    expect(rows.find(r => r.clickId === 'other')?.userId).toBe(s.otherId);
    for (const id of ['ineligible', 'expired', 'future']) expect(rows.find(r => r.clickId === id)?.userId).toBeUndefined();
    expect((await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted' })).associated).toBe(0);
  });
  it('does not associate signed-out, disabled, denied or unapproved unknown-consent requests', async () => {
    const s = await setup(); await s.insert([{ clickId: 'visit' }]);
    expect((await s.t.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted' })).associated).toBe(0);
    for (const consent of ['denied', 'unknown'] as const) expect((await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent })).associated).toBe(0);
    process.env.ATTRIBUTION_V2_ENABLED = 'false';
    expect((await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted' })).associated).toBe(0);
    expect((await s.t.run(ctx => ctx.db.query('prgReferralClicks').first()))?.userId).toBeUndefined();
  });
  it('rejects a continuation from a different account or with invalid bounds', async () => {
    const s = await setup();
    await expect(s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted', expectedUserId: s.otherId })).rejects.toThrow('Account changed');
    await expect(s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted', cutoff: now + 1 })).rejects.toThrow('Invalid association continuation');
    await expect(s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted', cursor: 'cursor' })).rejects.toThrow('Invalid association continuation');
  });
  it('validates an already-stored attribution policy at read time', async () => {
    const s = await setup(); await s.t.mutation(internal.sysConfig.seed, {});
    await s.t.run(async ctx => {
      const row = (await ctx.db.query('sysConfig').filter(q => q.eq(q.field('kind'), 'attributionPolicy')).first())!;
      await ctx.db.patch(row._id, { status: 'approved', effectiveFrom: now - 1, value: { ...row.value, windowMs: 1 } });
    });
    await expect(s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'granted' })).rejects.toThrow('30-day');
  });
  it('allows unknown consent only under the explicit approved policy, never a denied preference', async () => {
    const s = await setup(); await s.t.mutation(internal.sysConfig.seed, {}); await s.insert([{ clickId: 'visit' }]);
    await s.t.run(async ctx => {
      const row = (await ctx.db.query('sysConfig').filter(q => q.eq(q.field('kind'), 'attributionPolicy')).first())!;
      await ctx.db.patch(row._id, { status: 'approved', effectiveFrom: now - 1, value: { ...row.value, consentUnknownAllowsStorage: true } });
    });
    expect((await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'denied' })).associated).toBe(0);
    expect((await s.as.mutation(api.prgAttribution.associateVisitor, { visitorKey, consent: 'unknown' })).associated).toBe(1);
  });
});

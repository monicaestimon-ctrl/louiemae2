// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { tierForSales, tierProgress } from '../lib/holmPartners';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const DAY = 864e5;
// Fake timers keep the tier email (a scheduled action) from running after the test ends.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A partner at `tier` with one paid order of `saleCents` placed `daysAgo` days ago. */
async function partnerWithSales(t: ReturnType<typeof convexTest>, tier: 'base' | 'active' | 'top' | 'elite', saleCents: number, daysAgo = 10, extra = {}) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'partner@studio.com' });
    const profileId = await ctx.db.insert('holmProfiles', { userId, displayName: 'Studio', tradeStatus: 'none', partnerStatus: 'active', partnerTier: tier, refCode: 'STUDIO42', createdAt: 0, updatedAt: 0, ...extra });
    if (saleCents)
      await ctx.db.insert('holmCommissions', {
        partnerId: userId, source: 'storefront_order', baseCents: saleCents, rateBps: 1000, amountCents: saleCents / 10, originalCents: saleCents / 10,
        status: 'cleared', clearsAt: 0, createdAt: Date.now() - daysAgo * DAY,
      });
    return { userId, profileId };
  });
}
const runTier = (t: ReturnType<typeof convexTest>, profileId: Id<'holmProfiles'>) =>
  t.mutation(internal.holmPartners.updatePartnerTier, { profileId, now: Date.now() });
const tierOf = (t: ReturnType<typeof convexTest>, id: Id<'holmProfiles'>) => t.run(async (ctx) => (await ctx.db.get(id))!.partnerTier);

describe('tier thresholds', () => {
  it('match the spec', () => {
    expect(tierForSales(1_499_900)).toBe('base');
    expect(tierForSales(1_500_000)).toBe('active');
    expect(tierForSales(5_000_000)).toBe('top');
    expect(tierForSales(10_000_000)).toBe('elite');
    expect(tierProgress('active', 4_680_000).line).toBe('$3,200 more in sales to reach Top');
    expect(tierProgress('elite', 0).next).toBeNull();
  });
});

describe('nightly tier update', () => {
  it('moves a partner up as soon as they cross a threshold, and records it', async () => {
    const t = convexTest(schema, modules);
    const { profileId, userId } = await partnerWithSales(t, 'base', 5_200_000);
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('top');
    const change = await t.run((ctx) => ctx.db.query('holmTierChanges').withIndex('by_partner', (q) => q.eq('partnerId', userId)).first());
    expect(change).toMatchObject({ from: 'base', tier: 'top' });
  });

  it('counts sales after refunds, and not sales older than 12 months', async () => {
    const t = convexTest(schema, modules);
    const { profileId } = await partnerWithSales(t, 'base', 3_000_000, 400);
    await t.run(async (ctx) => {
      const userId = (await ctx.db.get(profileId))!.userId;
      // a $20,000 order, half refunded: $10,000 counts
      await ctx.db.insert('holmCommissions', { partnerId: userId, source: 'storefront_order', baseCents: 2_000_000, rateBps: 1000, amountCents: 100_000, originalCents: 200_000, reversedCents: 100_000, status: 'pending', clearsAt: 0, createdAt: Date.now() });
    });
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('base');
  });

  it('moves down at most one tier, once a quarter', async () => {
    vi.setSystemTime(new Date('2026-11-04T07:17:00Z'));
    const t = convexTest(schema, modules);
    const { profileId } = await partnerWithSales(t, 'elite', 0, 0, { tierDownCheckedAt: Date.parse('2026-10-01T07:17:00Z') });
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('elite'); // already checked this quarter
    vi.setSystemTime(new Date('2027-01-01T07:17:00Z'));
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('top');
    vi.setSystemTime(new Date('2027-01-02T07:17:00Z'));
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('top'); // next step down waits for the next quarter
  });

  it('leaves a tier the team set by hand alone until its end date', async () => {
    const t = convexTest(schema, modules);
    const until = Date.now() + 5 * DAY;
    const { profileId } = await partnerWithSales(t, 'top', 0, 0, { tierOverride: { reason: 'Launch designer', until, by: 'team@louiemae.com', at: 0 } });
    await runTier(t, profileId);
    expect(await tierOf(t, profileId)).toBe('top');
    await t.run((ctx) => ctx.db.patch(profileId, { tierOverride: { reason: 'Launch designer', until: Date.now() - 1, by: 'team@louiemae.com', at: 0 } }));
    await runTier(t, profileId);
    const p = await t.run((ctx) => ctx.db.get(profileId));
    expect(p!.tierOverride).toBeUndefined();
    expect(p!.partnerTier).toBe('active'); // one step down, the hold has ended
  });
});

describe('nightly run', () => {
  it('works through every partner in small jobs and saves their 12-month sales', async () => {
    const t = convexTest(schema, modules);
    const a = await partnerWithSales(t, 'base', 1_000_000);
    const b = await partnerWithSales(t, 'base', 400_000);
    await t.mutation(internal.holmPartners.updateTiers, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [pa, pb] = await t.run(async (ctx) => [await ctx.db.get(a.profileId), await ctx.db.get(b.profileId)]);
    expect(pa!.sales12Cents).toBe(1_000_000);
    expect(pb!.sales12Cents).toBe(400_000);
    expect(pa!.partnerTier).toBe('base');
  });
});

// Tier computation v2 (spec S28, v2 §15). Recomputed on qualifying paid, refund and dispute
// events and once a day at the configured America/Chicago time (DST-safe). A lock serializes
// concurrent recomputes; the purchase that crosses a threshold keeps the pre-purchase tier;
// later refunds or window expiry change only future rates.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { requireUser } from './holmAccess';
import { acquireLock, audit, releaseLock } from './sysCore';
import { activeConfig, maybeConfig } from './sysConfig';
import { beneficiaryOf } from './prgCore';
import { inLocalWindow, nextTier, quarterOf, tierFor, tierProgress, tierWindow } from '../lib/tiers';
import type { CommissionSchedule, TierPolicy } from '../lib/config';
import { CommerceError } from '../lib/errors';

/** Qualifying eligible merchandise in the window: paid retail referrals, net of refunds, excluding void and held. */
export async function qualifyingMinor(ctx: MutationCtx, beneficiaryId: Id<'prgBeneficiaries'>, start: number, end: number) {
  const rows = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', beneficiaryId)).take(10_000);
  let total = 0;
  for (const o of rows) {
    if (o.source === 'adjustment' || o.source === 'offset' || o.state === 'void' || o.state === 'held') continue;
    const at = o.paidAt ?? o.createdAt;
    if (at < start || at > end) continue; // up to and including the computation instant
    total += Math.max(0, o.basisMinor - o.refundedBasisMinor);
  }
  return total;
}

export async function recompute(ctx: MutationCtx, beneficiaryId: Id<'prgBeneficiaries'>, reason: 'daily' | 'event', watermark: string, now = Date.now(), localDate?: string) {
  const policy = await maybeConfig<TierPolicy>(ctx, 'tierPolicy', 'tier-policy');
  if (!policy) return null; // D-06/D-07 pending: the legacy nightly job stays in charge
  const sched = (await activeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule')).value;
  const lock = `tier:${beneficiaryId}`;
  if (!(await acquireLock(ctx, lock, watermark, 60_000, now))) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Tier recompute in progress');
  try {
    const b = await ctx.db.get(beneficiaryId);
    if (!b) return null;
    const { start, end } = tierWindow(now, policy.value);
    const q = await qualifyingMinor(ctx, beneficiaryId, start, end);
    const earned = tierFor(q, sched);
    const last = await ctx.db.query('prgTierSnapshots').withIndex('by_beneficiary_computed', (x) => x.eq('beneficiaryId', beneficiaryId)).order('desc').first();
    // A downgrade is considered once per calendar quarter (on the first recompute of the quarter).
    const quarterChanged = !last || quarterOf(last.computedAt) !== quarterOf(now);
    const tier = nextTier(b.tierKey, earned, policy.value.downgrade, quarterChanged);
    const id = await ctx.db.insert('prgTierSnapshots', { beneficiaryId, tierKey: tier, previousTierKey: b.tierKey, qualifyingMinor: q, windowStart: start, windowEnd: end, watermark, ...(localDate ? { localDate } : {}), computedAt: now, reason });
    if (tier !== b.tierKey) {
      await ctx.db.patch(b._id, { tierKey: tier, tierSnapshotId: id, updatedAt: now });
      // Keep the legacy profile (Hub, emails) in step.
      if (b.legacyUserId) {
        const p = await ctx.db.query('holmProfiles').withIndex('by_user', (x) => x.eq('userId', b.legacyUserId!)).unique();
        if (p) await ctx.db.patch(p._id, { partnerTier: tier, sales12Cents: q });
        await ctx.db.insert('holmTierChanges', { partnerId: b.legacyUserId, tier, from: b.tierKey, at: now, reason: `v2 ${reason}: $${Math.round(q / 100).toLocaleString('en-US')} qualifying` });
      }
    } else await ctx.db.patch(b._id, { tierSnapshotId: id });
    return { tier, qualifyingMinor: q };
  } finally {
    await releaseLock(ctx, lock, watermark);
  }
}

/** Event-triggered recompute (paid, refund, dispute). Runs after the event's transaction commits. */
export const onEvent = internalMutation({
  args: { beneficiaryId: v.id('prgBeneficiaries'), watermark: v.string() },
  handler: (ctx, a) => recompute(ctx, a.beneficiaryId, 'event', a.watermark),
});

/** Hourly: once per local day at the policy time (00:15 America/Chicago), recompute everyone in pages. */
export const dailyTick = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = a.now ?? Date.now();
    const policy = await maybeConfig<TierPolicy>(ctx, 'tierPolicy', 'tier-policy');
    if (!policy) return { skipped: 'policy not approved' };
    const localDate = inLocalWindow(now, policy.value.tz, policy.value.dailyLocal);
    if (!localDate) return { skipped: 'outside window' };
    const done = await ctx.db.query('prgTierSnapshots').withIndex('by_reason_date', (q) => q.eq('reason', 'daily').eq('localDate', localDate)).first();
    const started = await ctx.db.query('sysLocks').withIndex('by_name', (q) => q.eq('name', `tier-daily:${localDate}`)).first();
    if (done || started) return { skipped: 'already ran' };
    await ctx.db.insert('sysLocks', { name: `tier-daily:${localDate}`, holder: 'cron', expiresAt: now + 86_400_000 });
    await ctx.scheduler.runAfter(0, internal.prgTiers.dailyPage, { cursor: null, now, localDate });
    return { started: localDate };
  },
});

export const dailyPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.number(), localDate: v.string() },
  handler: async (ctx, a) => {
    const page = await ctx.db.query('prgBeneficiaries').withIndex('by_status', (q) => q.eq('status', 'active')).paginate({ cursor: a.cursor, numItems: 25 });
    for (const b of page.page) await recompute(ctx, b._id, 'daily', `daily:${a.localDate}`, a.now, a.localDate);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.prgTiers.dailyPage, { cursor: page.continueCursor, now: a.now, localDate: a.localDate });
  },
});

/** Admin override (e.g. start a known designer at Top) with a reason; recorded as a snapshot. */
export const override = mutation({
  args: { beneficiaryId: v.id('prgBeneficiaries'), tier: v.union(v.literal('base'), v.literal('active'), v.literal('top'), v.literal('elite')), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add a reason');
    const b = await ctx.db.get(a.beneficiaryId);
    if (!b) throw new CommerceError('INVALID_INPUT', 'Not found');
    const now = Date.now();
    const id = await ctx.db.insert('prgTierSnapshots', { beneficiaryId: b._id, tierKey: a.tier, previousTierKey: b.tierKey, qualifyingMinor: 0, windowStart: now, windowEnd: now, watermark: `override:${now}`, computedAt: now, reason: 'override' });
    await ctx.db.patch(b._id, { tierKey: a.tier, tierSnapshotId: id, updatedAt: now });
    await audit(ctx, { actor: admin.email, action: 'tier.override', entityTable: 'prgBeneficiaries', entityId: b._id, before: b.tierKey, after: a.tier, reason: a.reason });
  },
});

/** The partner's visible tier and next threshold. */
export const myTier = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const b = await beneficiaryOf(ctx, me.userId);
    if (!b) return null;
    const sched = await maybeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule');
    const snap = b.tierSnapshotId ? await ctx.db.get(b.tierSnapshotId) : null;
    const q = snap?.qualifyingMinor ?? 0;
    return { tier: b.tierKey, qualifyingMinor: q, ...(sched ? tierProgress(b.tierKey, q, sched.value) : { next: null, toNextMinor: 0 }) };
  },
});

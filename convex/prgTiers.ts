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
import { acquireLock, audit, openReview, releaseLock } from './sysCore';
import { activeConfig, maybeConfig } from './sysConfig';
import { beneficiaryOf } from './prgCore';
import { tierDateDue, nextTier, quarterOf, tierFor, tierProgress, tierWindow } from '../lib/tiers';
import type { CommissionSchedule, TierPolicy } from '../lib/config';
import { CommerceError, isCommerceError } from '../lib/errors';

/** Qualifying eligible merchandise in the window: paid retail referrals, net of refunds, excluding void and held. */
const HISTORY_LIMIT = 10000;
const LEASE_MS = 10 * 60_000;
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

export async function qualifyingMinor(ctx: MutationCtx, beneficiaryId: Id<'prgBeneficiaries'>, start: number, end: number) {
  if (![start, end].every(Number.isSafeInteger) || start > end) throw new CommerceError('INVALID_INPUT', 'Invalid tier window');
  // Query the payment window before bounding it. Imported records without paidAt use their recorded creation time.
  const paid = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_paid_created', q => q.eq('beneficiaryId', beneficiaryId).gte('paidAt', start).lte('paidAt', end)).take(HISTORY_LIMIT + 1);
  const historical = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_paid_created', q => q.eq('beneficiaryId', beneficiaryId).eq('paidAt', undefined).gte('createdAt', start).lte('createdAt', end)).take(HISTORY_LIMIT + 1);
  if (paid.length + historical.length > HISTORY_LIMIT) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Complete tier evidence exceeds the reviewed transaction limit');
  let total = 0;
  for (const o of [...paid, ...historical]) {
    if (o.source === 'adjustment' || o.source === 'offset' || o.state === 'void' || o.state === 'held') continue;
    if (!validMoney(o.basisMinor) || !validMoney(o.refundedBasisMinor) || o.refundedBasisMinor > o.basisMinor) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Invalid qualifying merchandise or refund evidence');
    total += o.basisMinor - o.refundedBasisMinor;
    if (!validMoney(total)) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Tier total exceeds safe money arithmetic');
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
    const last = await ctx.db.query('prgTierSnapshots').withIndex('by_beneficiary_computed', (x) => x.eq('beneficiaryId', beneficiaryId)).order('desc').first();
    if (last && (last.computedAt > now || last.watermark === watermark || (reason === 'daily' && last.computedAt === now))) {
      const pendingReview = await ctx.db.query('sysReviewItems').withIndex('by_entity', x => x.eq('entityTable', 'prgBeneficiaries').eq('entityId', b._id)).filter(x => x.and(x.eq(x.field('kind'), 'tier_evidence_review'), x.eq(x.field('status'), 'open'))).first();
      return { tier: b.tierKey, qualifyingMinor: last.qualifyingMinor, stale: true, reviewRequired: !!pendingReview };
    }
    const { start, end } = tierWindow(now, policy.value);
    let q: number;
    try { q = await qualifyingMinor(ctx, beneficiaryId, start, end); }
    catch (error) {
      if (!isCommerceError(error, 'PAYMENT_RECONCILIATION_REQUIRED')) throw error;
      await openReview(ctx, 'tier_evidence_review', 'prgBeneficiaries', b._id, 'Complete and valid qualifying sales evidence is required; the previous tier is retained.');
      return { tier: b.tierKey, qualifyingMinor: last?.qualifyingMinor ?? null, reviewRequired: true };
    }
    const review = await ctx.db.query('sysReviewItems').withIndex('by_entity', x => x.eq('entityTable', 'prgBeneficiaries').eq('entityId', b._id))
      .filter(x => x.and(x.eq(x.field('kind'), 'tier_evidence_review'), x.eq(x.field('status'), 'open'))).first();
    if (review) await ctx.db.patch(review._id, { status: 'resolved', resolution: 'Complete tier evidence reconciled', resolvedBy: 'system:tiers', resolvedAt: Date.now() });
    const earned = tierFor(q, sched);
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
    } else {
      await ctx.db.patch(b._id, { tierSnapshotId: id });
      if (b.legacyUserId) {
        const p = await ctx.db.query('holmProfiles').withIndex('by_user', x => x.eq('userId', b.legacyUserId!)).unique();
        if (p) await ctx.db.patch(p._id, { sales12Cents: q });
      }
    }
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

/** Hourly watchdog: resume an expired work lease before starting today's due run. */
export const dailyTick = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = a.now ?? Date.now();
    const policy = await maybeConfig<TierPolicy>(ctx, 'tierPolicy', 'tier-policy');
    if (!policy) return { skipped: 'policy not approved' };
    const schedule = await maybeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule');
    if (!schedule) return { skipped: 'schedule not approved' };
    const expired = await ctx.db.query('prgTierRuns').withIndex('by_status_lease', q => q.eq('status', 'running').lte('leaseUntil', Date.now())).first();
    if (expired) {
      const generation = expired.generation + 1;
      await ctx.db.patch(expired._id, { generation, leaseUntil: Date.now() + LEASE_MS, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.prgTiers.dailyPage, { runId: expired._id, generation, expectedCursor: expired.cursor });
      return { resumed: expired.localDate };
    }
    const localDate = tierDateDue(now, policy.value.tz, policy.value.dailyLocal);
    if (!localDate) return { skipped: 'before scheduled time' };
    const prior = await ctx.db.query('prgTierRuns').withIndex('by_date', q => q.eq('localDate', localDate)).unique();
    if (prior) return { skipped: prior.status === 'running' ? 'in progress' : 'finished', status: prior.status };
    const id = await ctx.db.insert('prgTierRuns', { localDate, tz: policy.value.tz, computedAt: now, policyId: policy.id, scheduleId: schedule.id,
      status: 'running', cursor: null, generation: 1, leaseUntil: Date.now() + LEASE_MS, processed: 0, reviewCount: 0, startedAt: Date.now(), updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.prgTiers.dailyPage, { runId: id, generation: 1, expectedCursor: null });
    return { started: localDate };
  },
});

/** One beneficiary per transaction; cursor and continuation commit together. */
export const dailyPage = internalMutation({
  args: {
    runId: v.optional(v.id('prgTierRuns')), generation: v.optional(v.number()), expectedCursor: v.optional(v.union(v.string(), v.null())),
    // A queued pre-upgrade continuation cannot establish completion. The watchdog restarts it safely.
    cursor: v.optional(v.union(v.string(), v.null())), now: v.optional(v.number()), localDate: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (!a.runId) return { skipped: 'legacy continuation' };
    const run = await ctx.db.get(a.runId);
    if (!run || run.status !== 'running' || run.generation !== a.generation || run.cursor !== a.expectedCursor) return { skipped: 'stale continuation' };
    const policy = await maybeConfig<TierPolicy>(ctx, 'tierPolicy', 'tier-policy');
    const schedule = await maybeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule');
    if (!policy || !schedule || policy.id !== run.policyId || schedule.id !== run.scheduleId) {
      await ctx.db.patch(run._id, { status: 'review', failureReason: 'Approved configuration changed during the run', completedAt: Date.now(), updatedAt: Date.now() });
      await openReview(ctx, 'tier_run_review', 'prgTierRuns', run._id, 'Tier configuration changed; this run is not complete.');
      return { reviewRequired: true };
    }
    const page = await ctx.db.query('prgBeneficiaries').withIndex('by_status_created', q => q.eq('status', 'active').lte('createdAt', run.computedAt)).paginate({ cursor: run.cursor, numItems: 1 });
    let reviewCount = run.reviewCount;
    for (const b of page.page) {
      const result = await recompute(ctx, b._id, 'daily', `daily:${run._id}:${run.generation}`, run.computedAt, run.localDate);
      if (result?.reviewRequired) reviewCount++;
    }
    await ctx.db.patch(run._id, { cursor: page.continueCursor, processed: run.processed + page.page.length, reviewCount,
      leaseUntil: Date.now() + LEASE_MS, updatedAt: Date.now(),
      ...(page.isDone ? { status: reviewCount ? 'review' as const : 'complete' as const, completedAt: Date.now() } : {}) });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.prgTiers.dailyPage, { runId: run._id, generation: run.generation, expectedCursor: page.continueCursor });
    return { complete: page.isDone && !reviewCount, reviewCount };
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
    const review = await ctx.db.query('sysReviewItems').withIndex('by_entity', x => x.eq('entityTable', 'prgBeneficiaries').eq('entityId', b._id)).filter(x => x.and(x.eq(x.field('kind'), 'tier_evidence_review'), x.eq(x.field('status'), 'open'))).first();
    return { reviewRequired: !!review, verifiedAt: snap?.computedAt ?? null, tier: b.tierKey, qualifyingMinor: q, ...(sched ? tierProgress(b.tierKey, q, sched.value) : { next: null, toNextMinor: 0 }) };
  },
});

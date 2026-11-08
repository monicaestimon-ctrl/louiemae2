// Payout runs v2 (spec S30, v2 §17, §28). A run reserves each cleared payable cent exactly once
// (the obligation state machine refuses a second reservation, so a concurrent monthly and manual
// run can never pay the same cents), creates one keyed transfer attempt per beneficiary, and
// records outcomes. Transfer success and bank arrival are separate states.
import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { applyCommissionEvent, payable } from './ldgCore';
import { activeConfig } from './sysConfig';
import { audit, bumpMetric, openReview } from './sysCore';
import { notify } from './sysNotify';
import { CommerceError } from '../lib/errors';
import { formatUsd } from '../lib/money';
import { zonedInstant } from '../lib/tiers';
import type { PayoutSchedule } from '../lib/config';

type Readiness = { requireStripeTransfersActive: boolean; requireW9ForManual: boolean; requireTaxApprovedForAutomatic: boolean };

/** Cutoff instant for a period: the configured day and time in the schedule's zone (DST-exact). */
export function cutoffFor(period: string, s: PayoutSchedule) {
  const [y, m] = period.split('-').map(Number);
  const [hh, mm, ss] = s.cutoffLocalTime.split(':').map(Number);
  return zonedInstant(s.tz, y, m, s.cutoffDay, hh, mm, ss ?? 0, 999);
}

function ready(b: Doc<'prgBeneficiaries'>, r: Readiness, method: 'stripe' | 'manual') {
  if (method === 'stripe') {
    if (r.requireStripeTransfersActive && (b.payoutReadiness !== 'ready' || !b.payoutAccountRef)) return 'payout account not ready';
    if (r.requireTaxApprovedForAutomatic && b.taxReadiness !== 'approved') return 'tax details not approved';
  } else if (r.requireW9ForManual && b.taxReadiness !== 'approved') return 'tax details not approved';
  return null;
}

/** Creates the run for a period once (duplicate calls return the existing run). */
export const openRun = internalMutation({
  args: { period: v.string(), kind: v.union(v.literal('monthly'), v.literal('manual')), by: v.string() },
  handler: async (ctx, a) => {
    const schedule = (await activeConfig<PayoutSchedule>(ctx, 'payoutSchedule', 'payout-schedule')).value;
    await activeConfig<Readiness>(ctx, 'payoutReadinessPolicy', 'payout-readiness');
    const existing = await ctx.db.query('ldgPayoutRuns').withIndex('by_period_kind', (q) => q.eq('period', a.period).eq('kind', a.kind)).first();
    if (existing) return { runId: existing._id, existing: true };
    const runId = await ctx.db.insert('ldgPayoutRuns', {
      period: a.period,
      kind: a.kind,
      cutoffAt: a.kind === 'monthly' ? cutoffFor(a.period, schedule) : Date.now(),
      startedAt: Date.now(),
      status: 'planning',
      lockName: `payoutRun:${a.period}:${a.kind}`,
      totals: { eligibleMinor: 0, reservedMinor: 0, submittedMinor: 0, transferredMinor: 0, failedMinor: 0, carriedMinor: 0 },
      createdBy: a.by,
    });
    return { runId, existing: false };
  },
});

/**
 * Plans one page of beneficiaries: cleared obligations (and offsets) cleared by the cutoff are
 * reserved for this run when the total meets the minimum and the beneficiary is ready; smaller or
 * not-ready balances carry forward.
 */
export const planPage = internalMutation({
  args: { runId: v.id('ldgPayoutRuns'), cursor: v.union(v.string(), v.null()), beneficiaryId: v.optional(v.id('prgBeneficiaries')), method: v.optional(v.union(v.literal('stripe'), v.literal('manual'))) },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run || (run.status !== 'planning' && run.status !== 'reserving')) return { isDone: true, continueCursor: null };
    const schedule = (await activeConfig<PayoutSchedule>(ctx, 'payoutSchedule', 'payout-schedule')).value;
    const readiness = (await activeConfig<Readiness>(ctx, 'payoutReadinessPolicy', 'payout-readiness')).value;
    const method = a.method ?? 'stripe';
    const page = a.beneficiaryId
      ? { page: [(await ctx.db.get(a.beneficiaryId))!].filter(Boolean), isDone: true, continueCursor: null as string | null }
      : await ctx.db.query('prgBeneficiaries').withIndex('by_status', (q) => q.eq('status', 'active')).paginate({ cursor: a.cursor, numItems: 25 });
    const totals = { ...run.totals };
    for (const b of page.page) {
      const rows = (await ctx.db.query('ldgObligations').withIndex('by_beneficiary_state', (q) => q.eq('beneficiaryId', b._id).eq('state', 'cleared')).collect()).filter((o) => (o.clearedAt ?? o.clearsAt) <= run.cutoffAt);
      const amount = rows.reduce((t, o) => t + payable(o), 0);
      if (amount <= 0) continue;
      totals.eligibleMinor += amount;
      const notReady = ready(b, readiness, method);
      if ((method === 'stripe' && amount < schedule.minimumMinor) || notReady) {
        totals.carriedMinor += amount;
        continue;
      }
      for (const o of rows) await applyCommissionEvent(ctx, { eventKey: `reserve:${run._id}:${o._id}`, obligationId: o._id, type: 'reserved', amountMinor: 0, actor: `payout:${run.period}`, patch: { payoutRunId: run._id } });
      const key = `transfer:${run._id}:${b._id}`;
      const attemptId = await ctx.db.insert('ldgTransferAttempts', { payoutRunId: run._id, beneficiaryId: b._id, amountMinor: amount, obligationIds: rows.map((o) => o._id), idempotencyKey: key, destination: b.payoutAccountRef ?? 'manual', method, state: 'created', createdAt: Date.now() });
      for (const o of rows) await ctx.db.patch(o._id, { transferAttemptId: attemptId });
      totals.reservedMinor += amount;
    }
    await ctx.db.patch(run._id, { totals, status: page.isDone ? 'reserving' : 'planning' });
    return { isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Records the platform balance check; aborting releases every reservation of the run. */
export const recordFunding = internalMutation({
  args: { runId: v.id('ldgPayoutRuns'), availableMinor: v.number() },
  handler: async (ctx, a) => {
    const run = (await ctx.db.get(a.runId))!;
    const ok = a.availableMinor >= run.totals.reservedMinor;
    await ctx.db.patch(run._id, { fundingCheck: { availableMinor: a.availableMinor, at: Date.now(), ok }, ...(ok ? { status: 'submitting' as const } : {}) });
    if (!ok) await abort(ctx, run, `Platform balance ${a.availableMinor} below due ${run.totals.reservedMinor}`);
    return ok;
  },
});

async function abort(ctx: MutationCtx, run: Doc<'ldgPayoutRuns'>, reason: string) {
  for (const t of await ctx.db.query('ldgTransferAttempts').withIndex('by_run', (q) => q.eq('payoutRunId', run._id)).collect()) {
    if (t.state !== 'created') continue;
    for (const id of t.obligationIds) await applyCommissionEvent(ctx, { eventKey: `release:${t._id}:${id}`, obligationId: id, type: 'reservation_released', amountMinor: 0, actor: 'payout:abort', reason });
    await ctx.db.patch(t._id, { state: 'failed', error: reason, resolvedAt: Date.now() });
  }
  await ctx.db.patch(run._id, { status: 'aborted', abortReason: reason });
  await openReview(ctx, 'payout_aborted', 'ldgPayoutRuns', run._id, reason);
  await bumpMetric(ctx, 'payout.aborted');
}

export const attemptsToSubmit = internalQuery({
  args: { runId: v.id('ldgPayoutRuns') },
  handler: async (ctx, a) => (await ctx.db.query('ldgTransferAttempts').withIndex('by_run', (q) => q.eq('payoutRunId', a.runId)).collect()).filter((t) => t.state === 'created' && t.method === 'stripe'),
});

/** Marks an attempt submitted before the provider call (so a crash leaves it reconcilable, never re-sent blindly). */
export const markSubmitted = internalMutation({
  args: { attemptId: v.id('ldgTransferAttempts') },
  handler: async (ctx, a) => {
    const t = await ctx.db.get(a.attemptId);
    if (!t || t.state !== 'created') return false;
    for (const id of t.obligationIds) await applyCommissionEvent(ctx, { eventKey: `submit:${t._id}:${id}`, obligationId: id, type: 'transfer_submitted', amountMinor: 0, actor: 'payout' });
    await ctx.db.patch(t._id, { state: 'submitted', submittedAt: Date.now() });
    return true;
  },
});

/** Outcome of a transfer call. "uncertain" keeps the obligations submitted until reconciled. */
export const recordResult = internalMutation({
  args: { attemptId: v.id('ldgTransferAttempts'), outcome: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('uncertain')), transferId: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const t = await ctx.db.get(a.attemptId);
    if (!t || (t.state !== 'submitted' && t.state !== 'uncertain')) return;
    const run = (await ctx.db.get(t.payoutRunId))!;
    const totals = { ...run.totals };
    if (a.outcome === 'succeeded') {
      for (const id of t.obligationIds) await applyCommissionEvent(ctx, { eventKey: `transferred:${t._id}:${id}`, obligationId: id, type: 'transferred', amountMinor: 0, actor: 'payout', ...(a.transferId ? { providerRef: a.transferId } : {}) });
      await ctx.db.patch(t._id, { state: 'succeeded', ...(a.transferId ? { stripeTransferId: a.transferId } : {}), resolvedAt: Date.now() });
      totals.transferredMinor += t.amountMinor;
      const b = await ctx.db.get(t.beneficiaryId);
      const user = b?.userId ? await ctx.db.get(b.userId) : null;
      if (typeof user?.email === 'string')
        await notify(ctx, { dedupeKey: `payout:${t._id}`, audience: 'partner', template: 'payout_sent', to: user.email, subject: 'Your Louie Mae commission was sent', text: `We sent ${formatUsd(t.amountMinor)} to your connected Stripe account. Stripe then pays it to your bank on its own schedule; weekends and bank holidays can add time, so it may not arrive the same day.` });
    } else if (a.outcome === 'failed') {
      for (const id of t.obligationIds) await applyCommissionEvent(ctx, { eventKey: `failed:${t._id}:${id}`, obligationId: id, type: 'transfer_failed', amountMinor: 0, actor: 'payout', reason: a.error });
      await ctx.db.patch(t._id, { state: 'failed', error: (a.error ?? '').slice(0, 300), resolvedAt: Date.now() });
      totals.failedMinor += t.amountMinor;
      await openReview(ctx, 'payout_failed', 'ldgTransferAttempts', t._id, a.error ?? 'Transfer failed');
    } else {
      await ctx.db.patch(t._id, { state: 'uncertain', error: (a.error ?? 'outcome unknown').slice(0, 300) });
      await openReview(ctx, 'payout_uncertain', 'ldgTransferAttempts', t._id, 'Transfer outcome unknown; reconcile before any retry');
    }
    totals.submittedMinor = (await ctx.db.query('ldgTransferAttempts').withIndex('by_run', (q) => q.eq('payoutRunId', run._id)).collect()).filter((x) => x.state !== 'created').reduce((s, x) => s + x.amountMinor, 0);
    await ctx.db.patch(run._id, { totals });
  },
});

export const uncertainAttempts = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query('ldgTransferAttempts').withIndex('by_state', (q) => q.eq('state', 'uncertain')).take(50),
});

export const finishRun = internalMutation({
  args: { runId: v.id('ldgPayoutRuns') },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run || run.status === 'aborted' || run.status === 'done') return;
    const attempts = await ctx.db.query('ldgTransferAttempts').withIndex('by_run', (q) => q.eq('payoutRunId', run._id)).collect();
    await ctx.db.patch(run._id, { status: attempts.some((t) => t.state === 'uncertain' || t.state === 'submitted') ? 'reconciling' : 'done' });
  },
});

/** Manual payout (paid outside the site): same reservation and readiness rules, recorded with a reference. */
export const recordManualPayout = mutation({
  args: { beneficiaryId: v.id('prgBeneficiaries'), reference: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reference.trim()) throw new CommerceError('INVALID_INPUT', 'Add the payment reference');
    const readiness = (await activeConfig<Readiness>(ctx, 'payoutReadinessPolicy', 'payout-readiness')).value;
    const b = await ctx.db.get(a.beneficiaryId);
    if (!b) throw new CommerceError('INVALID_INPUT', 'Not found');
    const why = ready(b, readiness, 'manual');
    if (why) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', why, `Not ready to pay: ${why}.`);
    const now = Date.now();
    const runId = await ctx.db.insert('ldgPayoutRuns', { period: `manual-${now}`, kind: 'manual', cutoffAt: now, startedAt: now, status: 'submitting', lockName: `manual:${b._id}:${now}`, totals: { eligibleMinor: 0, reservedMinor: 0, submittedMinor: 0, transferredMinor: 0, failedMinor: 0, carriedMinor: 0 }, createdBy: admin.email });
    const rows = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_state', (q) => q.eq('beneficiaryId', b._id).eq('state', 'cleared')).collect();
    const amount = rows.reduce((t, o) => t + payable(o), 0);
    if (amount <= 0) throw new CommerceError('INVALID_INPUT', 'Nothing has cleared for this partner');
    for (const o of rows) await applyCommissionEvent(ctx, { eventKey: `reserve:${runId}:${o._id}`, obligationId: o._id, type: 'reserved', amountMinor: 0, actor: admin.email, patch: { payoutRunId: runId } });
    const attemptId = await ctx.db.insert('ldgTransferAttempts', { payoutRunId: runId, beneficiaryId: b._id, amountMinor: amount, obligationIds: rows.map((o) => o._id), idempotencyKey: `manual:${runId}`, destination: 'manual', method: 'manual', externalReference: a.reference.trim(), state: 'succeeded', submittedAt: now, resolvedAt: now, createdAt: now });
    for (const o of rows) await applyCommissionEvent(ctx, { eventKey: `transferred:${attemptId}:${o._id}`, obligationId: o._id, type: 'transferred', amountMinor: 0, actor: admin.email, providerRef: a.reference.trim(), patch: { transferAttemptId: attemptId } });
    await ctx.db.patch(runId, { status: 'done', totals: { eligibleMinor: amount, reservedMinor: amount, submittedMinor: amount, transferredMinor: amount, failedMinor: 0, carriedMinor: 0 } });
    await audit(ctx, { actor: admin.email, action: 'payout.manual', entityTable: 'prgBeneficiaries', entityId: b._id, after: { amount, reference: a.reference } });
    return { amountMinor: amount };
  },
});

/** Connected-account payout events: bank arrival is observed separately from the transfer. */
export const observeBankPayout = internalMutation({
  args: { accountId: v.string(), stripePayoutId: v.string(), amountMinor: v.number(), status: v.union(v.literal('pending'), v.literal('in_transit'), v.literal('paid'), v.literal('failed'), v.literal('canceled')), arrivalDate: v.optional(v.number()), failureCode: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query('ldgBankPayouts').withIndex('by_payout', (q) => q.eq('stripePayoutId', a.stripePayoutId)).first();
    const row = { ...a, observedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert('ldgBankPayouts', row);
    if (a.status === 'failed') {
      await openReview(ctx, 'bank_payout_failed', 'ldgBankPayouts', a.stripePayoutId, `Connected account ${a.accountId}: ${a.failureCode ?? 'failed'}`);
      await bumpMetric(ctx, 'payout.bank_failed');
    }
  },
});

/** A transfer was reversed (money back on the platform): its obligations become payable again. */
export const onTransferReversed = internalMutation({
  args: { transferId: v.string() },
  handler: async (ctx, a) => {
    const t = await ctx.db.query('ldgTransferAttempts').withIndex('by_transfer', (q) => q.eq('stripeTransferId', a.transferId)).first();
    if (!t || t.state === 'reversed') return;
    for (const id of t.obligationIds) {
      const o = await ctx.db.get(id);
      if (o?.state === 'transferred') await applyCommissionEvent(ctx, { eventKey: `reversed:${t._id}:${id}`, obligationId: id, type: 'transfer_reversed', amountMinor: 0, actor: 'stripe' });
    }
    await ctx.db.patch(t._id, { state: 'reversed', resolvedAt: Date.now() });
    await openReview(ctx, 'transfer_reversed', 'ldgTransferAttempts', t._id, `Stripe transfer ${a.transferId} reversed`);
  },
});

export const adminRuns = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const runs = await ctx.db.query('ldgPayoutRuns').order('desc').take(24);
    const bank = await ctx.db.query('ldgBankPayouts').order('desc').take(50);
    return { runs, bank };
  },
});

export type AttemptId = Id<'ldgTransferAttempts'>;

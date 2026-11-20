// v2 backfills (spec S05, S06, v2 §22). Each runs one page per call, is dry-run by default and is
// idempotent by legacy id, so it can be re-run safely. Nothing here rewrites a legacy row or
// recomputes an earned amount: legacy balances are carried over exactly as they stand.
//
// Run order (dev first, then production after review):
//   npx convex run v2Migrations:identityBackfill '{"dryRun":true}'   (repeat with cursor until isDone)
//   npx convex run v2Migrations:identityBackfill '{"dryRun":false}'
//   npx convex run v2Migrations:ledgerSnapshot '{"dryRun":true}'  then  '{"dryRun":false}'
//   npx convex run v2Migrations:creditSnapshot '{"dryRun":true}'  then  '{"dryRun":false}'
//   npx convex run v2Migrations:ledgerParity '{}'
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { applyCommissionEvent, applyCreditEvent } from './ldgCore';
import { openReview } from './sysCore';
import { ensureBeneficiary } from './prgCore';
import { payoutRoute } from '../lib/flags';

const PAGE = 50;
const page = { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()) };
type Counts = Record<string, number>;
const bump = (c: Counts, k: string, n = 1) => {
  c[k] = (c[k] ?? 0) + n;
};

const TRADE_STATE: Record<Doc<'holmProfiles'>['tradeStatus'], string | null> = {
  none: null,
  pending: 'review',
  approved: 'approved',
  rejected: 'rejected',
  needs_info: 'needs_info',
};

async function beneficiaryFor(ctx: MutationCtx, userId: Id<'users'>) {
  return ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', (q) => q.eq('legacyUserId', userId)).first();
}

/** S05: beneficiaries, memberships and organizations from holmProfiles. */
export const identityBackfill = internalMutation({
  args: page,
  handler: async (ctx, a) => {
    const dryRun = a.dryRun !== false;
    const res = await ctx.db.query('holmProfiles').paginate({ cursor: a.cursor ?? null, numItems: PAGE });
    const counts: Counts = {};
    const ambiguous: string[] = [];
    const now = Date.now();
    for (const p of res.page) {
      bump(counts, 'profiles');
      let beneficiaryId: Id<'prgBeneficiaries'> | undefined;
      if (p.partnerStatus === 'active') {
        const existing = await beneficiaryFor(ctx, p.userId);
        if (existing) {
          bump(counts, 'beneficiary_exists');
          beneficiaryId = existing._id;
        } else {
          bump(counts, 'beneficiary_create');
          if (!dryRun)
            beneficiaryId = await ctx.db.insert('prgBeneficiaries', {
              kind: 'person',
              userId: p.userId,
              legacyUserId: p.userId,
              displayName: p.displayName,
              ...(p.stripeAccountId ? { payoutAccountRef: p.stripeAccountId } : {}),
              payoutReadiness: p.payoutsReady ? 'ready' : p.stripeAccountId ? 'pending' : 'not_started',
              taxReadiness: p.w9Status === 'approved' ? 'approved' : p.w9Status === 'pending' ? 'pending' : 'none',
              tierKey: p.partnerTier ?? 'base',
              ...(p.refCode ? { refCode: p.refCode } : {}),
              status: 'active',
              createdAt: now,
              updatedAt: now,
            });
        }
        const creator = await ctx.db.query('prgMemberships').withIndex('by_user_program', (q) => q.eq('userId', p.userId).eq('program', 'creator')).first();
        if (creator) bump(counts, 'creator_exists');
        else {
          bump(counts, 'creator_create');
          if (!dryRun)
            await ctx.db.insert('prgMemberships', {
              program: 'creator',
              userId: p.userId,
              ...(beneficiaryId ? { beneficiaryId } : {}),
              state: 'active',
              legacyTerms: true,
              createdAt: p.createdAt,
              updatedAt: now,
            });
        }
      }
      const tradeState = TRADE_STATE[p.tradeStatus];
      if (tradeState) {
        const trade = await ctx.db.query('prgMemberships').withIndex('by_user_program', (q) => q.eq('userId', p.userId).eq('program', 'trade')).first();
        if (trade) {
          bump(counts, 'trade_exists');
          continue;
        }
        bump(counts, 'trade_create');
        let organizationId: Id<'prgOrganizations'> | undefined;
        if (tradeState === 'approved') {
          const name = (p.businessName || '').trim();
          if (!name) {
            ambiguous.push(`${p.userId}: approved trade account without a business name`);
            bump(counts, 'org_ambiguous');
            if (!dryRun) await openReview(ctx, 'migration_ambiguous', 'holmProfiles', p._id, 'Approved trade account without a business name; organization not created.');
          } else {
            const org = await ctx.db.query('prgOrganizations').withIndex('by_legacy_owner', (q) => q.eq('legacyOwnerUserId', p.userId)).first();
            if (org) organizationId = org._id;
            else {
              bump(counts, 'org_create');
              if (!dryRun) {
                // One organization per approved owner. Similar names are never merged.
                organizationId = await ctx.db.insert('prgOrganizations', { legalName: name, displayName: name, verification: 'verified', verifiedAt: p.updatedAt, legacyOwnerUserId: p.userId, createdAt: now });
                await ctx.db.insert('prgOrganizationMembers', { organizationId, userId: p.userId, role: 'owner', status: 'active', createdAt: now });
              }
            }
          }
        }
        if (!dryRun)
          await ctx.db.insert('prgMemberships', {
            program: 'trade',
            userId: p.userId,
            ...(organizationId ? { organizationId } : {}),
            ...(beneficiaryId ? { beneficiaryId } : {}),
            state: tradeState,
            // A partner who is also approved trade already earns on retail links.
            referralActivated: p.partnerStatus === 'active' && tradeState === 'approved',
            legacyTerms: true,
            createdAt: p.createdAt,
            updatedAt: now,
          });
      }
    }
    return { dryRun, counts, ambiguous, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

const STATE_MAP: Record<Doc<'holmCommissions'>['status'], Doc<'ldgObligations'>['state']> = {
  pending: 'pending',
  cleared: 'cleared',
  paid: 'transferred',
  void: 'void',
};

/** S06: one obligation and one opening event per legacy commission, at its current amount. */
export const ledgerSnapshot = internalMutation({
  args: page,
  handler: async (ctx, a) => {
    const dryRun = a.dryRun !== false;
    const res = await ctx.db.query('holmCommissions').paginate({ cursor: a.cursor ?? null, numItems: PAGE });
    const counts: Counts = {};
    const missing: string[] = [];
    for (const c of res.page) {
      bump(counts, 'commissions');
      if (await ctx.db.query('ldgObligations').withIndex('by_legacy', (q) => q.eq('legacyCommissionId', c._id)).first()) {
        bump(counts, 'exists');
        continue;
      }
      const b = await beneficiaryFor(ctx, c.partnerId);
      if (!b) {
        missing.push(`${c._id}: no beneficiary for partner ${c.partnerId} (run identityBackfill first)`);
        bump(counts, 'missing_beneficiary');
        continue;
      }
      bump(counts, `create_${c.status}`);
      if (dryRun) continue;
      const adjustment = c.source === 'adjustment';
      await applyCommissionEvent(ctx, {
        eventKey: `opening:commission:${c._id}`,
        type: adjustment ? 'manual_adjustment' : 'opening_balance',
        amountMinor: c.amountCents,
        actor: 'migration:v2Ledger',
        reason: c.note ?? 'Opening balance from holmCommissions',
        ...(c.payoutId ? { providerRef: String(c.payoutId) } : {}),
        at: c.createdAt,
        create: {
          beneficiaryId: b._id,
          source: adjustment ? 'adjustment' : c.source === 'storefront_order' ? 'legacy_storefront' : 'legacy_house_quote',
          legacyCommissionId: c._id,
          rateBps: c.rateBps,
          basisMinor: c.baseCents,
          state: STATE_MAP[c.status],
          clearsAt: c.clearsAt,
          ...(c.status === 'cleared' || c.status === 'paid' ? { clearedAt: c.clearsAt } : {}),
        },
      });
    }
    return { dryRun, counts, missing, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

/** S06: opening credit balances (available and held) per member from the holmCredits ledger. */
export const creditSnapshot = internalMutation({
  args: page,
  handler: async (ctx, a) => {
    const dryRun = a.dryRun !== false;
    const res = await ctx.db.query('holmProfiles').paginate({ cursor: a.cursor ?? null, numItems: PAGE });
    const counts: Counts = {};
    for (const p of res.page) {
      const rows = await ctx.db.query('holmCredits').withIndex('by_user', (q) => q.eq('userId', p.userId)).take(2000);
      if (!rows.length) continue;
      const balance = Math.max(0, rows.reduce((t, r) => t + r.amountCents, 0));
      const holds = rows.filter((r) => r.kind === 'reserved');
      const held = holds.reduce((t, r) => t + (r.heldCents ?? -r.amountCents), 0);
      bump(counts, 'accounts');
      bump(counts, 'available_minor', balance);
      bump(counts, 'held_minor', held);
      if (dryRun) continue;
      await applyCreditEvent(ctx, { eventKey: `opening:credit:${p.userId}`, userId: p.userId, type: 'opening_balance', amountMinor: balance + held, actor: 'migration:v2Ledger', reason: 'Opening balance from holmCredits' });
      for (const h of holds) {
        const amount = h.heldCents ?? -h.amountCents;
        if (amount > 0) await applyCreditEvent(ctx, { eventKey: `opening:credit-hold:${h._id}`, userId: p.userId, type: 'reserved', amountMinor: amount, ...(h.ref ? { ref: h.ref } : {}), actor: 'migration:v2Ledger', reason: 'Hold carried over from holmCredits' });
      }
    }
    return { dryRun, counts, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

/** Parity (MIG-LEDGER-01): legacy commission and credit totals against the v2 projections, per partner page. */
export const ledgerParity = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const res = await ctx.db.query('prgBeneficiaries').paginate({ cursor: a.cursor ?? null, numItems: 25 });
    const mismatches: string[] = [];
    for (const b of res.page) {
      if (!b.legacyUserId) continue;
      const legacy = await ctx.db.query('holmCommissions').withIndex('by_partner', (q) => q.eq('partnerId', b.legacyUserId!)).take(5000);
      const obligations = await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', b._id)).take(5000);
      const migrated = obligations.filter((o) => o.legacyCommissionId);
      const legacySum = legacy.filter((c) => c.status !== 'void').reduce((t, c) => t + c.amountCents, 0);
      const v2Sum = migrated.filter((o) => o.state !== 'void').reduce((t, o) => t + o.earnedMinor - o.reversedMinor, 0);
      if (legacySum !== v2Sum || legacy.length !== migrated.length) mismatches.push(`${b._id}: legacy ${legacySum} (${legacy.length}) vs v2 ${v2Sum} (${migrated.length})`);
      const credits = await ctx.db.query('holmCredits').withIndex('by_user', (q) => q.eq('userId', b.legacyUserId!)).take(2000);
      const account = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', b.legacyUserId!)).first();
      if (credits.length && account) {
        const legacyBalance = Math.max(0, credits.reduce((t, r) => t + r.amountCents, 0));
        if (legacyBalance !== account.availableMinor) mismatches.push(`${b._id}: credit legacy ${legacyBalance} vs v2 available ${account.availableMinor}`);
      }
    }
    return { mismatches, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

type PageResult = { counts: Counts; continueCursor: string; isDone: boolean; ambiguous?: string[]; missing?: string[] };

/**
 * Runs every backfill to completion, page by page, and returns the combined counts. With
 * `commit: false` (the default) nothing is written, so CI can print a production dry run after
 * each deploy. Commit only after the dry run has been reviewed.
 */
export const runBackfills = internalAction({
  args: { commit: v.optional(v.boolean()), only: v.optional(v.array(v.union(v.literal('identity'), v.literal('ledger'), v.literal('credit')))) },
  handler: async (ctx, a): Promise<{ dryRun: boolean; steps: Record<string, { counts: Counts; notes: string[] }> }> => {
    const dryRun = a.commit !== true;
    const out: Record<string, { counts: Counts; notes: string[] }> = {};
    const steps = [
      ['identity', internal.v2Migrations.identityBackfill],
      ['ledger', internal.v2Migrations.ledgerSnapshot],
      ['credit', internal.v2Migrations.creditSnapshot],
    ] as const;
    for (const [name, fn] of steps) {
      if (a.only && !a.only.includes(name)) continue;
      const total: Counts = {};
      const notes: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10_000; i++) {
        const r: PageResult = await ctx.runMutation(fn, { cursor, dryRun });
        for (const [k, n] of Object.entries(r.counts)) bump(total, k, n);
        notes.push(...(r.ambiguous ?? []), ...(r.missing ?? []));
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      out[name] = { counts: total, notes: notes.slice(0, 50) };
    }
    console.log(`v2 backfills (${dryRun ? 'dry run' : 'commit'}):`, JSON.stringify(out));
    return { dryRun, steps: out };
  },
});

/**
 * Keeps the v2 ledger in step with legacy commissions once v2 payouts are the active route
 * (cutover): new legacy rows are mirrored at their current amount, and later legacy changes
 * (refund reductions, voids, won disputes) become v2 reversals, offsets or adjustments. Amounts
 * are never recomputed. A no-op while the legacy payout route is in charge.
 */
export const syncLegacyLedgerPage = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    if (payoutRoute() !== 'v2') return { skipped: 'legacy payout route active' };
    const res = await ctx.db.query('holmCommissions').paginate({ cursor: a.cursor ?? null, numItems: 100 });
    let mirrored = 0;
    let adjusted = 0;
    for (const c of res.page) {
      const o = await ctx.db.query('ldgObligations').withIndex('by_legacy', (q) => q.eq('legacyCommissionId', c._id)).first();
      if (!o) {
        let b = await beneficiaryFor(ctx, c.partnerId);
        if (!b) {
          const p = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', c.partnerId)).unique();
          const u = await ctx.db.get(c.partnerId);
          if (!p) continue;
          b = await ensureBeneficiary(ctx, c.partnerId, p.displayName, typeof u?.email === 'string' ? u.email : '');
        }
        const adjustment = c.source === 'adjustment';
        await applyCommissionEvent(ctx, {
          eventKey: `opening:commission:${c._id}`,
          type: adjustment ? 'manual_adjustment' : 'opening_balance',
          amountMinor: c.amountCents,
          actor: 'sync:legacy',
          reason: c.note ?? 'Mirrored from holmCommissions',
          at: c.createdAt,
          create: { beneficiaryId: b._id, source: adjustment ? 'adjustment' : c.source === 'storefront_order' ? 'legacy_storefront' : 'legacy_house_quote', legacyCommissionId: c._id, rateBps: c.rateBps, basisMinor: c.baseCents, state: STATE_MAP[c.status], clearsAt: c.clearsAt, ...(c.status === 'cleared' || c.status === 'paid' ? { clearedAt: c.clearsAt } : {}) },
        });
        mirrored++;
        continue;
      }
      if (o.source === 'adjustment') continue;
      const target = c.status === 'void' ? 0 : c.amountCents;
      const current = o.earnedMinor - o.reversedMinor;
      if (target === current) continue;
      const key = `sync:${c._id}:${target}`;
      const after = o.state === 'reserved' || o.state === 'transfer_submitted' || o.state === 'transferred';
      if (target < current) {
        if (after || o.state === 'void')
          await applyCommissionEvent(ctx, { eventKey: key, type: 'offset', amountMinor: target - current, actor: 'sync:legacy', reason: 'Legacy commission reduced after payout', create: { beneficiaryId: o.beneficiaryId, source: 'offset', rateBps: 0, basisMinor: 0, state: 'cleared', clearsAt: Date.now() } });
        else await applyCommissionEvent(ctx, { eventKey: key, obligationId: o._id, type: 'refund_reversal', amountMinor: target - current, actor: 'sync:legacy', reason: 'Legacy commission reduced' });
      } else
        await applyCommissionEvent(ctx, { eventKey: key, type: 'manual_adjustment', amountMinor: target - current, actor: 'sync:legacy', reason: 'Legacy commission restored', create: { beneficiaryId: o.beneficiaryId, source: 'adjustment', rateBps: 0, basisMinor: 0, state: 'cleared', clearsAt: Date.now() } });
      adjusted++;
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.v2Migrations.syncLegacyLedgerPage, { cursor: res.continueCursor });
    return { mirrored, adjusted };
  },
});

// v2 backfills (spec S05, S06, v2 §22). Each runs one page per call, is dry-run by default and is
// idempotent by legacy id, so it can be re-run safely. Nothing here rewrites a legacy row or
// recomputes an earned amount: legacy balances are carried over exactly as they stand.
//
// Run order (dev first, then production after review):
//   npx convex run v2Migrations:identityBackfill '{"dryRun":true}'   (repeat with cursor until isDone)
//   npx convex run v2Migrations:identityBackfill '{"dryRun":false}'
//   ledgerSnapshot: dryRun:true, review sourceHash; commit same cursor with expectedSourceHash.
//   creditSnapshot: dryRun:true, review sourceHash; commit same cursor with expectedSourceHash.
//   npx convex run v2Migrations:runLedgerParity '{}'  (complete read-only report)
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { applyCommissionEvent, applyCreditEvent } from './ldgCore';
import { openReview } from './sysCore';
import { ensureBeneficiary } from './prgCore';
import { digest } from './dlvSecurity';
import { payoutRoute } from '../lib/flags';
import { walkMigrationPages, MigrationPaginationError } from '../lib/migrationPagination';
import { commerceErrorData } from '../lib/errors';
import { legacyCredits, creditParity, commissionEvidence, completeRows, COMMISSION_LIMIT, reconciliation, cents } from './migrationLedgerEvidence';

const PAGE = 50;
const page = { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()), expectedSourceHash: v.optional(v.string()) };
type Counts = Record<string, number>;
const bump = (c: Counts, k: string, n = 1) => {
  c[k] = cents((c[k] ?? 0) + n, 'Migration report total');
};

const TRADE_STATE: Record<Doc<'holmProfiles'>['tradeStatus'], string | null> = {
  none: null,
  pending: 'review',
  approved: 'approved',
  rejected: 'rejected',
  needs_info: 'needs_info',
};

async function beneficiaryFor(ctx: MutationCtx, userId: Id<'users'>) {
  return ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', (q) => q.eq('legacyUserId', userId)).unique();
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
    const reviewInputs: unknown[] = [];
    for (const c of res.page) {
      cents(c.amountCents, 'Legacy commission amount');
      bump(counts, 'commissions');
      const existing = await ctx.db.query('ldgObligations').withIndex('by_legacy', (q) => q.eq('legacyCommissionId', c._id)).unique();
      const b = await beneficiaryFor(ctx, c.partnerId);
      reviewInputs.push({ commission: c, existing, beneficiary: b });
      if (existing) { bump(counts, 'exists'); continue; }
      if (!b) {
        missing.push(`${c._id}: no beneficiary for partner ${c.partnerId} (run identityBackfill first)`);
        bump(counts, 'missing_beneficiary');
        continue;
      }
      bump(counts, `create_${c.status}`);
      if (dryRun) continue;
      if (b.userId !== c.partnerId) reconciliation('Legacy beneficiary owner differs');
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
    const sourceHash = await digest({ cursor: a.cursor ?? null, inputs: reviewInputs, isDone: res.isDone });
    if (!dryRun && a.expectedSourceHash !== sourceHash) reconciliation('Review the current ledger page dry run before committing');
    return { dryRun, sourceHash, counts, missing, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

/** S06: opening credit balances (available and held) per member from the holmCredits ledger. */
export const creditSnapshot = internalMutation({
  args: page,
  handler: async (ctx, a) => {
    const dryRun = a.dryRun !== false;
    const res = await ctx.db.query('users').paginate({ cursor: a.cursor ?? null, numItems: PAGE });
    const counts: Counts = {};
    const reviewInputs: unknown[] = [];
    for (const user of res.page) {
      const source = await legacyCredits(ctx, user._id);
      if (!source.rows.length) { reviewInputs.push({ userId: user._id, fingerprint: source.fingerprint }); continue; }
      const { balance, held, holds, fingerprint } = source;
      bump(counts, 'accounts'); bump(counts, 'available_minor', balance); bump(counts, 'held_minor', held);
      const opening = await ctx.db.query('ldgCreditEvents').withIndex('by_key', q => q.eq('eventKey', `opening:credit:${user._id}`)).unique();
      const account = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', q => q.eq('userId', user._id)).unique();
      reviewInputs.push({ userId: user._id, fingerprint, opening, account });
      if (opening) {
        await creditParity(ctx, user._id);
        bump(counts, 'exists');
        continue;
      }
      if (account && (account.availableMinor || account.reservedMinor || account.pendingAwardMinor || account.lifetimeIssuedMinor
        || await ctx.db.query('ldgCreditEvents').withIndex('by_account_at', q => q.eq('accountId', account._id)).first())) reconciliation('Review existing native credit before adding a legacy opening');
      for (const h of holds) {
        if (await ctx.db.query('ldgCreditEvents').withIndex('by_ref', q => q.eq('ref', h.ref!)).first()) reconciliation('Credit hold reference already belongs to a ledger event');
      }
      if (dryRun) continue;
      await applyCreditEvent(ctx, { eventKey: `opening:credit:${user._id}`, sourceFingerprint: fingerprint, userId: user._id, type: 'opening_balance', amountMinor: cents(balance + held, 'Opening credit'), actor: 'migration:v2Ledger', reason: 'Opening balance from holmCredits' });
      for (const h of holds) await applyCreditEvent(ctx, { eventKey: `opening:credit-hold:${h._id}`, userId: user._id, type: 'reserved', amountMinor: h.heldCents ?? -h.amountCents, ref: h.ref!, actor: 'migration:v2Ledger', reason: 'Hold carried over from holmCredits' });
    }
    const sourceHash = await digest({ cursor: a.cursor ?? null, inputs: reviewInputs, isDone: res.isDone });
    if (!dryRun && a.expectedSourceHash !== sourceHash) reconciliation('Review the current credit page dry run before committing');
    return { dryRun, sourceHash, counts, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

type ParityPage = { mismatches: string[]; mismatchCount: number; diagnosticsTruncated: boolean; counts: Counts; incompleteScopes: number; scopeComplete: boolean; continueCursor: string; isDone: boolean };

/** One read-only user page, including credit-only identities. Not a complete cutover receipt. */
export const ledgerParity = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a): Promise<ParityPage> => {
    const res = await ctx.db.query('users').paginate({ cursor: a.cursor ?? null, numItems: 25 });
    const mismatches: string[] = [];
    const counts: Counts = { users: res.page.length, commissions: 0 };
    let incompleteScopes = 0;
    for (const user of res.page) {
      try {
        const legacy = completeRows(await ctx.db.query('holmCommissions').withIndex('by_partner', q => q.eq('partnerId', user._id)).take(COMMISSION_LIMIT + 1), COMMISSION_LIMIT, 'Legacy commissions');
        const b = await ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', q => q.eq('legacyUserId', user._id)).unique();
        if (legacy.length && !b) reconciliation('Legacy commissions have no beneficiary');
        if (b && b.userId !== user._id) reconciliation('Legacy beneficiary owner differs');
        const obligations = b ? completeRows(await ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', q => q.eq('beneficiaryId', b._id)).take(COMMISSION_LIMIT + 1), COMMISSION_LIMIT, 'Beneficiary obligations') : [];
        const migrated = obligations.filter(o => o.legacyCommissionId);
        if (legacy.length !== migrated.length) mismatches.push(`${user._id}: migrated commission count differs`);
        for (const c of legacy) {
          counts.commissions++;
          const matches = migrated.filter(o => o.legacyCommissionId === c._id);
          if (matches.length !== 1) { mismatches.push(`${c._id}: missing or duplicate migrated obligation`); continue; }
          const evidence = await commissionEvidence(ctx, c, matches[0]);
          const target = c.status === 'void' ? 0 : cents(c.amountCents, 'Legacy commission');
          if (target !== evidence.accounted) mismatches.push(`${c._id}: legacy ${target} vs v2 ${evidence.accounted}`);
        }
      } catch (error) {
        incompleteScopes++;
        mismatches.push(`${user._id}: commission review required: ${commerceErrorData(error)?.detail ?? 'Incomplete or ambiguous evidence'}`);
      }
      try { await creditParity(ctx, user._id); }
      catch (error) {
        incompleteScopes++;
        mismatches.push(`${user._id}: credit review required: ${commerceErrorData(error)?.detail ?? 'Incomplete or ambiguous evidence'}`);
      }
    }
    return { mismatches: mismatches.slice(0, 50), mismatchCount: mismatches.length, diagnosticsTruncated: mismatches.length > 50,
      counts, incompleteScopes, scopeComplete: incompleteScopes === 0, continueCursor: res.continueCursor, isDone: res.isDone };
  },
});

/** Legacy money rows with a deleted/missing owner must not disappear from a user-based scan. */
export const ledgerSourceReferences = internalQuery({
  args: { source: v.union(v.literal('commissions'), v.literal('credits')), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a): Promise<{ mismatches: string[]; count: number; continueCursor: string; isDone: boolean }> => {
    const page = a.source === 'commissions'
      ? await ctx.db.query('holmCommissions').paginate({ cursor: a.cursor ?? null, numItems: 100 })
      : await ctx.db.query('holmCredits').paginate({ cursor: a.cursor ?? null, numItems: 100 });
    const mismatches: string[] = [];
    for (const row of page.page) {
      const userId = 'partnerId' in row ? row.partnerId : row.userId;
      if (!(await ctx.db.get(userId))) mismatches.push(`${row._id}: legacy ${a.source} owner is missing`);
    }
    return { mismatches, count: page.page.length, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Exhaust every page; no success from a sample, repeated cursor or exhausted iteration budget. */
export const runLedgerParity = internalAction({
  args: { includeDetails: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ passed: boolean; complete: boolean; pages: number; counts: Counts; mismatchCount: number; mismatches: string[]; diagnosticsTruncated: boolean; diagnosticsRedacted: boolean; consistency: 'paginated_not_atomic'; startedAt: number; completedAt: number }> => {
    const startedAt = Date.now();
    const counts: Counts = {}; const mismatches: string[] = [];
    let mismatchCount = 0, pages = 0, complete = false, incompleteScopes = 0;
    try {
      await walkMigrationPages<ParityPage>(cursor => ctx.runQuery(internal.v2Migrations.ledgerParity, { cursor }), result => {
        pages++; mismatchCount += result.mismatchCount; incompleteScopes += result.incompleteScopes;
        for (const [key, n] of Object.entries(result.counts)) bump(counts, key, n);
        mismatches.push(...result.mismatches.slice(0, Math.max(0, 50 - mismatches.length)));
      });
      for (const source of ['commissions', 'credits'] as const) {
        await walkMigrationPages<{ mismatches: string[]; count: number; continueCursor: string; isDone: boolean }>(
          cursor => ctx.runQuery(internal.v2Migrations.ledgerSourceReferences, { source, cursor }), result => {
            pages++; mismatchCount += result.mismatches.length;
            bump(counts, `source_${source}`, result.count);
            mismatches.push(...result.mismatches.slice(0, Math.max(0, 50 - mismatches.length)));
          });
      }
      complete = incompleteScopes === 0;
    } catch (error) {
      if (!(error instanceof MigrationPaginationError)) throw error;
      mismatchCount++;
      if (mismatches.length < 50) mismatches.push(error.message);
    }
    return { passed: complete && mismatchCount === 0, complete, pages, counts, mismatchCount, mismatches: a.includeDetails ? mismatches : [], diagnosticsTruncated: mismatchCount > mismatches.length, diagnosticsRedacted: !a.includeDetails, consistency: 'paginated_not_atomic', startedAt, completedAt: Date.now() };
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
  handler: async (ctx, a): Promise<{ dryRun: boolean; steps: Record<string, { counts: Counts; notes: string[]; noteCount: number; notesTruncated: boolean; complete: boolean }> }> => {
    const dryRun = a.commit !== true;
    if (!dryRun && (!a.only || a.only.some(step => step !== 'identity'))) reconciliation('Commit financial pages with their reviewed expectedSourceHash; bulk financial commit is disabled');
    const out: Record<string, { counts: Counts; notes: string[]; noteCount: number; notesTruncated: boolean; complete: boolean }> = {};
    const steps = [
      ['identity', internal.v2Migrations.identityBackfill],
      ['ledger', internal.v2Migrations.ledgerSnapshot],
      ['credit', internal.v2Migrations.creditSnapshot],
    ] as const;
    for (const [name, fn] of steps) {
      if (a.only && !a.only.includes(name)) continue;
      const total: Counts = {};
      const notes: string[] = [];
      let noteCount = 0;
      try {
        await walkMigrationPages<PageResult>(cursor => ctx.runMutation(fn, { cursor, dryRun }), r => {
          for (const [k, n] of Object.entries(r.counts)) bump(total, k, n);
          const pageNotes = [...(r.ambiguous ?? []), ...(r.missing ?? [])];
          noteCount += pageNotes.length; notes.push(...pageNotes.slice(0, Math.max(0, 50 - notes.length)));
        });
      } catch (error) {
        if (error instanceof MigrationPaginationError) reconciliation(`${name}: ${error.message}; last cursor ${error.cursor ?? 'start'}; prior committed pages are retained`);
        throw error;
      }
      out[name] = { counts: total, notes, noteCount, notesTruncated: noteCount > notes.length, complete: true };
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
      const o = await ctx.db.query('ldgObligations').withIndex('by_legacy', (q) => q.eq('legacyCommissionId', c._id)).unique();
      if (!o) {
        let b = await beneficiaryFor(ctx, c.partnerId);
        if (!b) {
          const p = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', c.partnerId)).unique();
          const u = await ctx.db.get(c.partnerId);
          if (!p) continue;
          b = await ensureBeneficiary(ctx, c.partnerId, p.displayName, typeof u?.email === 'string' ? u.email : '');
        }
        cents(c.amountCents, 'Legacy commission amount');
        if (b.userId !== c.partnerId || b.legacyUserId !== c.partnerId) reconciliation('Legacy beneficiary owner differs');
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
      const target = c.status === 'void' ? 0 : cents(c.amountCents, 'Legacy commission target');
      const evidence = await commissionEvidence(ctx, c, o);
      let delta = cents(target - evidence.accounted, 'Legacy correction');
      if (!delta) continue;
      const key = `sync:${c._id}:transition:${evidence.events.length}:${target}`;
      let part = 0;
      // Reverse unpaid positive obligations first, including earlier restoration adjustments.
      if (delta < 0) for (const obligation of evidence.obligations) {
        if (!['pending', 'cleared', 'held'].includes(obligation.state)) continue;
        const take = Math.min(-delta, Math.max(0, obligation.earnedMinor - obligation.reversedMinor));
        if (!take) continue;
        await applyCommissionEvent(ctx, { eventKey: `${key}:${part++}`, obligationId: obligation._id, type: 'refund_reversal', amountMinor: -take, actor: 'sync:legacy', reason: 'Legacy commission reduced' });
        delta += take;
        if (!delta) break;
      }
      if (delta) {
        // Paid amounts remain immutable. A later negative change is a visible future offset.
        const pending = delta > 0 && c.status === 'pending';
        if (delta > 0 && o.state === 'held') reconciliation('Resolve the commission dispute before restoring earnings');
        await applyCommissionEvent(ctx, { eventKey: `${key}:${part}`, type: delta < 0 ? 'offset' : 'manual_adjustment', amountMinor: delta,
          actor: 'sync:legacy', reason: delta < 0 ? 'Legacy commission reduced after payout' : 'Legacy commission restored',
          create: { beneficiaryId: o.beneficiaryId, source: delta < 0 ? 'offset' : 'adjustment', rateBps: 0, basisMinor: 0,
            state: pending ? 'pending' : 'cleared', clearsAt: pending ? c.clearsAt : Date.now() } });
      }
      adjusted++;
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.v2Migrations.syncLegacyLedgerPage, { cursor: res.continueCursor });
    return { mirrored, adjusted };
  },
});

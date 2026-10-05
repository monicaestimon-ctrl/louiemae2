import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { getHealthState, syncProductHealth, markHealthDeadline } from './productHealthMaintenance';
import { HEALTH_VERSION, healthDetails, productHealthProjection, emptyMigrationCounts } from '../lib/productHealth';
import { sameCatalogValue } from '../lib/catalogProjection';
import { catalogPageOptions } from '../lib/catalogPagination';

export const status = query({ args: {}, handler: async ctx => {
  await requireCjAdminIdentity(ctx);
  const state = await getHealthState(ctx);
  const ready = state?.enabled === true && state.phase === 'ready' && state.version === HEALTH_VERSION;
  return { ready, phase: state?.phase ?? 'not_started', verifiedAt: state?.verifiedAt,
    totalProducts: ready ? state.total : undefined, productsWithIssues: ready ? state.issues : undefined,
    productsWithCjIssues: ready ? state.cjIssues : undefined, productsMissingCjVariants: ready ? state.missingCjVariants : undefined };
} });
export const issuesPage = query({ args: { paginationOpts: paginationOptsValidator, cjOnly: v.optional(v.boolean()) }, handler: async (ctx, args) => {
  await requireCjAdminIdentity(ctx);
  const state = await getHealthState(ctx);
  if (!state?.enabled || state.phase !== 'ready' || state.version !== HEALTH_VERSION) throw new ConvexError('PRODUCT_HEALTH_NOT_READY');
  const source = args.cjOnly
    ? ctx.db.query('productHealth').withIndex('by_cj_issues', q => q.eq('epoch', state.epoch).eq('hasCjIssues', true))
    : ctx.db.query('productHealth').withIndex('by_issues', q => q.eq('epoch', state.epoch).eq('hasIssues', true));
  const batch = await source.paginate(catalogPageOptions(args.paginationOpts));
  return { ...batch, page: batch.page.map(row => healthDetails(row as unknown as ReturnType<typeof productHealthProjection>, Date.now())) };
} });

// A fresh epoch rebuilds totals from authoritative sources without clearing
// tables or double-counting products changed concurrently with the backfill.
export const startRebuild = internalMutation({ args: {}, handler: async ctx => {
  const state = await getHealthState(ctx);
  const next = { key: 'primary', epoch: (state?.epoch ?? 0) + 1, version: HEALTH_VERSION, enabled: false,
    phase: 'backfill' as const, cursor: null, total: 0, issues: 0, cjIssues: 0, missingCjVariants: 0, revision: 0,
    migrationCounts: emptyMigrationCounts(), checkedMigrationCounts: emptyMigrationCounts(),
    verificationRevision: 0, checked: 0, checkedIssues: 0, checkedCjIssues: 0, checkedMissingCjVariants: 0, mismatchIds: [], updatedAt: Date.now() };
  if (state) await ctx.db.replace(state._id, next); else await ctx.db.insert('productHealthState', next);
  return next;
} });

export const rebuildNext = internalMutation({ args: {
  epoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('orphans'), v.literal('verify')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async (ctx, args) => {
  const state = await getHealthState(ctx);
  if (!state) throw new Error('Start a health rebuild first.');
  if (args.epoch !== state.epoch || args.expectedPhase !== state.phase || args.expectedCursor !== state.cursor) return { ...state, advanced: false };
  const now = Date.now();
  if (state.phase === 'backfill') {
    const batch = await ctx.db.query('products').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5, 2_000_000));
    for (const product of batch.page) await syncProductHealth(ctx, product._id, product, now);
    await ctx.db.patch(state._id, { cursor: batch.isDone ? null : batch.continueCursor, phase: batch.isDone ? 'orphans' : 'backfill', updatedAt: now });
  } else if (state.phase === 'orphans') {
    const batch = await ctx.db.query('productHealth').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5));
    for (const row of batch.page) await syncProductHealth(ctx, row.productId, await ctx.db.get(row.productId), now);
    const current = (await ctx.db.get(state._id))!;
    await ctx.db.patch(state._id, { cursor: batch.isDone ? null : batch.continueCursor, phase: batch.isDone ? 'verify' : 'orphans',
      verificationRevision: current.revision, checked: 0, checkedIssues: 0, checkedCjIssues: 0, checkedMissingCjVariants: 0, checkedMigrationCounts: emptyMigrationCounts(), updatedAt: now });
  } else {
    if (state.verificationRevision !== state.revision) {
      // A live update invalidates only this read-only verification pass. It does
      // not require rebuilding otherwise transactionally maintained counters.
      await ctx.db.patch(state._id, { cursor: null, checked: 0, checkedIssues: 0, checkedCjIssues: 0, checkedMissingCjVariants: 0, checkedMigrationCounts: emptyMigrationCounts(), verificationRevision: state.revision, updatedAt: now });
      return { ...(await ctx.db.get(state._id)), advanced: false, verificationRestarted: true };
    }
    const batch = await ctx.db.query('products').paginate(catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5, 2_000_000));
    const mismatches: string[] = [];
    let checkedIssues = state.checkedIssues;
    let checkedCjIssues = state.checkedCjIssues;
    let checkedMissingCjVariants = state.checkedMissingCjVariants;
    const checkedMigrationCounts = { ...emptyMigrationCounts(), ...state.checkedMigrationCounts };
    for (const product of batch.page) {
      const expected = { ...productHealthProjection(product, now), epoch: state.epoch };
      const row = await ctx.db.query('productHealth').withIndex('by_product', q => q.eq('productId', product._id)).unique();
      const stored = row && Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id' && key !== '_creationTime'));
      if (!sameCatalogValue(expected, stored)) mismatches.push(product._id);
      checkedIssues += Number(expected.hasIssues); checkedCjIssues += Number(expected.hasCjIssues);
      checkedMissingCjVariants += Number(expected.hasMissingCjVariants);
      if (expected.migrationStatus) checkedMigrationCounts[expected.migrationStatus] += 1;
    }
    const checked = state.checked + batch.page.length;
    if (batch.isDone && (checked !== state.total || checkedIssues !== state.issues || checkedCjIssues !== state.cjIssues || checkedMissingCjVariants !== state.missingCjVariants)) mismatches.push('aggregate_totals');
    if (batch.isDone && !sameCatalogValue(checkedMigrationCounts, state.migrationCounts)) mismatches.push('migration_totals');
    await ctx.db.patch(state._id, { cursor: batch.isDone || mismatches.length ? null : batch.continueCursor,
      phase: mismatches.length ? 'failed' : batch.isDone ? 'ready' : 'verify', checked, checkedIssues, checkedCjIssues, checkedMissingCjVariants, checkedMigrationCounts,
      mismatchIds: mismatches, updatedAt: now, ...(batch.isDone && !mismatches.length ? { verifiedAt: now } : {}) });
  }
  return { ...(await ctx.db.get(state._id)), advanced: true };
} });

export const verifyAgain = internalMutation({ args: {}, handler: async ctx => {
  const state = await getHealthState(ctx);
  if (!state || ['backfill', 'orphans'].includes(state.phase)) throw new Error('Complete the rebuild first.');
  await ctx.db.patch(state._id, { enabled: false, phase: 'verify', cursor: null, checked: 0, checkedIssues: 0, checkedCjIssues: 0, checkedMissingCjVariants: 0,
    checkedMigrationCounts: emptyMigrationCounts(),
    verificationRevision: state.revision, mismatchIds: [], updatedAt: Date.now() });
} });
export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const state = await getHealthState(ctx);
  if (!state) { if (args.enabled) throw new Error('Verify health summaries first.'); return; }
  if (args.enabled && (state.phase !== 'ready' || state.version !== HEALTH_VERSION || state.verificationRevision !== state.revision)) throw new Error('Verify health summaries first.');
  await ctx.db.patch(state._id, { enabled: args.enabled, updatedAt: Date.now() });
} });

export const refreshDue = internalMutation({ args: {}, handler: async ctx => {
  const state = await getHealthState(ctx);
  if (!state || state.version !== HEALTH_VERSION) return { refreshed: 0 };
  const now = Date.now();
  const due = await ctx.db.query('productHealth').withIndex('by_due', q => q.eq('epoch', state.epoch).gt('dueAt', 0).lte('dueAt', now))
    .paginate(catalogPageOptions({ cursor: null, numItems: 50 }));
  for (const row of due.page) await markHealthDeadline(ctx, row, now);
  return { refreshed: due.page.length, remaining: !due.isDone };
} });

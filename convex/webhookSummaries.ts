import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { catalogPageOptions } from '../lib/catalogPagination';
import { sameCatalogValue } from '../lib/catalogProjection';
import { getWebhookSummaryState, syncWebhookSummary, webhookSummaryProjection, WEBHOOK_SUMMARY_VERSION } from './webhookSummaryMaintenance';

export const status = query({ args: {}, handler: async ctx => {
  await requireCjAdminIdentity(ctx);
  const state = await getWebhookSummaryState(ctx);
  return { ready: state?.enabled === true && state.version === WEBHOOK_SUMMARY_VERSION && state.phase === 'verified',
    phase: state?.phase ?? 'not_started', checked: state?.checked ?? 0, verifiedAt: state?.verifiedAt };
} });
export const startRebuild = internalMutation({ args: { scope: v.optional(v.union(v.literal('all'), v.literal('recent'))) }, handler: async (ctx, args) => {
  const state = await getWebhookSummaryState(ctx);
  const next = { key: 'primary', epoch: (state?.epoch ?? 0) + 1, version: WEBHOOK_SUMMARY_VERSION, enabled: false,
    phase: 'backfill' as const, cursor: null, checked: 0, mismatchIds: [], updatedAt: Date.now(),
    scope: args.scope ?? 'all', phaseChecked: 0 };
  if (state) await ctx.db.replace(state._id, next); else await ctx.db.insert('webhookSummaryState', next);
  return next;
} });
export const rebuildNext = internalMutation({ args: {
  epoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('verify'), v.literal('orphans')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async (ctx, args) => {
  const state = await getWebhookSummaryState(ctx);
  if (!state) throw new Error('Start a webhook summary rebuild first.');
  if (state.epoch !== args.epoch || state.phase !== args.expectedPhase || state.cursor !== args.expectedCursor) return { ...state, advanced: false };
  const mismatches: string[] = [];
  // The operations contract samples the latest 100 events. For a large history,
  // verify this exact window instead of duplicating millions of unused records.
  const recent = state.scope === 'recent';
  const phaseChecked = state.phaseChecked ?? 0;
  const pageSize = recent ? Math.min(5, 100 - phaseChecked) : 5;
  let nextCursor: string;
  let complete: boolean;
  let visited: number;
  if (state.phase === 'orphans') {
    // At most five source lookups, even when each retained payload is large.
    const rows = recent
      ? ctx.db.query('webhookSummaries').withIndex('by_source_created').order('desc')
      : ctx.db.query('webhookSummaries');
    const batch = await rows.paginate(catalogPageOptions({ cursor: state.cursor, numItems: pageSize }, 5));
    for (const row of batch.page) {
      const source = await ctx.db.get(row.webhookId);
      const value = Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id' && key !== '_creationTime'));
      if (!source || (recent && !sameCatalogValue(value, webhookSummaryProjection(source)))) mismatches.push(row.webhookId);
    }
    nextCursor = batch.continueCursor; complete = batch.isDone; visited = batch.page.length;
  } else {
    const batch = await ctx.db.query('cjWebhookLog').order(recent ? 'desc' : 'asc')
      .paginate(catalogPageOptions({ cursor: state.cursor, numItems: pageSize }, 5, 2_000_000));
    for (const source of batch.page) {
      if (state.phase === 'backfill') await syncWebhookSummary(ctx, source._id, source);
      else {
        const row = await ctx.db.query('webhookSummaries').withIndex('by_webhook', q => q.eq('webhookId', source._id)).unique();
        const value = row && Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id' && key !== '_creationTime'));
        if (!sameCatalogValue(value, webhookSummaryProjection(source))) mismatches.push(source._id);
      }
    }
    nextCursor = batch.continueCursor; complete = batch.isDone; visited = batch.page.length;
  }
  complete ||= recent && phaseChecked + visited >= 100;
  const phase = mismatches.length ? 'failed' : !complete ? state.phase
    : state.phase === 'backfill' ? 'verify' : state.phase === 'verify' ? 'orphans' : 'verified';
  const updatedAt = Date.now();
  await ctx.db.patch(state._id, { phase, cursor: complete || mismatches.length ? null : nextCursor,
    checked: state.checked + visited, phaseChecked: complete ? 0 : phaseChecked + visited,
    mismatchIds: mismatches, updatedAt, ...(phase === 'verified' ? { verifiedAt: updatedAt } : {}) });
  return { ...(await ctx.db.get(state._id)), advanced: true };
} });
export const setEnabled = internalMutation({ args: { enabled: v.boolean() }, handler: async (ctx, args) => {
  const state = await getWebhookSummaryState(ctx);
  if (!state) { if (args.enabled) throw new Error('Verify webhook summaries first.'); return; }
  if (args.enabled && (state.phase !== 'verified' || state.version !== WEBHOOK_SUMMARY_VERSION)) throw new Error('Verify webhook summaries first.');
  await ctx.db.patch(state._id, { enabled: args.enabled, updatedAt: Date.now() });
} });
export const repair = internalMutation({ args: { ids: v.array(v.id('cjWebhookLog')) }, handler: async (ctx, args) => {
  if (args.ids.length < 1 || args.ids.length > 5 || new Set(args.ids).size !== args.ids.length) throw new Error('Select one to five distinct webhook IDs.');
  const state = await getWebhookSummaryState(ctx);
  if (state) await ctx.db.patch(state._id, { enabled: false, phase: 'failed', cursor: null, updatedAt: Date.now() });
  for (const id of args.ids) await syncWebhookSummary(ctx, id, await ctx.db.get(id));
  return { repaired: args.ids.length, verificationRequired: true };
} });

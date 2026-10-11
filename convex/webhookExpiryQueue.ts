import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { EXPIRY_KEY, expiryState, expiryProjection, syncExpiry } from './webhookExpiryMaintenance';
import { catalogPageOptions } from '../lib/catalogPagination';
export const status = internalQuery({ args: {}, handler: expiryState });
export const begin = internalMutation({ args: {}, handler: async ctx => {
  const old = await expiryState(ctx);
  if (old && old.phase !== 'failed') return old;
  const next = { key: EXPIRY_KEY, epoch: (old?.epoch ?? 0) + 1, phase: 'backfill' as const, cursor: null, checked: 0, mismatchIds: [] as string[], updatedAt: Date.now() };
  const id = old ? (await ctx.db.replace(old._id, next), old._id) : await ctx.db.insert('webhookExpiryState', next);
  return ctx.db.get(id);
} });
// Compare-and-swap cursor guards make retries and stale operator calls harmless.
// Only positive-expiry rows are scanned, never the payload-free history prefix.
export const advance = internalMutation({ args: {
  expectedEpoch: v.number(), expectedPhase: v.union(v.literal('backfill'), v.literal('source'), v.literal('queue')),
  expectedCursor: v.union(v.string(), v.null()),
}, handler: async (ctx, args) => {
  const state = await expiryState(ctx);
  if (!state || state.epoch !== args.expectedEpoch || state.phase !== args.expectedPhase || state.cursor !== args.expectedCursor) throw new Error('WEBHOOK_EXPIRY_STALE_CURSOR');
  const options = catalogPageOptions({ cursor: state.cursor, numItems: 5 }, 5, 2_000_000);
  const mismatches: string[] = [];
  let cursor: string, done: boolean, count: number;
  if (state.phase === 'queue') {
    const page = await ctx.db.query('webhookExpiryQueue').paginate(options);
    cursor = page.continueCursor; done = page.isDone; count = page.page.length;
    for (const entry of page.page) {
      const expected = expiryProjection(await ctx.db.get(entry.webhookId));
      if (!expected || expected.expiresAt !== entry.expiresAt || expected.sourceCreatedAt !== entry.sourceCreatedAt) mismatches.push(entry.webhookId);
    }
  } else {
    const page = await ctx.db.query('cjWebhookLog').withIndex('by_expiry', q => q.gt('expiresAt', 0)).paginate(options);
    cursor = page.continueCursor; done = page.isDone; count = page.page.length;
    for (const row of page.page) {
      if (state.phase === 'backfill') await syncExpiry(ctx, row._id, row);
      else {
        const entry = await ctx.db.query('webhookExpiryQueue').withIndex('by_webhook', q => q.eq('webhookId', row._id)).unique();
        if (!entry || entry.expiresAt !== row.expiresAt || entry.sourceCreatedAt !== row._creationTime) mismatches.push(row._id);
      }
    }
  }
  const phase = mismatches.length ? 'failed' : done ? (state.phase === 'backfill' ? 'source' : state.phase === 'source' ? 'queue' : 'verified') : state.phase;
  await ctx.db.patch(state._id, { phase, cursor: done || mismatches.length ? null : cursor, checked: state.checked + count, mismatchIds: mismatches, updatedAt: Date.now() });
  return ctx.db.get(state._id);
} });
export const repair = internalMutation({ args: { ids: v.array(v.id('cjWebhookLog')) }, handler: async (ctx, args) => {
  if (args.ids.length > 5) throw new Error('Repair at most five webhook identities.');
  for (const id of new Set(args.ids)) await syncExpiry(ctx, id, await ctx.db.get(id));
} });

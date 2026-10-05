import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import type { Doc } from './_generated/dataModel';

const eligible = (row: Doc<'cjWebhookLog'>, now: number) =>
  (row.status === undefined || row.status === 'processed')
  && row.expiresAt !== undefined && row.expiresAt > 0 && row.expiresAt < now;

/** A cursor advances over unresolved rows too, so they cannot starve cleanup. */
export const preview = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const now = Date.now();
    const batch = await ctx.db.query('cjWebhookLog').withIndex('by_expiry', q => q.gt('expiresAt', 0).lt('expiresAt', now))
      .paginate({ cursor: args.cursor, numItems: 5 });
    return {
      cursor: batch.continueCursor, complete: batch.isDone,
      records: batch.page.map(row => ({
        id: row._id, type: row.type, status: row.status ?? 'processed', expiresAt: row.expiresAt,
        eligible: eligible(row, now),
        reason: eligible(row, now) ? 'successful_diagnostic_expired' : 'unresolved_preserved',
        approximatePayloadBytes: row.payload === undefined ? 0 : new globalThis.TextEncoder().encode(JSON.stringify(row.payload)).length,
      })),
    };
  },
});

/** Exact reviewed IDs only. No event identity or unresolved payload is deleted. */
export const compact = mutation({
  args: { ids: v.array(v.id('cjWebhookLog')), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    if (args.ids.length < 1 || args.ids.length > 5 || new Set(args.ids).size !== args.ids.length) {
      throw new Error('Select between one and five distinct reviewed log IDs.');
    }
    const now = Date.now();
    const results = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      const canCompact = row !== null && eligible(row, now);
      if (canCompact && !args.dryRun) await ctx.db.patch(id, { payload: undefined, expiresAt: 0 });
      results.push({ id, eligible: canCompact, compacted: canCompact && !args.dryRun });
    }
    return { dryRun: args.dryRun, identitiesDeleted: 0, results };
  },
});

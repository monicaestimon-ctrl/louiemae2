import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { sameCatalogValue } from '../lib/catalogProjection';

export const WEBHOOK_SUMMARY_VERSION = 1;
export function webhookSummaryProjection(row: Doc<'cjWebhookLog'>) {
  const claimedAt = row.claimedAt ? Date.parse(row.claimedAt) : Number.NaN;
  return { webhookId: row._id, version: WEBHOOK_SUMMARY_VERSION, sourceCreatedAt: row._creationTime,
    status: row.status ?? 'processed', claimedAt: Number.isFinite(claimedAt) ? new Date(claimedAt).toISOString() : undefined };
}
export const getWebhookSummaryState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('webhookSummaryState').withIndex('by_key', q => q.eq('key', 'primary')).unique();
export async function webhookSummariesReady(ctx: Pick<QueryCtx, 'db'>) {
  const state = await getWebhookSummaryState(ctx);
  return state?.enabled === true && state.version === WEBHOOK_SUMMARY_VERSION && state.phase === 'verified';
}
export async function syncWebhookSummary(ctx: Pick<MutationCtx, 'db'>, id: Id<'cjWebhookLog'>, source: Doc<'cjWebhookLog'> | null) {
  const existing = await ctx.db.query('webhookSummaries').withIndex('by_webhook', q => q.eq('webhookId', id)).unique();
  if (!source) {
    if (existing) await ctx.db.delete(existing._id);
    // Deleting a recent event can expose an older, not-yet-materialized event.
    // Keep the existing bounded source reader until the recent window is rebuilt.
    const state = await getWebhookSummaryState(ctx);
    if (state?.scope === 'recent') await ctx.db.patch(state._id, {
      enabled: false, phase: 'failed', cursor: null, updatedAt: Date.now(),
    });
    return;
  }
  const projected = webhookSummaryProjection(source);
  if (existing) {
    const value = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== '_id' && key !== '_creationTime'));
    if (sameCatalogValue(value, projected)) return;
    await ctx.db.replace(existing._id, projected);
  } else await ctx.db.insert('webhookSummaries', projected);
}

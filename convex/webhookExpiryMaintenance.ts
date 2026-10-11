import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
export const EXPIRY_KEY = 'webhook-expiry-v1';
export const expiryState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('webhookExpiryState').withIndex('by_key', q => q.eq('key', EXPIRY_KEY)).unique();
export const expiryProjection = (row: Doc<'cjWebhookLog'> | null) => row && row.expiresAt !== undefined && row.expiresAt > 0
  ? { webhookId: row._id, expiresAt: row.expiresAt, sourceCreatedAt: row._creationTime } : null;
export async function syncExpiry(ctx: Pick<MutationCtx, 'db'>, id: Id<'cjWebhookLog'>, row: Doc<'cjWebhookLog'> | null) {
  const existing = await ctx.db.query('webhookExpiryQueue').withIndex('by_webhook', q => q.eq('webhookId', id)).unique();
  const projection = expiryProjection(row);
  if (!projection) { if (existing) await ctx.db.delete(existing._id); }
  else if (!existing) await ctx.db.insert('webhookExpiryQueue', projection);
  else if (existing.expiresAt !== projection.expiresAt || existing.sourceCreatedAt !== projection.sourceCreatedAt) await ctx.db.replace(existing._id, projection);
}
export async function checkedExpirySource(ctx: Pick<QueryCtx, 'db'>, entry: Doc<'webhookExpiryQueue'>) {
  const row = await ctx.db.get(entry.webhookId);
  const expected = expiryProjection(row);
  if (!expected || expected.expiresAt !== entry.expiresAt || expected.sourceCreatedAt !== entry.sourceCreatedAt) throw new Error('WEBHOOK_EXPIRY_QUEUE_DRIFT');
  return row!;
}

export async function requireExpiryQueue(ctx: Pick<QueryCtx, 'db'>) {
  if ((await expiryState(ctx))?.phase !== 'verified') throw new Error('WEBHOOK_EXPIRY_QUEUE_NOT_VERIFIED');
}
export async function expiredWebhookRows(ctx: Pick<QueryCtx, 'db'>, now: number, limit: number) {
  await requireExpiryQueue(ctx);
  const entries = await ctx.db.query('webhookExpiryQueue').withIndex('by_expiry', q => q.lt('expiresAt', now)).take(limit);
  return Promise.all(entries.map(entry => checkedExpirySource(ctx, entry)));
}

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

export const RECOVERY_QUEUE_KEY = 'webhook-recovery-v1';
export const getRecoveryQueueState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('webhookRecoveryState')
  .withIndex('by_key', q => q.eq('key', RECOVERY_QUEUE_KEY)).unique();

export function recoveryProjection(row: Doc<'cjWebhookLog'> | null) {
  return row?.status === 'processing'
    ? { webhookId: row._id, claimedAt: row.claimedAt, sourceCreatedAt: row._creationTime }
    : null;
}

export async function syncRecoveryQueue(ctx: Pick<MutationCtx, 'db'>, webhookId: Id<'cjWebhookLog'>, source: Doc<'cjWebhookLog'> | null) {
  const existing = await ctx.db.query('webhookRecoveryQueue').withIndex('by_webhook', q => q.eq('webhookId', webhookId)).unique();
  const projected = recoveryProjection(source);
  if (!projected) {
    if (existing) await ctx.db.delete(existing._id);
  } else if (!existing) {
    await ctx.db.insert('webhookRecoveryQueue', projected);
  } else if (existing.claimedAt !== projected.claimedAt || existing.sourceCreatedAt !== projected.sourceCreatedAt) {
    await ctx.db.replace(existing._id, projected);
  }
}

export async function staleRecoveryRows(ctx: Pick<QueryCtx, 'db'>, cutoff: string, limit: number) {
  const state = await getRecoveryQueueState(ctx);
  if (!state?.enabled || state.phase !== 'verified') throw new Error('WEBHOOK_RECOVERY_QUEUE_NOT_VERIFIED');
  const queue = await ctx.db.query('webhookRecoveryQueue').withIndex('by_claimed_at', q => q.lt('claimedAt', cutoff)).take(limit);
  const result: Doc<'cjWebhookLog'>[] = [];
  for (const entry of queue) {
    const source = await ctx.db.get(entry.webhookId);
    if (!source || source.status !== 'processing' || source.claimedAt !== entry.claimedAt || source._creationTime !== entry.sourceCreatedAt) {
      throw new Error('WEBHOOK_RECOVERY_QUEUE_DRIFT');
    }
    result.push(source);
  }
  return result;
}

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

export const SOURCING_COUNTS_VERSION = 1;
export const SOURCING_STATES = [
  'needs_input', 'queued', 'submitting', 'submitted', 'processing', 'awaiting_catalog',
  'sourced', 'mapping_required', 'fulfillment_ready', 'retry_wait',
  'reconciliation_required', 'rejected', 'dead_letter', 'canceled',
] as const satisfies readonly Doc<'cjSourcingJobs'>['state'][];
export const emptySourcingCounts = (): Record<string, number> => Object.fromEntries(SOURCING_STATES.map(state => [state, 0]));
export const getSourcingCountState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('sourcingCountState').withIndex('by_key', q => q.eq('key', 'primary')).unique();

export async function readySourcingCounts(ctx: Pick<QueryCtx, 'db'>) {
  const state = await getSourcingCountState(ctx);
  return state?.enabled && state.phase === 'ready' && state.version === SOURCING_COUNTS_VERSION ? state.counts : null;
}

// The per-job row records which epoch counted this job. Backfill and concurrent
// writes can both visit it without incrementing a counter twice.
export async function syncSourcingCount(ctx: Pick<MutationCtx, 'db'>, id: Id<'cjSourcingJobs'>, job: Doc<'cjSourcingJobs'> | null) {
  const state = await getSourcingCountState(ctx);
  if (!state || state.version !== SOURCING_COUNTS_VERSION) return;
  const row = await ctx.db.query('sourcingCountRows').withIndex('by_job', q => q.eq('jobId', id)).unique();
  const counted = row?.epoch === state.epoch;
  if (!row && !job || counted && row.state === job?.state) return;
  const counts = { ...state.counts };
  if (counted) counts[row.state]--;
  if (job) counts[job.state]++;
  if (!job) { if (row) await ctx.db.delete(row._id); }
  else {
    const value = { jobId: id, epoch: state.epoch, state: job.state };
    if (row) await ctx.db.replace(row._id, value); else await ctx.db.insert('sourcingCountRows', value);
  }
  await ctx.db.patch(state._id, { counts, revision: state.revision + 1, updatedAt: Date.now() });
}

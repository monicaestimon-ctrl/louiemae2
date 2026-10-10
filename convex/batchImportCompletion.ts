import { ConvexError } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

type CompletionCtx = Pick<MutationCtx, 'db'>;
export async function refreshBatchJobCompletion(ctx: CompletionCtx, jobId: Id<'batchImportJobs'>, now = Date.now()) {
    const items = await ctx.db.query('batchImportItems').withIndex('by_job', q => q.eq('jobId', jobId)).collect();
    if (!items.some(item => ['pending', 'fetching', 'ready', 'error'].includes(item.status))) {
        await ctx.db.patch(jobId, { status: 'completed', updatedAt: now });
    }
}

/** Must run in the transaction that saves the products, or after a verified save. */
export async function completeSavedBatchItems(ctx: CompletionCtx, itemIds: Id<'batchImportItems'>[]) {
    const now = Date.now();
    const jobs = new Set<Id<'batchImportJobs'>>();
    for (const itemId of new Set(itemIds)) {
        const item = await ctx.db.get(itemId);
        if (!item) throw new ConvexError({ code: 'IMPORT_ITEM_MISSING', message: 'This batch item no longer exists. Reopen the import before saving.' });
        const job = await ctx.db.get(item.jobId);
        if (!job || job.status === 'cancelled' || !['ready', 'imported'].includes(item.status)) {
            throw new ConvexError({ code: 'IMPORT_ITEM_NOT_READY', message: 'This batch item is no longer ready to import. Reopen the batch before saving.' });
        }
        jobs.add(item.jobId);
        if (item.status === 'imported') continue;
        const saved = await ctx.db.query('products').withIndex('by_batch_import_item', q => q.eq('batchImportItemId', itemId)).unique();
        if (!saved) throw new ConvexError({ code: 'IMPORT_NOT_SAVED', message: 'Save this product before completing its batch item.' });
        const payload = await ctx.db.query('batchImportPayloads').withIndex('by_item', q => q.eq('itemId', itemId)).unique();
        if (payload) await ctx.db.delete(payload._id);
        await ctx.db.patch(itemId, { status: 'imported', stage: 'Imported', result: undefined, resultBytes: 0, updatedAt: now });
    }
    for (const jobId of jobs) await refreshBatchJobCompletion(ctx, jobId, now);
}

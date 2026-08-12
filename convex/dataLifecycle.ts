import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCjAdminIdentity } from "./cjAdminAccess";

const clampLimit = (value: number | undefined, max = 50) =>
    Math.min(Math.max(value ?? 25, 1), max);

const isTerminalWebhook = (status: string | undefined) =>
    !status || status === "processed" || status === "failed";

const retentionKindValidator = v.union(
    v.literal("batchJobs"),
    v.literal("batchItems"),
    v.literal("descriptionAudits"),
    v.literal("webhookLogs"),
);

/** Add retention metadata to legacy rows without deleting or compacting them. */
export const backfillRetentionMetadata = mutation({
    args: { kind: retentionKindValidator, dryRun: v.boolean(), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const limit = clampLimit(args.limit, 100);
        const dayMs = 24 * 60 * 60 * 1000;
        let rows: any[] = [];
        if (args.kind === "batchJobs") {
            rows = await ctx.db.query("batchImportJobs").withIndex("by_expiry", q => q.eq("expiresAt", undefined)).take(limit);
            if (!args.dryRun) for (const row of rows) await ctx.db.patch(row._id, { expiresAt: row.updatedAt + 30 * dayMs });
        } else if (args.kind === "batchItems") {
            rows = await ctx.db.query("batchImportItems").withIndex("by_expiry", q => q.eq("expiresAt", undefined)).take(limit);
            if (!args.dryRun) for (const row of rows) await ctx.db.patch(row._id, { expiresAt: row.updatedAt + 30 * dayMs });
        } else if (args.kind === "descriptionAudits") {
            rows = await ctx.db.query("descriptionAudits").withIndex("by_debug_expiry", q => q.eq("debugExpiresAt", undefined)).take(limit);
            if (!args.dryRun) for (const row of rows) await ctx.db.patch(row._id, { debugExpiresAt: row.createdAt + 30 * dayMs });
        } else {
            rows = await ctx.db.query("cjWebhookLog").withIndex("by_expiry", q => q.eq("expiresAt", undefined)).take(limit);
            if (!args.dryRun) for (const row of rows) {
                const processedAt = Date.parse(row.processedAt);
                await ctx.db.patch(row._id, { expiresAt: (Number.isFinite(processedAt) ? processedAt : row._creationTime) + 90 * dayMs });
            }
        }
        return { kind: args.kind, dryRun: args.dryRun, candidates: rows.length, hasMore: rows.length === limit };
    },
});

/** Read-only preview of records eligible for lifecycle cleanup. */
export const report = query({
    args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const now = args.now ?? Date.now();
        const limit = clampLimit(args.limit);
        const [payloads, audits, webhookLogs, jobs, pollRuns, aiRequestUsage] = await Promise.all([
            ctx.db.query("batchImportPayloads").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("descriptionAudits").withIndex("by_debug_expiry", q => q.lt("debugExpiresAt", now)).take(limit),
            ctx.db.query("cjWebhookLog").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("batchImportJobs").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("cjInventoryPollRuns").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("aiRequestUsage").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
        ]);
        const terminalJobs = jobs.filter(job =>
            job.status === "ready" || job.status === "completed" || job.status === "cancelled",
        );
        return {
            generatedAt: now,
            limit,
            candidates: {
                batchPayloads: payloads.length,
                descriptionAuditDebugPayloads: audits.filter(audit => !audit.compactedAt).length,
                terminalWebhookLogs: webhookLogs.filter(log => isTerminalWebhook(log.status)).length,
                terminalBatchJobs: terminalJobs.length,
                inventoryPollRuns: pollRuns.length,
                aiRequestUsage: aiRequestUsage.length,
            },
            oldest: {
                batchPayloadExpiry: payloads[0]?.expiresAt,
                auditDebugExpiry: audits[0]?.debugExpiresAt,
                webhookExpiry: webhookLogs[0]?.expiresAt,
                batchJobExpiry: terminalJobs[0]?.expiresAt,
            },
        };
    },
});

/**
 * Bounded lifecycle worker. `dryRun` is mandatory and production cleanup must
 * be previewed with report/`dryRun: true` before an approved execution.
 */
export const cleanup = mutation({
    args: {
        dryRun: v.boolean(),
        now: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const now = args.now ?? Date.now();
        const limit = clampLimit(args.limit);
        const [payloads, audits, webhookLogs, jobs, pollRuns, aiRequestUsage] = await Promise.all([
            ctx.db.query("batchImportPayloads").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("descriptionAudits").withIndex("by_debug_expiry", q => q.lt("debugExpiresAt", now)).take(limit),
            ctx.db.query("cjWebhookLog").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("batchImportJobs").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(Math.min(limit, 10)),
            ctx.db.query("cjInventoryPollRuns").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
            ctx.db.query("aiRequestUsage").withIndex("by_expiry", q => q.lt("expiresAt", now)).take(limit),
        ]);
        const terminalLogs = webhookLogs.filter(log => isTerminalWebhook(log.status));
        const auditsToCompact = audits.filter(audit => !audit.compactedAt);
        const terminalJobs = jobs.filter(job =>
            job.status === "ready" || job.status === "completed" || job.status === "cancelled",
        );
        let batchItems = 0;
        let batchJobsDeleted = 0;
        let batchJobsDeferred = 0;

        if (!args.dryRun) {
            for (const payload of payloads) await ctx.db.delete(payload._id);
            for (const audit of auditsToCompact) {
                await ctx.db.patch(audit._id, {
                    sourceSnapshot: {
                        compacted: true,
                        sourceSnapshotHash: audit.sourceSnapshotHash,
                        sourceUrl: audit.sourceUrl,
                        sourceDomain: audit.sourceDomain,
                    },
                    generatedDraft: undefined,
                    rawModelResponse: undefined,
                    compactedAt: now,
                });
            }
            for (const log of terminalLogs) await ctx.db.delete(log._id);
            for (const run of pollRuns) await ctx.db.delete(run._id);
            for (const usage of aiRequestUsage) await ctx.db.delete(usage._id);
            for (const job of terminalJobs) {
                const items = await ctx.db.query("batchImportItems")
                    .withIndex("by_job", q => q.eq("jobId", job._id))
                    .take(200);
                for (const item of items) {
                    const payload = await ctx.db.query("batchImportPayloads")
                        .withIndex("by_item", q => q.eq("itemId", item._id))
                        .unique();
                    if (payload) await ctx.db.delete(payload._id);
                    await ctx.db.delete(item._id);
                    batchItems++;
                }
                // A legacy job may exceed today's 200-item create limit. Keep
                // the parent until a later bounded pass removes every child.
                const remainingItem = await ctx.db.query("batchImportItems")
                    .withIndex("by_job", q => q.eq("jobId", job._id))
                    .first();
                if (remainingItem) {
                    batchJobsDeferred++;
                } else {
                    await ctx.db.delete(job._id);
                    batchJobsDeleted++;
                }
            }
        } else {
            for (const job of terminalJobs) {
                batchItems += (await ctx.db.query("batchImportItems")
                    .withIndex("by_job", q => q.eq("jobId", job._id))
                    .take(200)).length;
            }
        }

        return {
            dryRun: args.dryRun,
            eligible: {
                batchPayloads: payloads.length,
                descriptionAuditDebugPayloads: auditsToCompact.length,
                terminalWebhookLogs: terminalLogs.length,
                terminalBatchJobs: terminalJobs.length,
                terminalBatchJobsDeleted: args.dryRun ? 0 : batchJobsDeleted,
                terminalBatchJobsDeferred: batchJobsDeferred,
                terminalBatchItems: batchItems,
                inventoryPollRuns: pollRuns.length,
                aiRequestUsage: aiRequestUsage.length,
            },
        };
    },
});

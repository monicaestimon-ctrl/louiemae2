import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireCjAdminIdentity } from "./cjAdminAccess";
import {
    getBatchImportRetryDelayMs,
    isUpstreamRateLimitError,
    MAX_BATCH_IMPORT_ATTEMPTS,
} from "../lib/batchImportRetry";
import { isObsoleteBatchImportError } from "../lib/batchImportObsolete";

const FETCH_CONCURRENCY = 3;
const REVIEW_BATCH_SIZE = 12;

const normalizeUrl = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    return `https://${trimmed}`;
};

const hasOpenBatchWork = (item: { status: string }): boolean =>
    ["pending", "fetching", "ready", "error"].includes(item.status);

const refreshJobCompletion = async (ctx: any, jobId: Id<"batchImportJobs">, now = Date.now()) => {
    const remaining = await ctx.db.query("batchImportItems").withIndex("by_job", (q: any) => q.eq("jobId", jobId)).collect();
    const hasOpenWork = remaining.some(hasOpenBatchWork);
    if (!hasOpenWork) await ctx.db.patch(jobId, { status: "completed", updatedAt: now });
};

export const create = mutation({
    args: { urls: v.array(v.string()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const urls = [...new Set(args.urls.map(normalizeUrl).filter(Boolean))];
        if (urls.length === 0) throw new Error("Paste at least one product URL.");
        if (urls.length > 200) throw new Error(`A batch can contain up to 200 unique URLs. This paste contains ${urls.length}.`);

        const now = Date.now();
        const jobId = await ctx.db.insert("batchImportJobs", {
            status: "processing",
            total: urls.length,
            fetchConcurrency: FETCH_CONCURRENCY,
            reviewBatchSize: REVIEW_BATCH_SIZE,
            createdAt: now,
            updatedAt: now,
        });

        const itemIds: Id<"batchImportItems">[] = [];
        for (let position = 0; position < urls.length; position++) {
            itemIds.push(await ctx.db.insert("batchImportItems", {
                jobId,
                position,
                inputUrl: urls[position],
                normalizedUrl: urls[position],
                status: position < FETCH_CONCURRENCY ? "fetching" : "pending",
                stage: position < FETCH_CONCURRENCY ? "Resolving source link" : "Waiting",
                attempts: position < FETCH_CONCURRENCY ? 1 : 0,
                createdAt: now,
                updatedAt: now,
            }));
        }

        for (const itemId of itemIds.slice(0, FETCH_CONCURRENCY)) {
            await ctx.scheduler.runAfter(0, internal.batchImports.processItem, { itemId });
        }
        return jobId;
    },
});

export const getJob = query({
    args: { jobId: v.id("batchImportJobs") },
    handler: async (ctx, args) => { await requireCjAdminIdentity(ctx); return ctx.db.get(args.jobId); },
});

export const getItems = query({
    args: { jobId: v.id("batchImportJobs") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const items = await ctx.db.query("batchImportItems").withIndex("by_job", q => q.eq("jobId", args.jobId)).collect();
        let readyResultsIncluded = 0;
        return items.sort((a, b) => a.position - b.position).map((item) => {
            if (item.status !== "ready" || readyResultsIncluded >= REVIEW_BATCH_SIZE) {
                const { result, ...summary } = item;
                return summary;
            }
            readyResultsIncluded += 1;
            return item;
        });
    },
});

export const getLatest = query({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const [processing, ready] = await Promise.all([
            ctx.db.query("batchImportJobs").withIndex("by_status", q => q.eq("status", "processing")).order("desc").first(),
            ctx.db.query("batchImportJobs").withIndex("by_status", q => q.eq("status", "ready")).order("desc").first(),
        ]);
        if (!processing) return ready;
        if (!ready) return processing;
        return processing.updatedAt >= ready.updatedAt ? processing : ready;
    },
});

const clearBatchJob = async (ctx: any, jobId: Id<"batchImportJobs">) => {
    const now = Date.now();
    const items = await ctx.db.query("batchImportItems").withIndex("by_job", (q: any) => q.eq("jobId", jobId)).collect();
    let cleared = 0;
    for (const item of items) {
        if (!hasOpenBatchWork(item)) continue;
        await ctx.db.patch(item._id, {
            status: "skipped",
            stage: "Cleared by admin",
            result: undefined,
            error: undefined,
            updatedAt: now,
        });
        cleared += 1;
    }
    await ctx.db.patch(jobId, { status: "cancelled", updatedAt: now });
    return { cleared };
};

export const cancel = mutation({
    args: { jobId: v.id("batchImportJobs") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        return clearBatchJob(ctx, args.jobId);
    },
});

export const cancelLatest = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const [processing, ready] = await Promise.all([
            ctx.db.query("batchImportJobs").withIndex("by_status", q => q.eq("status", "processing")).order("desc").first(),
            ctx.db.query("batchImportJobs").withIndex("by_status", q => q.eq("status", "ready")).order("desc").first(),
        ]);
        const job = !processing ? ready : !ready ? processing : processing.updatedAt >= ready.updatedAt ? processing : ready;
        if (!job) return { cleared: 0 };
        return clearBatchJob(ctx, job._id);
    },
});

export const setStage = internalMutation({
    args: { itemId: v.id("batchImportItems"), stage: v.string() },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (item?.status === "fetching") await ctx.db.patch(args.itemId, { stage: args.stage, updatedAt: Date.now() });
    },
});

export const prepareAutomaticRetry = internalMutation({
    args: { itemId: v.id("batchImportItems"), delayMs: v.number() },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item || item.status !== "fetching") return false;
        await ctx.db.patch(args.itemId, {
            stage: `Provider busy — retrying in ${Math.ceil(args.delayMs / 1000)}s`,
            error: undefined,
            attempts: item.attempts + 1,
            updatedAt: Date.now(),
        });
        return true;
    },
});

export const finishItem = internalMutation({
    args: {
        itemId: v.id("batchImportItems"),
        result: v.optional(v.any()),
        resolvedUrl: v.optional(v.string()),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item || item.status !== "fetching") return;
        const job = await ctx.db.get(item.jobId);
        if (job?.status === "cancelled") return;
        const now = Date.now();
        await ctx.db.patch(args.itemId, args.error ? {
            status: "error",
            stage: "Needs attention",
            error: args.error,
            updatedAt: now,
        } : {
            status: "ready",
            stage: "Ready to review",
            result: args.result,
            resolvedUrl: args.resolvedUrl,
            error: undefined,
            updatedAt: now,
        });

        const pending = await ctx.db.query("batchImportItems")
            .withIndex("by_job_status", q => q.eq("jobId", item.jobId).eq("status", "pending"))
            .first();
        if (pending) {
            await ctx.db.patch(pending._id, {
                status: "fetching",
                stage: "Resolving source link",
                attempts: pending.attempts + 1,
                updatedAt: now,
            });
            await ctx.scheduler.runAfter(0, internal.batchImports.processItem, { itemId: pending._id });
        }

        const stillActive = await ctx.db.query("batchImportItems")
            .withIndex("by_job_status", q => q.eq("jobId", item.jobId).eq("status", "fetching"))
            .first();
        const stillPending = await ctx.db.query("batchImportItems")
            .withIndex("by_job_status", q => q.eq("jobId", item.jobId).eq("status", "pending"))
            .first();
        await ctx.db.patch(item.jobId, {
            status: !stillActive && !stillPending ? "ready" : "processing",
            updatedAt: now,
        });
    },
});

export const processItem = internalAction({
    args: { itemId: v.id("batchImportItems") },
    handler: async (ctx, args): Promise<void> => {
        const item = await ctx.runQuery(internal.batchImports.getItemForWorker, { itemId: args.itemId });
        if (!item || item.status !== "fetching") return;
        try {
            await ctx.runMutation(internal.batchImports.setStage, { itemId: args.itemId, stage: "Extracting product details" });
            const result: any = await ctx.runAction(api.scraper.scrapeProduct, { url: item.normalizedUrl });
            await ctx.runMutation(internal.batchImports.finishItem, {
                itemId: args.itemId,
                result,
                resolvedUrl: result?.resolvedUrl,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Product import failed";
            if (isUpstreamRateLimitError(errorMessage) && item.attempts < MAX_BATCH_IMPORT_ATTEMPTS) {
                const delayMs = getBatchImportRetryDelayMs(item.attempts, item.position);
                const shouldRetry = await ctx.runMutation(internal.batchImports.prepareAutomaticRetry, {
                    itemId: args.itemId,
                    delayMs,
                });
                if (shouldRetry) {
                    await ctx.scheduler.runAfter(delayMs, internal.batchImports.processItem, { itemId: args.itemId });
                    return;
                }
            }
            await ctx.runMutation(internal.batchImports.finishItem, {
                itemId: args.itemId,
                error: errorMessage,
            });
        }
    },
});

export const getItemForWorker = internalQuery({
    args: { itemId: v.id("batchImportItems") },
    handler: (ctx, args) => ctx.db.get(args.itemId),
});

export const retry = mutation({
    args: { itemId: v.id("batchImportItems") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const item = await ctx.db.get(args.itemId);
        if (!item || item.status !== "error") return;
        const active = await ctx.db.query("batchImportItems")
            .withIndex("by_job_status", q => q.eq("jobId", item.jobId).eq("status", "fetching"))
            .collect();
        const canStartNow = active.length < FETCH_CONCURRENCY;
        await ctx.db.patch(args.itemId, {
            status: canStartNow ? "fetching" : "pending",
            stage: canStartNow ? "Resolving source link" : "Waiting to retry",
            error: undefined,
            attempts: item.attempts + 1,
            updatedAt: Date.now(),
        });
        await ctx.db.patch(item.jobId, { status: "processing", updatedAt: Date.now() });
        if (canStartNow) await ctx.scheduler.runAfter(0, internal.batchImports.processItem, { itemId: args.itemId });
    },
});

export const markPreparationError = mutation({
    args: { itemId: v.id("batchImportItems"), error: v.string() },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const item = await ctx.db.get(args.itemId);
        if (item?.status !== "ready") return;
        await ctx.db.patch(args.itemId, {
            status: "error",
            stage: "Needs attention",
            error: args.error.slice(0, 500),
            updatedAt: Date.now(),
        });
    },
});

export const markImported = mutation({
    args: { itemIds: v.array(v.id("batchImportItems")) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const now = Date.now();
        const jobIds = new Set<Id<"batchImportJobs">>();
        for (const itemId of args.itemIds) {
            const item = await ctx.db.get(itemId);
            if (item) jobIds.add(item.jobId);
            if (item?.status === "ready") await ctx.db.patch(itemId, { status: "imported", stage: "Imported", updatedAt: now });
        }
        for (const jobId of jobIds) {
            await refreshJobCompletion(ctx, jobId, now);
        }
    },
});

export const skipObsoleteErrors = mutation({
    args: { jobId: v.id("batchImportJobs") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const now = Date.now();
        const items = await ctx.db.query("batchImportItems").withIndex("by_job", q => q.eq("jobId", args.jobId)).collect();
        let skipped = 0;
        for (const item of items) {
            if (!isObsoleteBatchImportError(item)) continue;
            await ctx.db.patch(item._id, {
                status: "skipped",
                stage: "Skipped old wrapped URL fragment",
                error: undefined,
                updatedAt: now,
            });
            skipped += 1;
        }
        if (skipped > 0) await refreshJobCompletion(ctx, args.jobId, now);
        return { skipped };
    },
});

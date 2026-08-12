import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
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
import {
    BATCH_IMPORT_PAYLOAD_VERSION,
    assertBatchImportPayloadSize,
    compactBatchImportResult,
} from "../lib/batchImportPayload";

const FETCH_CONCURRENCY = 3;
const REVIEW_BATCH_SIZE = 12;
const BATCH_SUMMARY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_PAYLOAD_RETENTION_MS = 72 * 60 * 60 * 1000;

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
            expiresAt: now + BATCH_SUMMARY_RETENTION_MS,
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
                expiresAt: now + BATCH_SUMMARY_RETENTION_MS,
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
        const items = await ctx.db.query("batchImportItems").withIndex("by_job", q => q.eq("jobId", args.jobId)).take(200);
        let readyResultsIncluded = 0;
        const response = [];
        for (const item of items.sort((a, b) => a.position - b.position)) {
            const { result: legacyResult, ...summary } = item;
            if (item.status !== "ready" || readyResultsIncluded >= REVIEW_BATCH_SIZE) {
                response.push(summary);
                continue;
            }
            readyResultsIncluded += 1;
            const payload = await ctx.db.query("batchImportPayloads")
                .withIndex("by_item", q => q.eq("itemId", item._id))
                .unique();
            response.push({ ...summary, result: payload?.result ?? legacyResult });
        }
        return response;
    },
});

export const getItemDetail = query({
    args: { itemId: v.id("batchImportItems") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const item = await ctx.db.get(args.itemId);
        if (!item) return null;
        const payload = await ctx.db.query("batchImportPayloads")
            .withIndex("by_item", q => q.eq("itemId", args.itemId))
            .unique();
        const { result: legacyResult, ...summary } = item;
        return { ...summary, result: payload?.result ?? legacyResult };
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
        const payload = await ctx.db.query("batchImportPayloads")
            .withIndex("by_item", (q: any) => q.eq("itemId", item._id))
            .unique();
        if (payload) await ctx.db.delete(payload._id);
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
        if (!args.error && args.result) {
            const existingPayload = await ctx.db.query("batchImportPayloads")
                .withIndex("by_item", q => q.eq("itemId", args.itemId))
                .unique();
            const byteLength = assertBatchImportPayloadSize(args.result);
            const payload = {
                itemId: args.itemId,
                jobId: item.jobId,
                version: BATCH_IMPORT_PAYLOAD_VERSION,
                byteLength,
                result: args.result,
                createdAt: now,
                expiresAt: now + BATCH_PAYLOAD_RETENTION_MS,
            };
            if (existingPayload) await ctx.db.replace(existingPayload._id, payload);
            else await ctx.db.insert("batchImportPayloads", payload);
        }
        await ctx.db.patch(args.itemId, args.error ? {
            status: "error",
            stage: "Needs attention",
            error: args.error,
            updatedAt: now,
        } : {
            status: "ready",
            stage: "Ready to review",
            result: undefined,
            resultVersion: BATCH_IMPORT_PAYLOAD_VERSION,
            resultBytes: args.result ? assertBatchImportPayloadSize(args.result) : 0,
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
            const compactResult = compactBatchImportResult(result);
            assertBatchImportPayloadSize(compactResult);
            await ctx.runMutation(internal.batchImports.finishItem, {
                itemId: args.itemId,
                result: compactResult,
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
            if (item?.status === "ready") {
                const payload = await ctx.db.query("batchImportPayloads")
                    .withIndex("by_item", q => q.eq("itemId", itemId))
                    .unique();
                if (payload) await ctx.db.delete(payload._id);
                await ctx.db.patch(itemId, {
                    status: "imported",
                    stage: "Imported",
                    result: undefined,
                    resultBytes: 0,
                    updatedAt: now,
                });
            }
        }
        for (const jobId of jobIds) {
            await refreshJobCompletion(ctx, jobId, now);
        }
    },
});

/**
 * Safe dual-read migration for legacy inline payloads. Dry-run is the default;
 * execute in small batches after the compact review flow has been verified.
 */
export const migrateLegacyPayloads = mutation({
    args: { dryRun: v.boolean(), paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), 25);
        const page = await ctx.db.query("batchImportItems").paginate({
            numItems,
            cursor: args.paginationOpts.cursor,
        });
        const candidates = page.page.filter(item => item.result !== undefined);
        let bytesBefore = 0;
        let bytesAfter = 0;
        for (const item of candidates) {
            const compact = compactBatchImportResult(item.result);
            const compactBytes = assertBatchImportPayloadSize(compact);
            bytesBefore += new TextEncoder().encode(JSON.stringify(item.result)).byteLength;
            bytesAfter += compactBytes;
            if (args.dryRun) continue;
            const existing = await ctx.db.query("batchImportPayloads")
                .withIndex("by_item", q => q.eq("itemId", item._id))
                .unique();
            const payload = {
                itemId: item._id,
                jobId: item.jobId,
                version: BATCH_IMPORT_PAYLOAD_VERSION,
                byteLength: compactBytes,
                result: compact,
                createdAt: Date.now(),
                expiresAt: Date.now() + BATCH_PAYLOAD_RETENTION_MS,
            };
            if (existing) await ctx.db.replace(existing._id, payload);
            else await ctx.db.insert("batchImportPayloads", payload);
            await ctx.db.patch(item._id, {
                result: undefined,
                resultVersion: BATCH_IMPORT_PAYLOAD_VERSION,
                resultBytes: compactBytes,
            });
        }
        return {
            dryRun: args.dryRun,
            scanned: page.page.length,
            candidates: candidates.length,
            bytesBefore,
            bytesAfter,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
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

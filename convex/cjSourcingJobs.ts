import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { buildCjSourcingPayload, hashCjSourcingPayload } from "../lib/cjSourcing";

const DISPATCH_BATCH_SIZE = 20;
const JOB_LEASE_MS = 5 * 60 * 1000;
const REQUEST_INTERVAL_MS = 1_100;
const WORKER_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type JobState = Doc<"cjSourcingJobs">["state"];
type JobSource = "import" | "migration";
type WorkKind = "submit" | "poll" | "catalog";

const projectionForState = (state: JobState) => {
    if (state === "fulfillment_ready") {
        return { legacyStatus: "approved" as const, readiness: "ready" as const, reasons: [] as string[] };
    }
    if (state === "sourced" || state === "mapping_required") {
        return {
            legacyStatus: "approved" as const,
            readiness: "mapping_required" as const,
            reasons: ["CJ_VARIANT_MAPPING_INCOMPLETE"],
        };
    }
    if (state === "rejected" || state === "dead_letter" || state === "canceled") {
        return {
            legacyStatus: "rejected" as const,
            readiness: "blocked" as const,
            reasons: [state === "dead_letter" ? "CJ_DEAD_LETTER" : `CJ_${state.toUpperCase()}`],
        };
    }
    return {
        legacyStatus: "pending" as const,
        readiness: "not_ready" as const,
        reasons: state === "needs_input" ? ["CJ_SOURCE_INPUT_INVALID"] : [`CJ_${state.toUpperCase()}`],
    };
};

const projectJobToProduct = async (
    ctx: MutationCtx,
    job: Pick<Doc<"cjSourcingJobs">, "_id" | "state" | "currentSourcingId" | "cjProductId" | "lastErrorMessage">,
    productId: Id<"products">,
) => {
    const projection = projectionForState(job.state);
    await ctx.db.patch(productId, {
        cjSourcingJobId: job._id,
        cjSourcingState: job.state,
        cjFulfillmentReadiness: projection.readiness,
        cjReadinessReasons: projection.reasons,
        cjProjectionUpdatedAt: Date.now(),
        cjSourcingStatus: projection.legacyStatus,
        ...(job.currentSourcingId ? { cjSourcingId: job.currentSourcingId } : {}),
        ...(job.cjProductId ? { cjProductId: job.cjProductId } : {}),
        cjSourcingError: job.lastErrorMessage,
    });
};

const ensureJobRecord = async (
    ctx: MutationCtx,
    productId: Id<"products">,
    source: JobSource,
) => {
    const existing = await ctx.db
        .query("cjSourcingJobs")
        .withIndex("by_product_id", (q) => q.eq("productId", productId))
        .unique();
    if (existing) return existing._id;

    const product = await ctx.db.get(productId);
    if (!product || product.cjSourcingStatus === "none") return null;

    const now = Date.now();
    const generation = 1;
    const payloadResult = buildCjSourcingPayload({
        productName: product.name,
        productImage: product.images?.[0],
        productUrl: product.sourceUrl ?? "",
        remark: product.description,
        price: product.price,
        thirdProductId: `lm:${productId}:g${generation}`,
    });
    const sourceSnapshot = {
        productName: product.name.trim(),
        productImage: product.images?.[0]?.trim() || undefined,
        productUrl: product.sourceUrl?.trim() ?? "",
        remark: product.description?.trim().slice(0, 200) || undefined,
        price: Number.isFinite(product.price) ? product.price : undefined,
    };
    const state: JobState = "code" in payloadResult
        ? "needs_input"
        : product.cjSourcingId
            ? "submitted"
            : "queued";
    const sourceSnapshotHash = "code" in payloadResult
        ? `invalid:${payloadResult.code}`
        : await hashCjSourcingPayload(payloadResult.payload);

    const jobId = await ctx.db.insert("cjSourcingJobs", {
        productId,
        state,
        generation,
        currentSourcingId: product.cjSourcingId,
        cjProductId: product.cjProductId,
        sourceSnapshot,
        sourceSnapshotHash,
        attemptCount: 0,
        transientFailureCount: 0,
        nextAttemptAt: state === "needs_input" ? undefined : now,
        submittedAt: product.cjSubmittedAt ? Date.parse(product.cjSubmittedAt) : undefined,
        lastErrorCode: "code" in payloadResult ? payloadResult.code : undefined,
        lastErrorMessage: "code" in payloadResult ? payloadResult.message : undefined,
        manualReviewReason: "code" in payloadResult ? payloadResult.message : undefined,
        createdAt: now,
        updatedAt: now,
        version: 1,
    });
    const job = await ctx.db.get(jobId);
    if (job) await projectJobToProduct(ctx, job, productId);

    if (state !== "needs_input") {
        await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.dispatchDueJobs, {});
    }
    console.log(`CJ sourcing job created: productId=${productId} jobId=${jobId} state=${state} source=${source}`);
    return jobId;
};

export const ensureJobForProduct = internalMutation({
    args: {
        productId: v.id("products"),
        source: v.union(v.literal("import"), v.literal("migration")),
    },
    handler: async (ctx, args) => ensureJobRecord(ctx, args.productId, args.source),
});

export const requestAdminReconciliation = internalMutation({
    args: {
        productId: v.id("products"),
        reason: v.string(),
    },
    handler: async (ctx, args) => {
        const jobId = await ensureJobRecord(ctx, args.productId, "migration");
        if (!jobId) return { ok: false, code: "NO_CJ_JOB", message: "Product does not require CJ sourcing." };
        const job = await ctx.db.get(jobId);
        const product = await ctx.db.get(args.productId);
        if (!job || !product) return { ok: false, code: "NOT_FOUND", message: "CJ sourcing job was not found." };
        const now = Date.now();

        if (job.state === "fulfillment_ready") {
            return { ok: true, code: "ALREADY_READY", message: "This product is already verified and fulfillment-ready." };
        }

        if ((job.state === "sourced" || job.state === "mapping_required") && job.cjProductId) {
            await ctx.db.patch(job._id, {
                state: "awaiting_catalog",
                nextAttemptAt: now,
                leaseToken: undefined,
                leaseExpiresAt: undefined,
                manualReviewReason: args.reason.slice(0, 500),
                updatedAt: now,
                version: job.version + 1,
            });
            await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.dispatchDueJobs, {});
            return { ok: true, code: "CATALOG_VERIFICATION_QUEUED", message: "CJ catalog verification was queued." };
        }

        if (job.currentSourcingId) {
            await ctx.db.patch(job._id, {
                state: "submitted",
                nextAttemptAt: now,
                leaseToken: undefined,
                leaseExpiresAt: undefined,
                manualReviewReason: args.reason.slice(0, 500),
                updatedAt: now,
                version: job.version + 1,
            });
            await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.dispatchDueJobs, {});
            return { ok: true, code: "RECONCILIATION_QUEUED", message: "Existing CJ ticket queued for a safe status check." };
        }

        const activeAttempt = job.activeAttemptId ? await ctx.db.get(job.activeAttemptId) : null;
        if (activeAttempt?.state === "sending" || activeAttempt?.state === "ambiguous" || job.state === "reconciliation_required") {
            return {
                ok: false,
                code: "AMBIGUOUS_SUBMISSION",
                message: "CJ may already have received this request. Reconcile it before creating another ticket.",
            };
        }

        const nextGeneration = job.state === "rejected" || job.state === "dead_letter"
            ? job.generation + 1
            : job.generation;
        const payloadResult = buildCjSourcingPayload({
            productName: product.name,
            productImage: product.images?.[0],
            productUrl: product.sourceUrl ?? "",
            remark: product.description,
            price: product.price,
            thirdProductId: `lm:${product._id}:g${nextGeneration}`,
        });
        if ("code" in payloadResult) {
            await ctx.db.patch(job._id, {
                state: "needs_input",
                nextAttemptAt: undefined,
                lastErrorCode: payloadResult.code,
                lastErrorMessage: payloadResult.message,
                manualReviewReason: payloadResult.message,
                updatedAt: now,
                version: job.version + 1,
            });
            return { ok: false, code: payloadResult.code, message: payloadResult.message };
        }

        if (activeAttempt && nextGeneration !== job.generation && activeAttempt.state !== "completed") {
            await ctx.db.patch(activeAttempt._id, { state: "superseded", updatedAt: now });
        }
        await ctx.db.patch(job._id, {
            state: "queued",
            generation: nextGeneration,
            activeAttemptId: nextGeneration === job.generation ? job.activeAttemptId : undefined,
            sourceSnapshot: {
                productName: payloadResult.payload.productName,
                productImage: payloadResult.payload.productImage,
                productUrl: payloadResult.payload.productUrl,
                remark: payloadResult.payload.remark,
                price: product.price,
            },
            sourceSnapshotHash: await hashCjSourcingPayload(payloadResult.payload),
            nextAttemptAt: now,
            rejectedAt: nextGeneration === job.generation ? job.rejectedAt : undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            manualReviewReason: args.reason.slice(0, 500),
            updatedAt: now,
            version: job.version + 1,
        });
        await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.dispatchDueJobs, {});
        return { ok: true, code: "QUEUED", message: "CJ sourcing work was queued safely." };
    },
});

export const backfillLegacyPendingJobs = internalMutation({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 25, 1), 50);
        const products = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status_job", (q) =>
                q.eq("cjSourcingStatus", "pending").eq("cjSourcingJobId", undefined))
            .take(limit);
        let created = 0;
        for (const product of products) {
            if (await ensureJobRecord(ctx, product._id, "migration")) created++;
        }
        return { scanned: products.length, created };
    },
});

export const reserveApiRequestSlot = internalMutation({
    args: { operation: v.string() },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("cjApiControl")
            .withIndex("by_key", (q) => q.eq("key", "primary"))
            .unique();
        const reservedAt = Math.max(now, existing?.nextRequestSlotAt ?? now);
        const nextRequestSlotAt = reservedAt + REQUEST_INTERVAL_MS;
        if (existing) {
            await ctx.db.patch(existing._id, { nextRequestSlotAt, updatedAt: now });
        } else {
            await ctx.db.insert("cjApiControl", {
                key: "primary",
                nextRequestSlotAt,
                circuitState: "closed",
                consecutiveFailures: 0,
                updatedAt: now,
            });
        }
        return { reservedAt, operation: args.operation };
    },
});

export const blockSourceQuota = internalMutation({
    args: {
        reason: v.string(),
        blockedUntil: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("cjApiControl")
            .withIndex("by_key", (q) => q.eq("key", "primary"))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                sourceQuotaBlockedUntil: Math.max(existing.sourceQuotaBlockedUntil ?? 0, args.blockedUntil),
                sourceQuotaReason: args.reason.slice(0, 500),
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("cjApiControl", {
                key: "primary",
                nextRequestSlotAt: now,
                sourceQuotaBlockedUntil: args.blockedUntil,
                sourceQuotaReason: args.reason.slice(0, 500),
                circuitState: "closed",
                consecutiveFailures: 0,
                updatedAt: now,
            });
        }
    },
});

export const acquireTokenRefreshLease = internalMutation({
    args: { leaseToken: v.string(), ttlMs: v.number() },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("cjApiControl")
            .withIndex("by_key", (q) => q.eq("key", "primary"))
            .unique();
        if (existing?.tokenRefreshLeaseToken && (existing.tokenRefreshLeaseExpiresAt ?? 0) > now) {
            return { acquired: false, expiresAt: existing.tokenRefreshLeaseExpiresAt };
        }
        const expiresAt = now + Math.min(Math.max(args.ttlMs, 5_000), 60_000);
        if (existing) {
            await ctx.db.patch(existing._id, {
                tokenRefreshLeaseToken: args.leaseToken,
                tokenRefreshLeaseExpiresAt: expiresAt,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("cjApiControl", {
                key: "primary",
                nextRequestSlotAt: now,
                circuitState: "closed",
                consecutiveFailures: 0,
                tokenRefreshLeaseToken: args.leaseToken,
                tokenRefreshLeaseExpiresAt: expiresAt,
                updatedAt: now,
            });
        }
        return { acquired: true, expiresAt };
    },
});

export const releaseTokenRefreshLease = internalMutation({
    args: { leaseToken: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("cjApiControl")
            .withIndex("by_key", (q) => q.eq("key", "primary"))
            .unique();
        if (!existing || existing.tokenRefreshLeaseToken !== args.leaseToken) return false;
        await ctx.db.patch(existing._id, {
            tokenRefreshLeaseToken: undefined,
            tokenRefreshLeaseExpiresAt: undefined,
            updatedAt: Date.now(),
        });
        return true;
    },
});

const createPreparedAttempt = async (
    ctx: MutationCtx,
    job: Doc<"cjSourcingJobs">,
) => {
    const existing = await ctx.db
        .query("cjSourcingAttempts")
        .withIndex("by_job_generation", (q) => q.eq("jobId", job._id).eq("generation", job.generation))
        .unique();
    if (existing) return existing;

    const thirdProductId = `lm:${job.productId}:g${job.generation}`;
    const payloadResult = buildCjSourcingPayload({
        ...job.sourceSnapshot,
        thirdProductId,
    });
    if ("code" in payloadResult) return null;
    const now = Date.now();
    const attemptId = await ctx.db.insert("cjSourcingAttempts", {
        jobId: job._id,
        productId: job.productId,
        generation: job.generation,
        attemptKey: `${job._id}:g${job.generation}`,
        thirdProductId,
        state: "prepared",
        payloadHash: await hashCjSourcingPayload(payloadResult.payload),
        payloadSnapshot: payloadResult.payload,
        createdBy: job.attemptCount === 0 ? "migration" : "cron",
        createdAt: now,
        updatedAt: now,
    });
    return await ctx.db.get(attemptId);
};

export const dispatchDueJobs = internalMutation({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();
        const runId = `dispatch:${now}`;
        const runRecordId = await ctx.db.insert("cjWorkerRuns", {
            runId,
            type: "dispatch",
            startedAt: now,
            status: "running",
            claimed: 0,
            processed: 0,
            succeeded: 0,
            deferred: 0,
            failed: 0,
            deadLettered: 0,
            expiresAt: now + WORKER_RUN_RETENTION_MS,
        });
        const apiControl = await ctx.db
            .query("cjApiControl")
            .withIndex("by_key", (q) => q.eq("key", "primary"))
            .unique();
        const sourceQuotaBlockedUntil = (apiControl?.sourceQuotaBlockedUntil ?? 0) > now
            ? apiControl?.sourceQuotaBlockedUntil
            : undefined;

        const expiredSubmitting = await ctx.db
            .query("cjSourcingJobs")
            .withIndex("by_state_lease_expiry", (q) => q.eq("state", "submitting").lte("leaseExpiresAt", now))
            .take(10);
        for (const job of expiredSubmitting) {
            const attempt = job.activeAttemptId ? await ctx.db.get(job.activeAttemptId) : null;
            const ambiguous = attempt?.state === "sending";
            await ctx.db.patch(job._id, {
                state: ambiguous ? "reconciliation_required" : "queued",
                nextAttemptAt: ambiguous ? undefined : now,
                leaseToken: undefined,
                leaseExpiresAt: undefined,
                manualReviewReason: ambiguous
                    ? "Submission worker lost its lease after dispatch may have begun."
                    : undefined,
                lastErrorCode: ambiguous ? "REQUEST_AMBIGUOUS" : undefined,
                updatedAt: now,
                version: job.version + 1,
            });
        }
        let recoveredReadLeases = 0;
        for (const state of ["submitted", "processing", "awaiting_catalog", "retry_wait"] as const) {
            const rows = await ctx.db
                .query("cjSourcingJobs")
                .withIndex("by_state_lease_expiry", (q) => q.eq("state", state).lte("leaseExpiresAt", now))
                .take(10);
            for (const job of rows) {
                if (!job.leaseToken) continue;
                await ctx.db.patch(job._id, {
                    nextAttemptAt: now,
                    leaseToken: undefined,
                    leaseExpiresAt: undefined,
                    lastErrorCode: "WORKER_LEASE_EXPIRED",
                    lastErrorMessage: "A read-only CJ worker lease expired and was safely rescheduled.",
                    updatedAt: now,
                    version: job.version + 1,
                });
                recoveredReadLeases++;
            }
        }

        const due: Doc<"cjSourcingJobs">[] = [];
        for (const state of ["submitted", "processing", "awaiting_catalog", "retry_wait", "queued"] as const) {
            if (due.length >= DISPATCH_BATCH_SIZE) break;
            const rows = await ctx.db
                .query("cjSourcingJobs")
                .withIndex("by_state_next_attempt", (q) => q.eq("state", state).lte("nextAttemptAt", now))
                .take(DISPATCH_BATCH_SIZE - due.length);
            due.push(...rows);
        }

        let claimed = 0;
        for (const job of due) {
            if (job.leaseToken && (job.leaseExpiresAt ?? 0) > now) continue;
            let kind: WorkKind;
            let attemptId = job.activeAttemptId;
            if ((job.state === "queued" || job.state === "retry_wait") && !job.currentSourcingId) {
                if (sourceQuotaBlockedUntil) {
                    await ctx.db.patch(job._id, {
                        nextAttemptAt: sourceQuotaBlockedUntil,
                        lastErrorCode: "SOURCE_DAILY_LIMIT",
                        lastErrorMessage: apiControl?.sourceQuotaReason || "CJ daily sourcing allowance is temporarily exhausted.",
                        updatedAt: now,
                        version: job.version + 1,
                    });
                    continue;
                }
                const attempt = await createPreparedAttempt(ctx, job);
                if (!attempt) {
                    const nextState: JobState = "needs_input";
                    await ctx.db.patch(job._id, {
                        state: nextState,
                        nextAttemptAt: undefined,
                        lastErrorCode: "SOURCE_PAYLOAD_INVALID",
                        lastErrorMessage: "The current product data cannot form a valid CJ sourcing request.",
                        updatedAt: now,
                        version: job.version + 1,
                    });
                    continue;
                }
                attemptId = attempt._id;
                kind = "submit";
            } else if (job.state === "awaiting_catalog" && job.cjProductId) {
                kind = "catalog";
            } else if (job.currentSourcingId) {
                kind = "poll";
            } else {
                await ctx.db.patch(job._id, {
                    state: "reconciliation_required",
                    nextAttemptAt: undefined,
                    lastErrorCode: "MISSING_CORRELATION_ID",
                    lastErrorMessage: "The sourcing job has no CJ sourcing ID to poll.",
                    manualReviewReason: "Confirm whether CJ received the request before creating a replacement.",
                    updatedAt: now,
                    version: job.version + 1,
                });
                continue;
            }

            const leaseToken = `${job._id}:${job.version + 1}:${now}`;
            await ctx.db.patch(job._id, {
                state: kind === "submit" ? "submitting" : job.state,
                activeAttemptId: attemptId,
                leaseToken,
                leaseExpiresAt: now + JOB_LEASE_MS,
                nextAttemptAt: undefined,
                updatedAt: now,
                version: job.version + 1,
            });
            await ctx.scheduler.runAfter(0, internal.cjSourcingWorkers.processSourcingJob, {
                jobId: job._id,
                leaseToken,
                kind,
            });
            claimed++;
        }

        await ctx.db.patch(runRecordId, {
            status: "completed",
            completedAt: Date.now(),
            durationMs: Date.now() - now,
            claimed,
            remaining: Math.max(0, due.length - claimed),
        });
        return { runId, claimed, recovered: expiredSubmitting.length + recoveredReadLeases };
    },
});

export const getWorkerContext = internalQuery({
    args: { jobId: v.id("cjSourcingJobs") },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job) return null;
        const product = await ctx.db.get(job.productId);
        const attempt = job.activeAttemptId ? await ctx.db.get(job.activeAttemptId) : null;
        return { job, product, attempt };
    },
});

export const markAttemptSending = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken || job.state !== "submitting" || !job.activeAttemptId) {
            return false;
        }
        const attempt = await ctx.db.get(job.activeAttemptId);
        if (!attempt || attempt.state !== "prepared") return false;
        await ctx.db.patch(attempt._id, {
            state: "sending",
            requestStartedAt: Date.now(),
            updatedAt: Date.now(),
        });
        return true;
    },
});

export const applySubmissionAccepted = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        sourcingId: v.string(),
        httpStatus: v.number(),
        cjCode: v.optional(v.string()),
        providerRequestId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken || !job.activeAttemptId) return false;
        const attempt = await ctx.db.get(job.activeAttemptId);
        if (!attempt || attempt.generation !== job.generation) return false;
        const now = Date.now();
        await ctx.db.patch(attempt._id, {
            state: "accepted",
            cjSourcingId: args.sourcingId,
            responseReceivedAt: now,
            acceptedAt: now,
            httpStatus: args.httpStatus,
            cjCode: args.cjCode,
            providerRequestId: args.providerRequestId,
            updatedAt: now,
        });
        const patch = {
            state: "submitted" as const,
            currentSourcingId: args.sourcingId,
            attemptCount: Math.max(job.attemptCount, 1),
            transientFailureCount: 0,
            submittedAt: job.submittedAt ?? now,
            nextAttemptAt: now + 10 * 60 * 1000,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            manualReviewReason: undefined,
            updatedAt: now,
            version: job.version + 1,
        };
        await ctx.db.patch(job._id, patch);
        const updated = await ctx.db.get(job._id);
        if (updated) await projectJobToProduct(ctx, updated, job.productId);
        await ctx.db.patch(job.productId, {
            cjSourcingId: args.sourcingId,
            cjSubmittedAt: new Date(now).toISOString(),
            cjSourcingError: undefined,
        });
        return true;
    },
});

export const applySubmissionFailure = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        code: v.string(),
        message: v.string(),
        ambiguous: v.boolean(),
        retryAt: v.optional(v.number()),
        httpStatus: v.optional(v.number()),
        cjCode: v.optional(v.string()),
        providerRequestId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken || !job.activeAttemptId) return false;
        const attempt = await ctx.db.get(job.activeAttemptId);
        if (!attempt) return false;
        const now = Date.now();
        await ctx.db.patch(attempt._id, {
            state: args.retryAt ? "prepared" : args.ambiguous ? "ambiguous" : "failed_terminal",
            responseReceivedAt: now,
            httpStatus: args.httpStatus,
            cjCode: args.cjCode,
            providerRequestId: args.providerRequestId,
            errorCode: args.code,
            errorMessage: args.message.slice(0, 500),
            reconciliationDeadlineAt: args.ambiguous ? now + 30 * 60 * 1000 : undefined,
            updatedAt: now,
        });
        const state: JobState = args.ambiguous
            ? "reconciliation_required"
            : args.retryAt
                ? "retry_wait"
                : "rejected";
        await ctx.db.patch(job._id, {
            state,
            nextAttemptAt: args.retryAt,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            transientFailureCount: job.transientFailureCount + (args.retryAt ? 1 : 0),
            rejectedAt: state === "rejected" ? now : job.rejectedAt,
            lastErrorCode: args.code,
            lastErrorMessage: args.message.slice(0, 500),
            manualReviewReason: args.ambiguous ? args.message.slice(0, 500) : undefined,
            updatedAt: now,
            version: job.version + 1,
        });
        const updated = await ctx.db.get(job._id);
        if (updated) await projectJobToProduct(ctx, updated, job.productId);
        return true;
    },
});

export const applyPollEvidence = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        evidence: v.union(v.literal("pending"), v.literal("processing"), v.literal("success"), v.literal("failure"), v.literal("unknown")),
        sourceStatus: v.optional(v.string()),
        statusText: v.optional(v.string()),
        cjProductId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken || !job.currentSourcingId) return false;
        const now = Date.now();
        let state: JobState;
        let nextAttemptAt: number | undefined;
        if ((args.evidence === "success" || args.evidence === "failure") && args.cjProductId) {
            state = "awaiting_catalog";
            nextAttemptAt = now;
        } else if (args.evidence === "failure") {
            const failures = job.transientFailureCount + 1;
            state = failures >= 3 ? "rejected" : "processing";
            nextAttemptAt = failures >= 3 ? undefined : now + 30 * 60 * 1000;
        } else if (args.evidence === "success") {
            state = "awaiting_catalog";
            nextAttemptAt = now + 2 * 60 * 1000;
        } else {
            state = args.evidence === "processing" ? "processing" : "submitted";
            nextAttemptAt = now + (args.evidence === "unknown" ? 30 : 15) * 60 * 1000;
        }
        await ctx.db.patch(job._id, {
            state,
            cjProductId: args.cjProductId ?? job.cjProductId,
            providerSourceStatus: args.sourceStatus,
            providerStatusText: args.statusText?.slice(0, 500),
            lastPolledAt: now,
            nextAttemptAt,
            transientFailureCount: args.evidence === "failure" && !args.cjProductId
                ? job.transientFailureCount + 1
                : 0,
            rejectedAt: state === "rejected" ? (job.rejectedAt ?? now) : job.rejectedAt,
            lastErrorCode: state === "rejected" ? "CJ_TERMINAL_REJECTION" : undefined,
            lastErrorMessage: state === "rejected" ? (args.statusText || "CJ sourcing was rejected.") : undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
            version: job.version + 1,
        });
        if (args.cjProductId || args.cjSku) {
            await ctx.db.patch(job.productId, {
                ...(args.cjProductId ? { cjProductId: args.cjProductId } : {}),
                ...(args.cjSku ? { cjSku: args.cjSku } : {}),
            });
        }
        const updated = await ctx.db.get(job._id);
        if (updated) await projectJobToProduct(ctx, updated, job.productId);
        return true;
    },
});

export const applyWebhookEvidence = internalMutation({
    args: {
        sourcingId: v.string(),
        thirdProductId: v.optional(v.string()),
        evidence: v.union(v.literal("completed"), v.literal("failed"), v.literal("unknown")),
        cjProductId: v.optional(v.string()),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        statusText: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const sourcingId = args.sourcingId.trim();
        if (!sourcingId) return { handled: false, code: "MISSING_SOURCING_ID" };

        const directJobs = await ctx.db
            .query("cjSourcingJobs")
            .withIndex("by_sourcing_id", (q) => q.eq("currentSourcingId", sourcingId))
            .take(2);
        if (directJobs.length > 1) return { handled: true, code: "DUPLICATE_SOURCING_ID" };
        let job: Doc<"cjSourcingJobs"> | null | undefined = directJobs[0];

        if (!job && args.thirdProductId) {
            const thirdProductId = args.thirdProductId;
            const attempts = await ctx.db
                .query("cjSourcingAttempts")
                .withIndex("by_third_product_id", (q) => q.eq("thirdProductId", thirdProductId))
                .take(2);
            if (attempts.length > 1) return { handled: true, code: "DUPLICATE_CORRELATION_KEY" };
            if (attempts[0]) job = await ctx.db.get(attempts[0].jobId) ?? undefined;
        }

        if (!job) {
            const products = await ctx.db
                .query("products")
                .withIndex("by_cj_sourcing_id", (q) => q.eq("cjSourcingId", sourcingId))
                .take(2);
            if (products.length > 1) return { handled: true, code: "DUPLICATE_LEGACY_SOURCING_ID" };
            if (products[0]) {
                const jobId = await ensureJobRecord(ctx, products[0]._id, "migration");
                if (jobId) job = await ctx.db.get(jobId) ?? undefined;
            }
        }

        if (!job) return { handled: false, code: "UNMATCHED_WEBHOOK" };
        if (job.currentSourcingId && job.currentSourcingId !== sourcingId) {
            return { handled: true, code: "CONFLICTING_SOURCING_ID" };
        }

        const now = Date.now();
        const state: JobState = args.evidence === "failed"
            ? "rejected"
            : args.evidence === "completed" && args.cjProductId
                ? "awaiting_catalog"
                : "processing";
        const nextAttemptAt = state === "rejected" ? undefined : now;
        await ctx.db.patch(job._id, {
            state,
            currentSourcingId: sourcingId,
            cjProductId: args.cjProductId ?? job.cjProductId,
            providerSourceStatus: args.evidence,
            providerStatusText: args.statusText?.slice(0, 500),
            nextAttemptAt,
            lastPolledAt: now,
            rejectedAt: state === "rejected" ? (job.rejectedAt ?? now) : job.rejectedAt,
            lastErrorCode: state === "rejected" ? "CJ_TERMINAL_REJECTION" : undefined,
            lastErrorMessage: state === "rejected"
                ? (args.statusText?.slice(0, 500) || "CJ sourcing was rejected.")
                : undefined,
            manualReviewReason: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
            version: job.version + 1,
        });

        if (job.activeAttemptId) {
            const attempt = await ctx.db.get(job.activeAttemptId);
            if (attempt && attempt.jobId === job._id) {
                await ctx.db.patch(attempt._id, {
                    state: state === "rejected" ? "failed_terminal" : "accepted",
                    cjSourcingId: sourcingId,
                    responseReceivedAt: attempt.responseReceivedAt ?? now,
                    acceptedAt: state === "rejected" ? attempt.acceptedAt : (attempt.acceptedAt ?? now),
                    errorCode: state === "rejected" ? "CJ_TERMINAL_REJECTION" : undefined,
                    errorMessage: state === "rejected" ? args.statusText?.slice(0, 500) : undefined,
                    updatedAt: now,
                });
            }
        }

        await ctx.db.patch(job.productId, {
            cjSourcingId: sourcingId,
            ...(args.cjProductId ? { cjProductId: args.cjProductId } : {}),
            ...(args.cjVariantId ? { cjVariantId: args.cjVariantId } : {}),
            ...(args.cjSku ? { cjSku: args.cjSku } : {}),
        });
        const updated = await ctx.db.get(job._id);
        if (updated) await projectJobToProduct(ctx, updated, job.productId);
        if (nextAttemptAt !== undefined) {
            await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.dispatchDueJobs, {});
        }
        return { handled: true, code: state === "rejected" ? "REJECTED" : "CATALOG_VERIFICATION_QUEUED" };
    },
});

export const applyCatalogResult = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        found: v.boolean(),
        cjProductId: v.string(),
        variants: v.array(v.object({
            vid: v.string(),
            sku: v.string(),
            name: v.string(),
            price: v.optional(v.number()),
            image: v.optional(v.string()),
        })),
        retryAt: v.optional(v.number()),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken) return false;
        const product = await ctx.db.get(job.productId);
        if (!product) return false;
        const now = Date.now();

        if (!args.found || args.variants.length === 0) {
            await ctx.db.patch(job._id, {
                state: args.retryAt ? "awaiting_catalog" : "reconciliation_required",
                nextAttemptAt: args.retryAt,
                lastErrorCode: "CATALOG_NOT_READY",
                lastErrorMessage: args.error?.slice(0, 500) || "CJ catalog product or variants are not available.",
                manualReviewReason: args.retryAt ? undefined : "CJ reported sourcing completion but catalog verification did not succeed.",
                transientFailureCount: job.transientFailureCount + 1,
                leaseToken: undefined,
                leaseExpiresAt: undefined,
                updatedAt: now,
                version: job.version + 1,
            });
        } else {
            const customerVariants = product.variants ?? [];
            const sellableCustomerVariants = customerVariants.filter((variant) => variant.inStock !== false);
            const mappedCustomerVariants = sellableCustomerVariants.filter((variant) =>
                variant.cjVariantId && variant.cjSku && args.variants.some((cjVariant) =>
                    cjVariant.vid === variant.cjVariantId && cjVariant.sku === variant.cjSku));
            const mappingComplete = customerVariants.length > 0
                ? sellableCustomerVariants.length > 0 && mappedCustomerVariants.length === sellableCustomerVariants.length
                : args.variants.length === 1;
            const state: JobState = mappingComplete ? "fulfillment_ready" : "mapping_required";
            const soleVariant = args.variants.length === 1 ? args.variants[0] : undefined;
            await ctx.db.patch(job._id, {
                state,
                cjProductId: args.cjProductId,
                sourcedAt: job.sourcedAt ?? now,
                completedAt: mappingComplete ? now : undefined,
                nextAttemptAt: undefined,
                transientFailureCount: 0,
                lastErrorCode: mappingComplete ? undefined : "CJ_VARIANT_MAPPING_INCOMPLETE",
                lastErrorMessage: mappingComplete ? undefined : "CJ catalog exists but customer variants are not completely mapped.",
                leaseToken: undefined,
                leaseExpiresAt: undefined,
                updatedAt: now,
                version: job.version + 1,
            });
            await ctx.db.patch(job.productId, {
                cjProductId: args.cjProductId,
                cjVariants: args.variants,
                ...(soleVariant ? { cjVariantId: soleVariant.vid, cjSku: soleVariant.sku } : {}),
                cjApprovedAt: new Date(now).toISOString(),
                cjSourcingError: mappingComplete ? undefined : "CJ variant mapping is incomplete.",
            });
            if (job.activeAttemptId) {
                const attempt = await ctx.db.get(job.activeAttemptId);
                if (attempt && attempt.state === "accepted") {
                    await ctx.db.patch(attempt._id, { state: "completed", updatedAt: now });
                }
            }
        }
        const updated = await ctx.db.get(job._id);
        if (updated) await projectJobToProduct(ctx, updated, job.productId);
        return true;
    },
});

export const releaseWorkerForRetry = internalMutation({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        code: v.string(),
        message: v.string(),
        retryAt: v.number(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job || job.leaseToken !== args.leaseToken) return false;
        const nextState: JobState = job.currentSourcingId ? job.state : "retry_wait";
        await ctx.db.patch(job._id, {
            state: nextState,
            nextAttemptAt: args.retryAt,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            transientFailureCount: job.transientFailureCount + 1,
            lastErrorCode: args.code,
            lastErrorMessage: args.message.slice(0, 500),
            updatedAt: Date.now(),
            version: job.version + 1,
        });
        return true;
    },
});

export const getQueueSummary = internalQuery({
    args: {},
    handler: async (ctx) => {
        const states: JobState[] = [
            "needs_input", "queued", "submitting", "submitted", "processing", "awaiting_catalog",
            "sourced", "mapping_required", "fulfillment_ready", "retry_wait",
            "reconciliation_required", "rejected", "dead_letter", "canceled",
        ];
        const counts: Record<string, number> = {};
        for (const state of states) {
            counts[state] = (await ctx.db
                .query("cjSourcingJobs")
                .withIndex("by_state_next_attempt", (q) => q.eq("state", state))
                .take(1_000)).length;
        }
        return counts;
    },
});

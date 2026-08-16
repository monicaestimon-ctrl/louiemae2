"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
    createSourcing,
    formatCjApiError,
    queryCatalogProduct,
    querySourcing,
} from "./cjApiClient";
import { classifyCjSourcingStatus } from "../lib/cjSourcing";

const CJ_REQUEST_TIMEOUT_MS = 15_000;
const MAX_SLOT_WAIT_MS = 30_000;

const retryAtForFailure = (failureCount: number) => {
    const delay = Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(failureCount, 8));
    return Date.now() + delay;
};

const waitForRequestSlot = async (ctx: ActionCtx, operation: string) => {
    const reservation = await ctx.runMutation(internal.cjSourcingJobs.reserveApiRequestSlot, { operation });
    const waitMs = Math.max(0, reservation.reservedAt - Date.now());
    if (waitMs > MAX_SLOT_WAIT_MS) {
        throw new Error(`CJ request admission wait exceeded ${MAX_SLOT_WAIT_MS}ms`);
    }
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
};

const normalizedSourcingId = (data: unknown): string | null => {
    if (typeof data === "string" && data.trim()) return data.trim();
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    const value = record.cjSourcingId ?? record.sourcingId ?? record.id;
    return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

const normalizedString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

export const processSourcingJob = internalAction({
    args: {
        jobId: v.id("cjSourcingJobs"),
        leaseToken: v.string(),
        kind: v.union(v.literal("submit"), v.literal("poll"), v.literal("catalog")),
    },
    handler: async (ctx, args): Promise<{ ok: boolean; outcome: string }> => {
        const context = await ctx.runQuery(internal.cjSourcingJobs.getWorkerContext, { jobId: args.jobId });
        if (!context || context.job.leaseToken !== args.leaseToken) {
            return { ok: false, outcome: "lease_lost" };
        }

        const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!token) {
            await ctx.runMutation(internal.cjSourcingJobs.releaseWorkerForRetry, {
                jobId: args.jobId,
                leaseToken: args.leaseToken,
                code: "AUTH_UNAVAILABLE",
                message: "CJ authentication is unavailable; the product was not rejected.",
                retryAt: retryAtForFailure(context.job.transientFailureCount),
            });
            return { ok: false, outcome: "auth_unavailable" };
        }

        if (args.kind === "submit") {
            if (!context.attempt || context.attempt.state !== "prepared") {
                return { ok: false, outcome: "attempt_not_prepared" };
            }
            await waitForRequestSlot(ctx, "sourcing.create");
            const markedSending = await ctx.runMutation(internal.cjSourcingJobs.markAttemptSending, {
                jobId: args.jobId,
                leaseToken: args.leaseToken,
            });
            if (!markedSending) return { ok: false, outcome: "lease_lost_before_send" };

            const result = await createSourcing(token, context.attempt.payloadSnapshot, {
                timeoutMs: CJ_REQUEST_TIMEOUT_MS,
            });
            const sourcingId = result.ok ? normalizedSourcingId(result.data) : null;
            if (result.ok && sourcingId) {
                await ctx.runMutation(internal.cjSourcingJobs.applySubmissionAccepted, {
                    jobId: args.jobId,
                    leaseToken: args.leaseToken,
                    sourcingId,
                    httpStatus: result.httpStatus,
                    cjCode: result.code === undefined ? undefined : String(result.code),
                    providerRequestId: result.requestId,
                });
                return { ok: true, outcome: "submitted" };
            }

            const error = "error" in result
                ? result.error
                : { message: "CJ accepted the request but returned no sourcing ID." };
            const message = formatCjApiError(error);
            const providerResponded = error.httpStatus !== undefined;
            const dailyLimit = message.toLowerCase().includes("daily") && message.toLowerCase().includes("limit");
            const transient = error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500);
            if (dailyLimit) {
                await ctx.runMutation(internal.cjSourcingJobs.blockSourceQuota, {
                    reason: message,
                    blockedUntil: Date.now() + 24 * 60 * 60 * 1000,
                });
            }
            await ctx.runMutation(internal.cjSourcingJobs.applySubmissionFailure, {
                jobId: args.jobId,
                leaseToken: args.leaseToken,
                code: dailyLimit ? "SOURCE_DAILY_LIMIT" : transient ? "CJ_TRANSIENT" : providerResponded ? "CJ_REJECTED" : "REQUEST_AMBIGUOUS",
                message,
                ambiguous: !providerResponded,
                retryAt: transient || dailyLimit
                    ? retryAtForFailure(dailyLimit ? 10 : context.job.transientFailureCount)
                    : undefined,
                httpStatus: error.httpStatus,
                cjCode: error.code === undefined ? undefined : String(error.code),
                providerRequestId: error.requestId,
            });
            return { ok: false, outcome: !providerResponded ? "ambiguous" : transient ? "retry_wait" : "rejected" };
        }

        if (args.kind === "poll") {
            if (!context.job.currentSourcingId) return { ok: false, outcome: "missing_sourcing_id" };
            try {
                await waitForRequestSlot(ctx, "sourcing.query");
                const result = await querySourcing(token, context.job.currentSourcingId, {
                    timeoutMs: CJ_REQUEST_TIMEOUT_MS,
                });
                if ("error" in result) {
                    await ctx.runMutation(internal.cjSourcingJobs.releaseWorkerForRetry, {
                        jobId: args.jobId,
                        leaseToken: args.leaseToken,
                        code: "CJ_POLL_TRANSIENT",
                        message: formatCjApiError(result.error),
                        retryAt: retryAtForFailure(context.job.transientFailureCount),
                    });
                    return { ok: false, outcome: "poll_retry" };
                }
                const row = Array.isArray(result.data) ? result.data[0] : result.data;
                if (!row) {
                    await ctx.runMutation(internal.cjSourcingJobs.releaseWorkerForRetry, {
                        jobId: args.jobId,
                        leaseToken: args.leaseToken,
                        code: "CJ_EMPTY_POLL_RESPONSE",
                        message: "CJ returned no sourcing record for the saved sourcing ID.",
                        retryAt: retryAtForFailure(context.job.transientFailureCount),
                    });
                    return { ok: false, outcome: "empty_poll" };
                }
                const evidence = classifyCjSourcingStatus(row.sourceStatus);
                await ctx.runMutation(internal.cjSourcingJobs.applyPollEvidence, {
                    jobId: args.jobId,
                    leaseToken: args.leaseToken,
                    evidence,
                    sourceStatus: row.sourceStatus === undefined ? undefined : String(row.sourceStatus),
                    statusText: normalizedString(row.sourceStatusStr),
                    cjProductId: normalizedString(row.cjProductId) ?? normalizedString(row.productId),
                    cjSku: normalizedString(row.cjVariantSku),
                });
                return { ok: true, outcome: evidence };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await ctx.runMutation(internal.cjSourcingJobs.releaseWorkerForRetry, {
                    jobId: args.jobId,
                    leaseToken: args.leaseToken,
                    code: "CJ_POLL_EXCEPTION",
                    message,
                    retryAt: retryAtForFailure(context.job.transientFailureCount),
                });
                return { ok: false, outcome: "poll_exception" };
            }
        }

        if (!context.job.cjProductId) return { ok: false, outcome: "missing_product_id" };
        try {
            await waitForRequestSlot(ctx, "product.query");
            const result = await queryCatalogProduct(token, context.job.cjProductId, {
                timeoutMs: CJ_REQUEST_TIMEOUT_MS,
            });
            if ("error" in result) {
                await ctx.runMutation(internal.cjSourcingJobs.applyCatalogResult, {
                    jobId: args.jobId,
                    leaseToken: args.leaseToken,
                    found: false,
                    cjProductId: context.job.cjProductId,
                    variants: [],
                    retryAt: context.job.transientFailureCount < 4
                        ? retryAtForFailure(context.job.transientFailureCount)
                        : undefined,
                    error: formatCjApiError(result.error),
                });
                return { ok: false, outcome: "catalog_retry" };
            }
            const variants = (result.data.variants ?? []).flatMap((variant) => {
                const vid = normalizedString(variant.vid);
                const sku = normalizedString(variant.variantSku);
                if (!vid || !sku) return [];
                const parsedPrice = Number(variant.variantSellPrice);
                return [{
                    vid,
                    sku,
                    name: normalizedString(variant.variantNameEn) ?? sku,
                    price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                    image: normalizedString(variant.variantImage),
                }];
            });
            await ctx.runMutation(internal.cjSourcingJobs.applyCatalogResult, {
                jobId: args.jobId,
                leaseToken: args.leaseToken,
                found: Boolean(result.data.pid || variants.length > 0),
                cjProductId: normalizedString(result.data.pid) ?? context.job.cjProductId,
                variants,
                retryAt: variants.length === 0 && context.job.transientFailureCount < 4
                    ? retryAtForFailure(context.job.transientFailureCount)
                    : undefined,
                error: variants.length === 0 ? "CJ catalog product has no usable variants yet." : undefined,
            });
            return { ok: variants.length > 0, outcome: variants.length > 0 ? "catalog_verified" : "catalog_empty" };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.cjSourcingJobs.releaseWorkerForRetry, {
                jobId: args.jobId,
                leaseToken: args.leaseToken,
                code: "CJ_CATALOG_EXCEPTION",
                message,
                retryAt: retryAtForFailure(context.job.transientFailureCount),
            });
            return { ok: false, outcome: "catalog_exception" };
        }
    },
});

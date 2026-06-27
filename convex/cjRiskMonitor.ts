import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
    applyReviewedRiskAudits,
    getAutomationRisks,
    getCjControlRoomOrder,
    getProductRisks,
    getRiskSummary,
    sortRisks,
    type CjAdminRisk,
    type CjAdminSeverity,
    type CjReviewedRiskAudit,
} from "../lib/cjAdminReadModels";
import { getCjAutomationConfig } from "../lib/cjAutomation";

const riskSeverityValidator = v.optional(v.union(
    v.literal("all"),
    v.literal("critical"),
    v.literal("warning"),
    v.literal("info")
));

const MAX_ORDERS = 250;
const MAX_PRODUCTS = 250;
const MAX_WEBHOOK_LOGS = 250;
const MAX_RISKS = 100;

const parseTime = (value: string | undefined): number => {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const freshnessLabel = (timestamp: string | undefined, nowMs: number): string => {
    const time = parseTime(timestamp);
    if (!time) return "Never seen";

    const ageMs = nowMs - time;
    const minutes = Math.max(1, Math.round(ageMs / 60000));
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} hr ago`;

    const days = Math.round(hours / 24);
    return `${days} days ago`;
};

const getLastWebhookByType = (
    logs: Array<{ type: string; processedAt: string; status?: string }>,
    type: string,
) =>
    logs
        .filter((log) => log.type?.toLowerCase() === type.toLowerCase())
        .sort((a, b) => parseTime(b.processedAt) - parseTime(a.processedAt))[0];

const getSystemHealth = (
    logs: Array<{ type: string; processedAt: string; status?: string; lastError?: string }>,
    latestTrackingSyncAt: string | undefined,
    latestInventoryRefreshAt: string | undefined,
    nowMs: number,
) => {
    const lastOrderWebhook = getLastWebhookByType(logs, "ORDER");
    const lastLogisticWebhook = getLastWebhookByType(logs, "LOGISTIC");
    const lastProductWebhook = getLastWebhookByType(logs, "PRODUCT");
    const failedWebhookCount = logs.filter((log) => log.status === "failed").length;
    const retryableWebhookCount = logs.filter((log) => log.status === "retryable").length;

    return {
        generatedAt: new Date(nowMs).toISOString(),
        webhooks: {
            lastOrderWebhookAt: lastOrderWebhook?.processedAt,
            lastOrderWebhookLabel: freshnessLabel(lastOrderWebhook?.processedAt, nowMs),
            lastLogisticWebhookAt: lastLogisticWebhook?.processedAt,
            lastLogisticWebhookLabel: freshnessLabel(lastLogisticWebhook?.processedAt, nowMs),
            lastProductWebhookAt: lastProductWebhook?.processedAt,
            lastProductWebhookLabel: freshnessLabel(lastProductWebhook?.processedAt, nowMs),
            failedWebhookCount,
            retryableWebhookCount,
        },
        jobs: {
            latestTrackingSyncAt,
            latestTrackingSyncLabel: freshnessLabel(latestTrackingSyncAt, nowMs),
            latestInventoryRefreshAt,
            latestInventoryRefreshLabel: freshnessLabel(latestInventoryRefreshAt, nowMs),
        },
    };
};

const getAllRisks = async (ctx: QueryCtx, nowMs: number, includeReviewed = false) => {
    const [orders, products, reviewedAudits] = await Promise.all([
        ctx.db.query("orders").order("desc").take(MAX_ORDERS),
        ctx.db.query("products").take(MAX_PRODUCTS),
        ctx.db
            .query("cjFulfillmentAudits")
            .withIndex("by_action_type", q => q.eq("actionType", "risk_reviewed"))
            .collect(),
    ]);
    const automation = getCjAutomationConfig(process.env);
    const controlRoomOrders = orders.map((order) => getCjControlRoomOrder(order, nowMs));
    const unresolvedRisks = sortRisks([
        ...getAutomationRisks(automation, nowMs),
        ...controlRoomOrders.flatMap((order) => order.risks),
        ...getProductRisks(products, nowMs),
    ]);

    return {
        orders,
        products,
        automation,
        reviewedRiskCount: reviewedAudits.length,
        risks: applyReviewedRiskAudits(
            unresolvedRisks,
            reviewedAudits as CjReviewedRiskAudit[],
            includeReviewed,
        ),
    };
};

export const getSummary = query({
    args: {},
    handler: async (ctx) => {
        const nowMs = Date.now();
        const { risks, automation, reviewedRiskCount } = await getAllRisks(ctx, nowMs);

        return {
            generatedAt: new Date(nowMs).toISOString(),
            automation,
            riskSummary: getRiskSummary(risks),
            reviewedRiskCount,
            topRisks: risks.slice(0, 8),
        };
    },
});

export const getRisks = query({
    args: {
        severity: riskSeverityValidator,
        includeReviewed: v.optional(v.boolean()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const nowMs = Date.now();
        const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_RISKS);
        const { risks } = await getAllRisks(ctx, nowMs, args.includeReviewed);

        return risks
            .filter((risk: CjAdminRisk) => {
                if (!args.severity || args.severity === "all") return true;
                return risk.severity === (args.severity as CjAdminSeverity);
            })
            .slice(0, limit);
    },
});

export const getSystemStatus = query({
    args: {},
    handler: async (ctx) => {
        const nowMs = Date.now();
        const [logs, orders, products] = await Promise.all([
            ctx.db.query("cjWebhookLog").order("desc").take(MAX_WEBHOOK_LOGS),
            ctx.db.query("orders").order("desc").take(MAX_ORDERS),
            ctx.db.query("products").take(MAX_PRODUCTS),
        ]);

        const latestTrackingSyncAt = orders
            .map((order) => order.cjLastSyncAt)
            .filter(Boolean)
            .sort((a, b) => parseTime(b) - parseTime(a))[0];
        const latestInventoryRefreshAt = products
            .map((product) => product.cjInventoryLastCheckedAt)
            .filter(Boolean)
            .sort((a, b) => parseTime(b) - parseTime(a))[0];

        return getSystemHealth(logs, latestTrackingSyncAt, latestInventoryRefreshAt, nowMs);
    },
});

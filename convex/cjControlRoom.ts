import { v } from "convex/values";
import { query } from "./_generated/server";
import {
    applyReviewedRiskAudits,
    getAutomationRisks,
    getCjControlRoomOrder,
    getCjControlRoomSummary,
    getRiskSummary,
    sortRisks,
    type CjControlRoomOrder,
    type CjReviewedRiskAudit,
    type CjAdminPipelineState,
} from "../lib/cjAdminReadModels";
import { getCjAutomationConfig } from "../lib/cjAutomation";

const controlRoomFilterValidator = v.optional(v.union(
    v.literal("all"),
    v.literal("needs_review"),
    v.literal("ready_for_cj"),
    v.literal("waiting_for_payment"),
    v.literal("waiting_for_tracking"),
    v.literal("in_transit"),
    v.literal("delivered"),
    v.literal("failed_or_stuck")
));

const MAX_ORDERS = 200;

const toPipelineFilter = (filter: string | undefined): CjAdminPipelineState | null => {
    switch (filter) {
        case "ready_for_cj":
            return "ready_for_cj";
        case "waiting_for_payment":
            return "waiting_for_cj_payment";
        case "waiting_for_tracking":
            return "waiting_for_tracking";
        case "in_transit":
            return "in_transit";
        case "delivered":
            return "delivered";
        default:
            return null;
    }
};

const getAutomationState = () => getCjAutomationConfig(process.env);

const applyReviewedAuditsToOrder = (
    order: CjControlRoomOrder,
    audits: CjReviewedRiskAudit[],
    includeReviewed = false,
): CjControlRoomOrder => {
    const risks = applyReviewedRiskAudits(order.risks, audits, includeReviewed);
    return {
        ...order,
        risks,
        needsReview: risks.some((risk) => risk.severity === "critical"),
    };
};

export const getOverview = query({
    args: {},
    handler: async (ctx) => {
        const nowMs = Date.now();
        const [orders, reviewedAudits] = await Promise.all([
            ctx.db.query("orders").order("desc").take(MAX_ORDERS),
            ctx.db
                .query("cjFulfillmentAudits")
                .withIndex("by_action_type", q => q.eq("actionType", "risk_reviewed"))
                .collect(),
        ]);
        const controlRoomOrders = orders
            .map((order) => getCjControlRoomOrder(order, nowMs))
            .map((order) => applyReviewedAuditsToOrder(order, reviewedAudits as CjReviewedRiskAudit[]));
        const automation = getAutomationState();
        const automationRisks = getAutomationRisks(automation, nowMs);
        const orderRisks = controlRoomOrders.flatMap((order) => order.risks);
        const risks = applyReviewedRiskAudits(
            sortRisks([...automationRisks, ...orderRisks]),
            reviewedAudits as CjReviewedRiskAudit[],
        );

        return {
            generatedAt: new Date(nowMs).toISOString(),
            automation,
            summary: getCjControlRoomSummary(controlRoomOrders),
            riskSummary: getRiskSummary(risks),
            reviewedRiskCount: reviewedAudits.length,
            topRisks: risks.slice(0, 8),
        };
    },
});

export const getOrders = query({
    args: {
        filter: controlRoomFilterValidator,
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const nowMs = Date.now();
        const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_ORDERS);
        const pipelineFilter = toPipelineFilter(args.filter);
        const [orders, reviewedAudits] = await Promise.all([
            ctx.db.query("orders").order("desc").take(MAX_ORDERS),
            ctx.db
                .query("cjFulfillmentAudits")
                .withIndex("by_action_type", q => q.eq("actionType", "risk_reviewed"))
                .collect(),
        ]);

        return orders
            .map((order) => getCjControlRoomOrder(order, nowMs))
            .map((order) => applyReviewedAuditsToOrder(order, reviewedAudits as CjReviewedRiskAudit[]))
            .filter((order) => {
                if (!args.filter || args.filter === "all") return order.pipelineState !== "not_cj";
                if (args.filter === "needs_review") return order.needsReview;
                if (args.filter === "failed_or_stuck") {
                    return order.pipelineState === "needs_review" || order.risks.some((risk) =>
                        risk.type === "fulfillment" || risk.type === "payment" || risk.type === "tracking"
                    );
                }
                return pipelineFilter ? order.pipelineState === pipelineFilter : true;
            })
            .sort((a, b) => {
                if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
                return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
            })
            .slice(0, limit);
    },
});

export const getOrderDetail = query({
    args: {
        orderId: v.id("orders"),
        includeReviewed: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const [order, reviewedAudits] = await Promise.all([
            ctx.db.get(args.orderId),
            ctx.db
                .query("cjFulfillmentAudits")
                .withIndex("by_action_type", q => q.eq("actionType", "risk_reviewed"))
                .collect(),
        ]);
        if (!order) return null;

        return applyReviewedAuditsToOrder(
            getCjControlRoomOrder(order, Date.now()),
            reviewedAudits as CjReviewedRiskAudit[],
            args.includeReviewed,
        );
    },
});

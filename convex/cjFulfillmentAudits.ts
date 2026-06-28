import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireCjAdminIdentity } from "./cjAdminAccess";

const riskTypeValidator = v.union(
    v.literal("automation"),
    v.literal("mapping"),
    v.literal("shipping"),
    v.literal("fulfillment"),
    v.literal("payment"),
    v.literal("tracking"),
    v.literal("inventory"),
    v.literal("notification"),
    v.literal("refund"),
    v.literal("pricing")
);

const severityValidator = v.union(
    v.literal("critical"),
    v.literal("warning"),
    v.literal("info")
);

const trimOptional = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

const canReadFulfillmentAudits = async (ctx: QueryCtx): Promise<boolean> => {
    try {
        await requireCjAdminIdentity(ctx);
        return true;
    } catch {
        return false;
    }
};

export const markRiskReviewed = mutation({
    args: {
        riskKey: v.string(),
        riskType: riskTypeValidator,
        severity: severityValidator,
        title: v.string(),
        orderId: v.optional(v.id("orders")),
        productId: v.optional(v.id("products")),
        note: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const admin = await requireCjAdminIdentity(ctx);
        const now = new Date().toISOString();
        const riskKey = args.riskKey.trim();
        if (!riskKey) {
            throw new Error("A risk key is required to mark a CJ fulfillment risk as reviewed.");
        }

        const auditId = await ctx.db.insert("cjFulfillmentAudits", {
            actionType: "risk_reviewed",
            riskKey,
            riskType: args.riskType,
            severity: args.severity,
            title: args.title.trim() || "Reviewed CJ risk",
            orderId: args.orderId,
            productId: args.productId,
            note: trimOptional(args.note),
            actorEmail: admin.email,
            createdAt: now,
            reviewedAt: now,
        });

        return {
            auditId,
            reviewedAt: now,
            reviewedBy: admin.email,
        };
    },
});

export const addFulfillmentNote = mutation({
    args: {
        orderId: v.optional(v.id("orders")),
        productId: v.optional(v.id("products")),
        riskKey: v.optional(v.string()),
        note: v.string(),
    },
    handler: async (ctx, args) => {
        const admin = await requireCjAdminIdentity(ctx);
        const note = args.note.trim();
        if (!note) {
            throw new Error("A note is required.");
        }
        if (!args.orderId && !args.productId && !trimOptional(args.riskKey)) {
            throw new Error("A note must be attached to an order, product, or risk.");
        }

        const now = new Date().toISOString();
        const auditId = await ctx.db.insert("cjFulfillmentAudits", {
            actionType: "note_added",
            riskKey: trimOptional(args.riskKey),
            riskType: "fulfillment",
            severity: "info",
            title: "Fulfillment note",
            orderId: args.orderId,
            productId: args.productId,
            note,
            actorEmail: admin.email,
            createdAt: now,
        });

        return {
            auditId,
            createdAt: now,
            createdBy: admin.email,
        };
    },
});

export const getForOrder = query({
    args: {
        orderId: v.id("orders"),
    },
    handler: async (ctx, args) => {
        if (!await canReadFulfillmentAudits(ctx)) return [];
        const audits = await ctx.db
            .query("cjFulfillmentAudits")
            .withIndex("by_order", q => q.eq("orderId", args.orderId))
            .collect();

        return audits.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
});

export const getForProduct = query({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        if (!await canReadFulfillmentAudits(ctx)) return [];
        const audits = await ctx.db
            .query("cjFulfillmentAudits")
            .withIndex("by_product", q => q.eq("productId", args.productId))
            .collect();

        return audits.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
});

export const getRecent = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        if (!await canReadFulfillmentAudits(ctx)) return [];
        const limit = Math.floor(Math.min(Math.max(args.limit ?? 50, 1), 100));
        return await ctx.db
            .query("cjFulfillmentAudits")
            .withIndex("by_created_at")
            .order("desc")
            .take(limit);
    },
});

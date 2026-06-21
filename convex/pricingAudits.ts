import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const pricingStageValidator = v.union(
    v.literal("source_estimate"),
    v.literal("cj_catalog_confirmed"),
    v.literal("cj_freight_confirmed"),
    v.literal("manual_locked"),
    v.literal("order_reconciled")
);

export const create = internalMutation({
    args: {
        productId: v.id("products"),
        stage: pricingStageValidator,
        sourcePriceUsd: v.optional(v.number()),
        collection: v.optional(v.string()),
        productCost: v.number(),
        shippingCost: v.number(),
        serviceFee: v.number(),
        taxesFee: v.number(),
        clearanceFee: v.number(),
        remoteFee: v.number(),
        otherFee: v.number(),
        landedCost: v.number(),
        retailMultiplier: v.number(),
        suggestedRetailPrice: v.number(),
        previousPrice: v.optional(v.number()),
        appliedPrice: v.optional(v.number()),
        adminPriceLocked: v.boolean(),
        pricingWarnings: v.array(v.string()),
        cjProductId: v.optional(v.string()),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        cjLogisticsName: v.optional(v.string()),
        cjRawResponse: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("pricingAudits", {
            ...args,
            createdAt: Date.now(),
        });
    },
});

export const listByProduct = query({
    args: {
        productId: v.id("products"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("pricingAudits")
            .withIndex("by_product", q => q.eq("productId", args.productId))
            .order("desc")
            .take(args.limit ?? 20);
    },
});

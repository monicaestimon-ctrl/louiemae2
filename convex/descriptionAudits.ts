import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCjAdminIdentity } from "./cjAdminAccess";

const DESCRIPTION_AUDIT_DEBUG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const createDescriptionAudit = internalMutation({
    args: {
        productId: v.optional(v.id("products")),
        importSessionId: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        sourceDomain: v.optional(v.string()),
        generationMode: v.union(
            v.literal("import_auto"),
            v.literal("manual_generate"),
            v.literal("manual_regenerate"),
            v.literal("batch_regenerate"),
            v.literal("repair_existing")
        ),
        model: v.string(),
        promptVersion: v.string(),
        brandVoiceVersion: v.string(),
        sourceSnapshotHash: v.string(),
        sourceSnapshot: v.any(),
        normalizedFacts: v.any(),
        generatedDraft: v.optional(v.any()),
        finalDescription: v.optional(v.string()),
        rawModelResponse: v.optional(v.string()),
        validation: v.any(),
        fallbackUsed: v.boolean(),
        fallbackReason: v.optional(v.string()),
        adminEdited: v.boolean(),
        adminEditDistance: v.optional(v.number()),
        warnings: v.array(v.string()),
        createdBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        return await ctx.db.insert("descriptionAudits", {
            ...args,
            createdAt: now,
            updatedAt: now,
            debugExpiresAt: now + DESCRIPTION_AUDIT_DEBUG_RETENTION_MS,
        });
    },
});

export const linkAuditToProduct = mutation({
    args: {
        auditId: v.id("descriptionAudits"),
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        await ctx.db.patch(args.auditId, {
            productId: args.productId,
            updatedAt: Date.now(),
        });
    },
});

export const getByProduct = query({
    args: { productId: v.id("products") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.db
            .query("descriptionAudits")
            .withIndex("by_product", q => q.eq("productId", args.productId))
            .order("desc")
            .take(20);
    },
});

export const findSimilarDescriptions = internalQuery({
    args: {
        collection: v.string(),
        productType: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const normalizedType = args.productType.toLowerCase();
        const scanLimit = Math.max((args.limit || 10) * 4, 20);
        const products = await ctx.db
            .query("products")
            .filter(q => q.or(
                q.eq(q.field("collection"), args.collection),
                q.eq(q.field("descriptionFingerprint.collection"), args.collection)
            ))
            .take(scanLimit);
        return products
            .filter(product =>
                product.description &&
                (
                    !product.descriptionFingerprint?.productType ||
                    product.descriptionFingerprint.productType.toLowerCase().includes(normalizedType) ||
                    normalizedType.includes(product.descriptionFingerprint.productType.toLowerCase())
                )
            )
            .slice(0, args.limit || 10)
            .map(product => product.description);
    },
});

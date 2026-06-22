import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getProductsForImageCaching = internalQuery({
    args: {
        productId: v.optional(v.id("products")),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit || 25, 1), 100);
        const products = args.productId
            ? [await ctx.db.get(args.productId)]
            : await ctx.db.query("products").order("desc").take(limit);
        return products.filter(Boolean).map((product: any) => ({
            _id: product._id,
            name: product.name,
            sourceUrl: product.sourceUrl,
            images: product.images || [],
            descriptionImages: product.descriptionImages || [],
            variants: product.variants || [],
        }));
    },
});

export const patchCachedProductImages = internalMutation({
    args: {
        productId: v.id("products"),
        images: v.optional(v.array(v.string())),
        descriptionImages: v.optional(v.array(v.string())),
        variants: v.optional(v.array(v.object({
            id: v.string(),
            name: v.string(),
            image: v.optional(v.string()),
            priceAdjustment: v.number(),
            inStock: v.boolean(),
            cjVariantId: v.optional(v.string()),
            cjSku: v.optional(v.string()),
        }))),
    },
    handler: async (ctx, args) => {
        const { productId, ...updates } = args;
        await ctx.db.patch(productId, Object.fromEntries(
            Object.entries(updates).filter(([, value]) => value !== undefined)
        ));
    },
});

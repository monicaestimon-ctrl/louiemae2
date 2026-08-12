import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCjAdminIdentity } from "./cjAdminAccess";

const extractUrls = (value: unknown): string[] => {
    if (typeof value === "string") {
        return value.match(/https?:\/\/[^\s"'<>)]*/g) ?? [];
    }
    if (Array.isArray(value)) return value.flatMap(extractUrls);
    if (value && typeof value === "object") return Object.values(value).flatMap(extractUrls);
    return [];
};

// Generate an upload URL for client-side uploads
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.storage.generateUploadUrl();
    },
});

// Get the URL for a stored file
export const getUrl = query({
    args: { storageId: v.id("_storage") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.storage.getUrl(args.storageId);
    },
});

// Store file metadata (optional - for tracking uploaded files)
export const saveFile = mutation({
    args: {
        storageId: v.id("_storage"),
        fileName: v.string(),
        fileType: v.string(),
        purpose: v.optional(v.string()), // e.g., "hero", "product", "blog"
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        // You can store metadata about uploaded files if needed
        // For now, just return the URL
        const url = await ctx.storage.getUrl(args.storageId);
        return { storageId: args.storageId, url };
    },
});

// Delete a stored file
export const deleteFile = mutation({
    args: { storageId: v.id("_storage") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        await ctx.storage.delete(args.storageId);
    },
});

/**
 * Read-only storage inventory. "Possibly unreferenced" is deliberately not a
 * deletion decision: URLs can also live in external systems or legacy fields.
 */
export const reportStorage = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const limit = Math.min(Math.max(args.limit ?? 100, 1), 250);
        const [files, products, posts, pages, siteContent] = await Promise.all([
            ctx.db.system.query("_storage").order("desc").take(limit),
            ctx.db.query("products").take(500),
            ctx.db.query("blogPosts").take(250),
            ctx.db.query("customPages").take(250),
            ctx.db.query("siteContent").first(),
        ]);
        const references = JSON.stringify({
            products: products.map(product => ({
                images: product.images,
                descriptionImages: product.descriptionImages,
                sourceUrl: product.sourceUrl,
                variantImages: product.variants?.map(variant => variant.image),
            })),
            posts: posts.map(post => ({ image: post.image, contentUrls: extractUrls(post.content) })),
            pages: pages.map(page => ({ sectionUrls: extractUrls(page.sections) })),
            siteContentUrls: extractUrls(siteContent),
        });
        const rows = files.map(file => ({
            storageId: file._id,
            contentType: file.contentType,
            size: file.size,
            uploadedAt: file._creationTime,
            referencedInBoundedAppScan: references.includes(String(file._id)),
        }));
        return {
            dryRun: true,
            scanned: rows.length,
            bytes: rows.reduce((sum, row) => sum + row.size, 0),
            possiblyUnreferenced: rows.filter(row => !row.referencedInBoundedAppScan),
            caveat: "No files were deleted. Review external and legacy references before any removal.",
        };
    },
});

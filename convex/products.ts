import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

// Public queries - no auth required
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("products").collect();
    },
});

export const get = query({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

// Protected mutations - require authentication
export const create = mutation({
    args: {
        name: v.string(),
        price: v.number(),
        description: v.string(),
        images: v.array(v.string()),
        category: v.string(),
        collection: v.string(),
        isNew: v.optional(v.boolean()),
        inStock: v.optional(v.boolean()),
        variants: v.optional(v.array(v.object({
            id: v.string(),
            name: v.string(),
            image: v.optional(v.string()),
            priceAdjustment: v.number(),
            inStock: v.boolean(),
            cjVariantId: v.optional(v.string()),
            cjSku: v.optional(v.string()),
        }))),
        // CJ Sourcing fields
        sourceUrl: v.optional(v.string()),
        cjSourcingStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("none")
        )),
        // Two-stage pricing metadata
        sourcePriceCny: v.optional(v.number()),
        estimatedCjCost: v.optional(v.number()),
        estimatedShipping: v.optional(v.number()),
        pricingStage: v.optional(v.union(
            v.literal("estimated"),
            v.literal("confirmed")
        )),
        // Multi-category support
        subcategory: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Require authentication
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to create products");
        }
        return await ctx.db.insert("products", {
            ...args,
            publishedAt: new Date().toISOString(),
        });
    },
});

export const update = mutation({
    args: {
        id: v.id("products"),
        name: v.optional(v.string()),
        price: v.optional(v.number()),
        description: v.optional(v.string()),
        images: v.optional(v.array(v.string())),
        category: v.optional(v.string()),
        collection: v.optional(v.string()),
        isNew: v.optional(v.boolean()),
        inStock: v.optional(v.boolean()),
        sourceUrl: v.optional(v.string()),
        cjSourcingStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("none")
        )),
        sourcePriceCny: v.optional(v.number()),
        estimatedCjCost: v.optional(v.number()),
        estimatedShipping: v.optional(v.number()),
        pricingStage: v.optional(v.union(
            v.literal("estimated"),
            v.literal("confirmed")
        )),
        subcategory: v.optional(v.string()),
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
        // Require authentication
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to update products");
        }
        const { id, ...updates } = args;
        // Filter out undefined values
        const filteredUpdates = Object.fromEntries(
            Object.entries(updates).filter(([_, v]) => v !== undefined)
        );
        await ctx.db.patch(id, filteredUpdates);
    },
});

export const remove = mutation({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        // Require authentication
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to delete products");
        }
        await ctx.db.delete(args.id);
    },
});

/**
 * Admin-only remove - simpler version for CJ Settings panel
 * TODO: Enforce admin role/claim check here when role system is implemented.
 * Currently a single-owner app, so auth-only guard is sufficient.
 */
export const adminRemove = mutation({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to delete products");
        }
        await ctx.db.delete(args.id);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// STOREFRONT PRODUCTS (filtered for public display)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get products for storefront display
 * Filters out products with "pending" or "rejected" CJ sourcing status
 * Only shows products that are ready to be fulfilled
 */
export const listForStorefront = query({
    args: {},
    handler: async (ctx) => {
        const allProducts = await ctx.db.query("products").collect();

        // Filter out products that are pending or rejected CJ sourcing
        return allProducts.filter(product => {
            // If no CJ sourcing status set, show the product (legacy or manual products)
            if (!product.cjSourcingStatus || product.cjSourcingStatus === "none") {
                return true;
            }
            // Only show approved products
            return product.cjSourcingStatus === "approved";
        });
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN SOURCING QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get products pending CJ sourcing approval (for admin)
 */
export const getPendingSourcing = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "pending"))
            .collect();
    },
});

/**
 * Get recently approved products (for admin notifications)
 */
export const getRecentlyApproved = query({
    args: {},
    handler: async (ctx) => {
        // Get products approved in the last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const approvedProducts = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "approved"))
            .collect();

        // Filter to only recently approved ones
        return approvedProducts.filter(p =>
            p.cjApprovedAt && p.cjApprovedAt >= sevenDaysAgo
        );
    },
});

/**
 * Get rejected products (for admin to review/resubmit)
 */
export const getRejectedProducts = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "rejected"))
            .collect();
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// CJ VARIANT MANAGEMENT (Admin)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Link a CJ variant to a customer-facing variant (size option)
 * Used by admin UI to map CJ variants to sizes for correct fulfillment
 */
export const linkCjVariant = mutation({
    args: {
        productId: v.id("products"),
        customerVariantId: v.string(),  // The internal variant ID (e.g., "size_3t")
        cjVariantId: v.string(),         // CJ vid to link
        cjSku: v.optional(v.string()),   // CJ sku to link
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to manage variants");
        }

        const product = await ctx.db.get(args.productId);
        if (!product) {
            throw new Error("Product not found");
        }

        if (!product.variants) {
            throw new Error("Product has no variants to link");
        }

        // Find and update the customer variant
        const updatedVariants = product.variants.map(v => {
            if (v.id === args.customerVariantId) {
                return {
                    ...v,
                    cjVariantId: args.cjVariantId,
                    cjSku: args.cjSku,
                };
            }
            return v;
        });

        await ctx.db.patch(args.productId, {
            variants: updatedVariants,
        });
    },
});

/**
 * Unlink a CJ variant from a customer-facing variant
 */
export const unlinkCjVariant = mutation({
    args: {
        productId: v.id("products"),
        customerVariantId: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to manage variants");
        }

        const product = await ctx.db.get(args.productId);
        if (!product || !product.variants) {
            throw new Error("Product or variants not found");
        }

        const updatedVariants = product.variants.map(v => {
            if (v.id === args.customerVariantId) {
                // Remove CJ variant link while keeping other properties
                const { cjVariantId, cjSku, ...rest } = v as any;
                return rest;
            }
            return v;
        });

        await ctx.db.patch(args.productId, {
            variants: updatedVariants,
        });
    },
});

/**
 * Get products with CJ variants for admin variant management
 */
export const getProductsWithCjVariants = query({
    args: {},
    handler: async (ctx) => {
        const products = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "approved"))
            .collect();

        // Only return products that have CJ variants to manage
        return products.filter(p => p.cjVariants && p.cjVariants.length > 0);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION: Fix broken product images
// ═══════════════════════════════════════════════════════════════════════════
export const fixBrokenImages = mutation({
    args: {},
    handler: async (ctx) => {
        const allProducts = await ctx.db.query("products").collect();
        let fixed = 0;

        for (const product of allProducts) {
            // Fix: Any product with the dead Unsplash URL (photo-1612196808214)
            const hasBrokenUrl = product.images?.some((img: string) =>
                img.includes("photo-1612196808214")
            );
            if (hasBrokenUrl) {
                await ctx.db.patch(product._id, {
                    images: ["/images/brand/rustic-vase.png"],
                });
                fixed++;
            }
        }

        return { fixed };
    },
});

/**
 * MIGRATION: Approve Berry Sweet Cardigan Set with CJ variant data
 * CJ sourcing succeeded (status 9) with cjProductId and 4 size variants
 */
export const fixBerrySweetCardigan = mutation({
    args: {},
    handler: async (ctx) => {
        const products = await ctx.db.query("products").collect();
        const berry = products.find(p => p.name === "Berry Sweet Cardigan Set");
        if (!berry) {
            return { success: false, message: "Berry Sweet Cardigan Set not found" };
        }

        await ctx.db.patch(berry._id, {
            cjSourcingStatus: "approved",
            cjProductId: "2602080412251614300",
            cjVariantId: "2602080412251614700", // Default variant (66cm)
            cjSku: "CJYE275801801AZ",
            cjSourcingError: undefined,
            cjApprovedAt: new Date().toISOString(),
            inStock: true,
            // CJ variants for admin linking UI
            cjVariants: [
                { vid: "2602080412251614700", sku: "CJYE275801801AZ", name: "Red - 66cm (3-6M)", price: 6.97, image: "https://cf.cjdropshipping.com/quick/product/7d28668d-d69c-4d9a-9c9e-57c475da085b.jpg" },
                { vid: "2602080412251615000", sku: "CJYE275801802BY", name: "Red - 73cm (6-12M)", price: 6.97, image: "https://cf.cjdropshipping.com/quick/product/7d28668d-d69c-4d9a-9c9e-57c475da085b.jpg" },
                { vid: "2602080412251615300", sku: "CJYE275801803CX", name: "Red - 80cm (12-18M)", price: 6.97, image: "https://cf.cjdropshipping.com/quick/product/7d28668d-d69c-4d9a-9c9e-57c475da085b.jpg" },
                { vid: "2602080412251615600", sku: "CJYE275801804DW", name: "Red - 90cm (18-24M)", price: 6.97, image: "https://cf.cjdropshipping.com/quick/product/7d28668d-d69c-4d9a-9c9e-57c475da085b.jpg" },
            ],
            // Customer-facing size variants linked to CJ variant IDs
            variants: [
                { id: "size_66cm", name: "Size: 66cm (3-6M)", priceAdjustment: 0, inStock: true, cjVariantId: "2602080412251614700", cjSku: "CJYE275801801AZ" },
                { id: "size_73cm", name: "Size: 73cm (6-12M)", priceAdjustment: 0, inStock: true, cjVariantId: "2602080412251615000", cjSku: "CJYE275801802BY" },
                { id: "size_80cm", name: "Size: 80cm (12-18M)", priceAdjustment: 0, inStock: true, cjVariantId: "2602080412251615300", cjSku: "CJYE275801803CX" },
                { id: "size_90cm", name: "Size: 90cm (18-24M)", priceAdjustment: 0, inStock: true, cjVariantId: "2602080412251615600", cjSku: "CJYE275801804DW" },
            ],
        });

        return {
            success: true,
            message: "Berry Sweet Cardigan Set approved with 4 size variants linked to CJ",
            cjProductId: "2602080412251614300",
            variantCount: 4,
        };
    },
});

/**
 * MIGRATION: Approve Astrid Denim Set with CJ variant data
 * CJ confirmed sourcing approval via email — but the webhook/cron couldn't
 * update the database because the Convex deployment was disabled.
 *
 * USAGE: Once you have the CJ product/variant details from the CJ dashboard,
 * fill in the cjProductId, cjVariantId, cjSku, and cjVariants below,
 * then call this mutation from the Convex dashboard.
 *
 * To find the CJ details:
 *   1. Log into CJ dashboard → My Products → search "Astrid Denim" or the source URL
 *   2. Copy the Product ID (pid), and for each variant: vid, sku, name, price
 *   3. Update the placeholder values below
 */
export const fixAstridDenimSet = mutation({
    args: {
        // Pass CJ details as args so you can provide them from the dashboard
        // without editing code. If empty, falls back to hardcoded placeholders.
        cjProductId: v.optional(v.string()),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to fix product data");
        }

        const products = await ctx.db.query("products").collect();
        const matches = products.filter(p =>
            p.name.toLowerCase().includes("astrid") &&
            p.name.toLowerCase().includes("denim")
        );
        if (matches.length !== 1) {
            return {
                success: false,
                message: `Expected exactly one Astrid Denim match, found ${matches.length}. Available products: ` +
                    products.map(p => p.name).join(", "),
            };
        }
        const [astrid] = matches;

        // Validate all CJ fields are provided and non-empty
        const cjProductId = args.cjProductId?.trim();
        const cjVariantId = args.cjVariantId?.trim();
        const cjSku = args.cjSku?.trim();
        const hasPlaceholder = [cjProductId, cjVariantId, cjSku].some(
            value => value?.startsWith("REPLACE_")
        );

        if (!cjProductId || !cjVariantId || !cjSku || hasPlaceholder) {
            return {
                success: false,
                message: `Found "${astrid.name}" (ID: ${astrid._id}). ` +
                    `Current status: ${astrid.cjSourcingStatus || 'none'}, ` +
                    `cjSourcingId: ${astrid.cjSourcingId || 'none'}, ` +
                    `cjProductId: ${astrid.cjProductId || 'none'}. ` +
                    `Please provide cjProductId, cjVariantId, and cjSku from the CJ dashboard.`,
                productId: astrid._id,
                currentStatus: astrid.cjSourcingStatus,
                cjSourcingId: astrid.cjSourcingId,
                images: astrid.images,
            };
        }

        await ctx.db.patch(astrid._id, {
            cjSourcingStatus: "approved",
            cjProductId,
            cjVariantId,
            cjSku,
            cjSourcingError: undefined,
            cjApprovedAt: new Date().toISOString(),
            inStock: true,
        });

        return {
            success: true,
            message: `"${astrid.name}" approved with CJ product ID ${cjProductId}`,
            productId: astrid._id,
            cjProductId,
        };
    },
});

/**
 * ADMIN: Manually approve any product with CJ data
 * Reusable mutation for when webhooks/crons miss an approval.
 * Can optionally populate cjVariants array for the Variant Mapping UI.
 */
export const approveProductWithCjData = mutation({
    args: {
        productId: v.id("products"),
        cjProductId: v.string(),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        cjVariants: v.optional(v.array(v.object({
            vid: v.string(),
            sku: v.string(),
            name: v.string(),
            price: v.optional(v.number()),
            image: v.optional(v.string()),
        }))),
        // Optionally fix broken images at the same time
        newImages: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to approve products");
        }

        const product = await ctx.db.get(args.productId);
        if (!product) {
            throw new Error(`Product ${args.productId} not found`);
        }

        const hasCustomerVariants = (product.variants?.length ?? 0) > 0;
        const effectiveCjVariants = args.cjVariants ?? product.cjVariants;
        const effectiveCjVariantId = args.cjVariantId ?? product.cjVariantId;

        if (hasCustomerVariants && (!effectiveCjVariants || effectiveCjVariants.length === 0)) {
            throw new Error("Approved products with customer variants must include cjVariants");
        }
        if (!hasCustomerVariants && !effectiveCjVariantId) {
            throw new Error("Approved products without customer variants must include cjVariantId");
        }

        const updateData: Record<string, any> = {
            cjSourcingStatus: "approved",
            cjProductId: args.cjProductId,
            cjSourcingError: undefined,
            cjApprovedAt: new Date().toISOString(),
            inStock: true,
        };

        if (args.cjVariantId) updateData.cjVariantId = args.cjVariantId;
        if (args.cjSku) updateData.cjSku = args.cjSku;
        if (args.cjVariants) updateData.cjVariants = args.cjVariants;
        if (args.newImages) updateData.images = args.newImages;

        await ctx.db.patch(args.productId, updateData);

        return {
            success: true,
            message: `"${product.name}" manually approved`,
            productId: args.productId,
            cjProductId: args.cjProductId,
            variantCount: args.cjVariants?.length || 0,
            imageFixed: !!args.newImages,
        };
    },
});

/**
 * DIAGNOSTIC: Audit all products for health issues
 * Returns products with broken images, stuck sourcing, or missing CJ data
 */
export const auditProductHealth = query({
    args: {},
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) {
            throw new Error("You must be logged in to audit product health");
        }

        const allProducts = await ctx.db.query("products").collect();

        const issues: Array<{
            productId: string;
            name: string;
            problems: string[];
            cjSourcingStatus?: string;
            cjSourcingId?: string;
            cjProductId?: string;
            cjVariantId?: string;
            imageCount: number;
            firstImageUrl?: string;
            hasVariants: boolean;
            hasCjVariants: boolean;
        }> = [];

        for (const product of allProducts) {
            const problems: string[] = [];

            // Check for missing/broken images
            if (!product.images || product.images.length === 0) {
                problems.push("No images");
            } else {
                const firstImg = product.images[0];
                if (firstImg.startsWith("//")) {
                    problems.push("Protocol-relative image URL (missing https:)");
                }
                if (firstImg.includes("1688.com") || firstImg.includes("alicdn.com") || firstImg.includes("cbu01.alicdn")) {
                    problems.push("Image hosted on 1688/AliExpress CDN (may expire)");
                }
                if (firstImg.includes("photo-1612196808214")) {
                    problems.push("Known broken Unsplash URL");
                }
            }

            // Check for stuck sourcing
            if (product.cjSourcingStatus === "pending") {
                const submittedAt = product.cjSubmittedAt ? new Date(product.cjSubmittedAt).getTime() : 0;
                const hoursSinceSubmission = submittedAt ? (Date.now() - submittedAt) / (1000 * 60 * 60) : 0;
                if (hoursSinceSubmission > 48) {
                    problems.push(`Stuck pending for ${Math.round(hoursSinceSubmission)}h`);
                }
                if (!product.cjSourcingId) {
                    problems.push("Pending but no cjSourcingId (never submitted to CJ)");
                }
            }

            // Check for approved products missing CJ data
            if (product.cjSourcingStatus === "approved") {
                const hasCustomerVariants = (product.variants?.length ?? 0) > 0;

                if (!product.cjProductId) problems.push("Approved but missing cjProductId");
                if (!hasCustomerVariants && !product.cjVariantId) {
                    problems.push("Approved but missing cjVariantId");
                }
                if (hasCustomerVariants && (!product.cjVariants || product.cjVariants.length === 0)) {
                    problems.push("Approved but no CJ variants (won't appear in Variant Mapping)");
                }
                if (hasCustomerVariants) {
                    const unlinked = product.variants!.filter(v => !v.cjVariantId);
                    if (unlinked.length > 0) {
                        problems.push(`${unlinked.length}/${product.variants!.length} customer variants not linked to CJ`);
                    }
                }
            }

            if (problems.length > 0) {
                issues.push({
                    productId: product._id,
                    name: product.name,
                    problems,
                    cjSourcingStatus: product.cjSourcingStatus,
                    cjSourcingId: product.cjSourcingId,
                    cjProductId: product.cjProductId,
                    cjVariantId: product.cjVariantId,
                    imageCount: product.images?.length || 0,
                    firstImageUrl: product.images?.[0],
                    hasVariants: (product.variants?.length || 0) > 0,
                    hasCjVariants: (product.cjVariants?.length || 0) > 0,
                });
            }
        }

        return {
            totalProducts: allProducts.length,
            productsWithIssues: issues.length,
            issues,
        };
    },
});


import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { evaluateProductCjReadiness } from "../lib/cjFulfillmentReadiness";
import { requireCjAdminIdentity } from "./cjAdminAccess";
import { internal } from "./_generated/api";

const smartDescriptionValidator = v.object({
    description: v.string(),
    auditId: v.id("descriptionAudits"),
    generatedAt: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    sourceSnapshotHash: v.string(),
    adminEdited: v.boolean(),
    status: v.union(
        v.literal("generated"),
        v.literal("edited"),
        v.literal("approved"),
        v.literal("failed"),
        v.literal("fallback")
    ),
});

const descriptionSourceValidator = v.union(
    v.literal("admin_written"),
    v.literal("ai_generated"),
    v.literal("ai_generated_admin_edited"),
    v.literal("source_original"),
    v.literal("safe_fallback")
);

const descriptionFingerprintValidator = v.object({
    normalizedOpening: v.string(),
    topPhrases: v.array(v.string()),
    productType: v.string(),
    collection: v.string(),
});

const pricingSourceValidator = v.union(
    v.literal("source_estimate"),
    v.literal("cj_catalog_confirmed"),
    v.literal("cj_freight_confirmed"),
    v.literal("manual_locked"),
    v.literal("order_reconciled")
);

const productStorefrontStatusValidator = v.union(
    v.literal("published"),
    v.literal("hidden"),
    v.literal("next_launch")
);

const cjInventoryStatusValidator = v.union(
    v.literal("unknown"),
    v.literal("in_stock"),
    v.literal("low_stock"),
    v.literal("out_of_stock"),
    v.literal("partial"),
    v.literal("error")
);

const cjInventorySnapshotValidator = v.object({
    vid: v.optional(v.string()),
    sku: v.optional(v.string()),
    totalInventoryNum: v.optional(v.number()),
    cjInventoryNum: v.optional(v.number()),
    factoryInventoryNum: v.optional(v.number()),
    status: cjInventoryStatusValidator,
    lowStockThreshold: v.number(),
    lastCheckedAt: v.string(),
    error: v.optional(v.string()),
});

const cjVariantValidator = v.object({
    vid: v.string(),
    sku: v.string(),
    name: v.string(),
    price: v.optional(v.number()),
    image: v.optional(v.string()),
});

const isProductVisibleOnStorefront = (product: {
    storefrontStatus?: "published" | "hidden" | "next_launch";
    cjSourcingStatus?: "pending" | "approved" | "rejected" | "none";
    cjSourcingState?: string;
    cjFulfillmentReadiness?: "not_required" | "not_ready" | "mapping_required" | "ready" | "blocked";
    inStock?: boolean;
    cjInventoryStatus?: string;
}) => {
    const visibilityReady = !product.storefrontStatus || product.storefrontStatus === "published";
    const fulfillmentReady = product.cjSourcingState
        ? product.cjFulfillmentReadiness === "ready" || product.cjFulfillmentReadiness === "not_required"
        : !product.cjSourcingStatus || product.cjSourcingStatus === "none" || product.cjSourcingStatus === "approved";
    const inventoryReady = product.inStock !== false && product.cjInventoryStatus !== "out_of_stock";
    return visibilityReady && fulfillmentReady && inventoryReady;
};

const buildProductSearchText = (product: {
    name?: string;
    description?: string;
    category?: string;
    collection?: string;
    subcategory?: string;
}) => normalizeName([
    product.name,
    product.description,
    product.category,
    product.collection,
    product.subcategory,
].filter(Boolean).join(" ")).slice(0, 8_000);

// Full product documents contain sourcing, pricing, provider, and audit fields.
// They are intentionally restricted to the signed-in admin. Storefront queries
// below return a customer-visible projection only.
export const list = query({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.db.query("products").take(500);
    },
});

export const getAdmin = query({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.db.get(args.id);
    },
});

export const getInternal = internalQuery({
    args: { id: v.id("products") },
    handler: (ctx, args) => ctx.db.get(args.id),
});

export const get = query({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.id);
        if (!product || !isProductVisibleOnStorefront(product)) return null;
        return toStorefrontProduct(product);
    },
});

const toStorefrontProduct = (product: any) => ({
    _id: product._id,
    _creationTime: product._creationTime,
    name: product.name,
    price: product.price,
    description: product.description,
    images: Array.isArray(product.images) ? product.images.slice(0, 24) : [],
    category: product.category,
    collection: product.collection,
    subcategory: product.subcategory,
    isNew: product.isNew,
    inStock: product.inStock,
    publishedAt: product.publishedAt,
    storefrontStatus: product.storefrontStatus,
    variants: Array.isArray(product.variants)
        ? product.variants.slice(0, 100).map((variant: any) => ({
            id: variant.id,
            name: variant.name,
            image: variant.image,
            priceAdjustment: variant.priceAdjustment,
            inStock: variant.inStock,
        }))
        : undefined,
});

function normalizeName(value = ""): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export const findExistingSmartNames = internalQuery({
    args: {
        collection: v.string(),
        productType: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit || 30, 1), 80);
        const typeWords = normalizeName(args.productType).split(" ").filter(word => word.length > 2);
        const products = await ctx.db
            .query("products")
            .filter(q => q.eq(q.field("collection"), args.collection))
            .take(120);

        const names = products
            .map(product => product.name)
            .filter((name): name is string => Boolean(name?.trim()));
        const prioritized = names.filter(name => {
            const normalized = normalizeName(name);
            return typeWords.length === 0 || typeWords.some(word => normalized.includes(word));
        });
        return [...new Set([...prioritized, ...names])].slice(0, limit);
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
        publishedAt: v.optional(v.string()),
        storefrontStatus: v.optional(productStorefrontStatusValidator),
        launchBatchId: v.optional(v.string()),
        launchAddedAt: v.optional(v.string()),
        launchedAt: v.optional(v.string()),
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
        batchImportItemId: v.optional(v.id("batchImportItems")),
        cjSourcingStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("none")
        )),
        // Two-stage pricing metadata
        sourcePriceCny: v.optional(v.number()),
        rawSourceDescription: v.optional(v.string()),
        rawHtmlDescription: v.optional(v.string()),
        descriptionImages: v.optional(v.array(v.string())),
        estimatedCjCost: v.optional(v.number()),
        estimatedShipping: v.optional(v.number()),
        estimatedCjProductCost: v.optional(v.number()),
        estimatedCjShippingCost: v.optional(v.number()),
        estimatedCjServiceFee: v.optional(v.number()),
        estimatedLandedCost: v.optional(v.number()),
        confirmedCjProductCost: v.optional(v.number()),
        confirmedCjShippingCost: v.optional(v.number()),
        confirmedCjServiceFee: v.optional(v.number()),
        confirmedCjTaxesFee: v.optional(v.number()),
        confirmedCjClearanceFee: v.optional(v.number()),
        confirmedCjRemoteFee: v.optional(v.number()),
        confirmedCjLogisticsName: v.optional(v.string()),
        confirmedLandedCost: v.optional(v.number()),
        suggestedRetailPrice: v.optional(v.number()),
        adminPriceLocked: v.optional(v.boolean()),
        pricingSource: v.optional(pricingSourceValidator),
        pricingUpdatedAt: v.optional(v.number()),
        pricingWarnings: v.optional(v.array(v.string())),
        pricingStage: v.optional(v.union(
            v.literal("estimated"),
            v.literal("confirmed")
        )),
        // Multi-category support
        subcategory: v.optional(v.string()),
        smartDescription: v.optional(smartDescriptionValidator),
        descriptionSource: v.optional(descriptionSourceValidator),
        descriptionFingerprint: v.optional(descriptionFingerprintValidator),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        if (args.batchImportItemId) {
            const existing = await ctx.db.query("products")
                .withIndex("by_batch_import_item", q => q.eq("batchImportItemId", args.batchImportItemId))
                .unique();
            if (existing) return existing._id;
        }
        const productId = await ctx.db.insert("products", {
            ...args,
            publishedAt: args.publishedAt || new Date().toISOString(),
            searchText: buildProductSearchText(args),
        });
        if (args.cjSourcingStatus === "pending" && args.sourceUrl) {
            await ctx.scheduler.runAfter(0, internal.cjSourcingJobs.ensureJobForProduct, {
                productId,
                source: "import",
            });
        }
        return productId;
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
        publishedAt: v.optional(v.string()),
        storefrontStatus: v.optional(productStorefrontStatusValidator),
        launchBatchId: v.optional(v.string()),
        launchAddedAt: v.optional(v.string()),
        launchedAt: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        cjSourcingStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("none")
        )),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        cjProductId: v.optional(v.string()),
        cjInventoryStatus: v.optional(cjInventoryStatusValidator),
        cjInventoryTotal: v.optional(v.number()),
        cjInventoryLastCheckedAt: v.optional(v.string()),
        cjInventoryNextCheckAt: v.optional(v.number()),
        cjInventoryError: v.optional(v.string()),
        cjInventoryNeedsReview: v.optional(v.boolean()),
        cjInventoryReviewReason: v.optional(v.union(
            v.literal("restocked"),
            v.literal("out_of_stock"),
            v.literal("manual")
        )),
        cjInventoryRestockedAt: v.optional(v.string()),
        cjInventoryAutoHiddenAt: v.optional(v.string()),
        cjInventoryPreviousStatus: v.optional(cjInventoryStatusValidator),
        cjInventoryLastStatusChangeAt: v.optional(v.string()),
        cjInventoryLastWebhookAt: v.optional(v.string()),
        cjInventoryByVariant: v.optional(v.array(cjInventorySnapshotValidator)),
        cjVariants: v.optional(v.array(cjVariantValidator)),
        sourcePriceCny: v.optional(v.number()),
        rawSourceDescription: v.optional(v.string()),
        rawHtmlDescription: v.optional(v.string()),
        descriptionImages: v.optional(v.array(v.string())),
        estimatedCjCost: v.optional(v.number()),
        estimatedShipping: v.optional(v.number()),
        estimatedCjProductCost: v.optional(v.number()),
        estimatedCjShippingCost: v.optional(v.number()),
        estimatedCjServiceFee: v.optional(v.number()),
        estimatedLandedCost: v.optional(v.number()),
        confirmedCjProductCost: v.optional(v.number()),
        confirmedCjShippingCost: v.optional(v.number()),
        confirmedCjServiceFee: v.optional(v.number()),
        confirmedCjTaxesFee: v.optional(v.number()),
        confirmedCjClearanceFee: v.optional(v.number()),
        confirmedCjRemoteFee: v.optional(v.number()),
        confirmedCjLogisticsName: v.optional(v.string()),
        confirmedLandedCost: v.optional(v.number()),
        suggestedRetailPrice: v.optional(v.number()),
        adminPriceLocked: v.optional(v.boolean()),
        pricingSource: v.optional(pricingSourceValidator),
        pricingUpdatedAt: v.optional(v.number()),
        pricingWarnings: v.optional(v.array(v.string())),
        pricingStage: v.optional(v.union(
            v.literal("estimated"),
            v.literal("confirmed")
        )),
        subcategory: v.optional(v.string()),
        smartDescription: v.optional(smartDescriptionValidator),
        descriptionSource: v.optional(descriptionSourceValidator),
        descriptionFingerprint: v.optional(descriptionFingerprintValidator),
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
        await requireCjAdminIdentity(ctx);
        const { id, ...updates } = args;
        // Filter out undefined values
        const filteredUpdates = Object.fromEntries(
            Object.entries(updates).filter(([_, v]) => v !== undefined)
        );
        const existing = await ctx.db.get(id);
        const searchFieldsChanged = ["name", "description", "category", "collection", "subcategory"]
            .some(field => Object.prototype.hasOwnProperty.call(filteredUpdates, field));
        await ctx.db.patch(id, {
            ...filteredUpdates,
            ...(existing && searchFieldsChanged
                ? { searchText: buildProductSearchText({ ...existing, ...filteredUpdates }) }
                : {}),
        });
    },
});

export const remove = mutation({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        await ctx.db.delete(args.id);
    },
});

/**
 * Admin-only remove - simpler version for CJ Settings panel
 * Requires the configured admin allowlist.
 */
export const adminRemove = mutation({
    args: { id: v.id("products") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
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
        // Bounded for safety. The storefront currently has far fewer products;
        // introduce pagination before the catalog approaches this ceiling.
        const allProducts = await ctx.db.query("products").take(500);

        return allProducts.filter(isProductVisibleOnStorefront).map(toStorefrontProduct);
    },
});

export const searchStorefront = query({
    args: { term: v.string(), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const term = normalizeName(args.term).slice(0, 80);
        if (term.length < 2) return [];
        const limit = Math.min(Math.max(args.limit ?? 20, 1), 20);
        const terms = term.split(" ").filter(Boolean);
        const searchLimit = Math.min(limit * 4, 80);
        const [publishedProducts, legacyPublishedProducts] = await Promise.all([
            ctx.db.query("products")
                .withSearchIndex("search_storefront", q =>
                    q.search("searchText", term).eq("storefrontStatus", "published"),
                )
                .take(searchLimit),
            ctx.db.query("products")
                .withSearchIndex("search_storefront", q =>
                    q.search("searchText", term).eq("storefrontStatus", undefined),
                )
                .take(searchLimit),
        ]);
        const products = [...publishedProducts, ...legacyPublishedProducts]
            .filter((product, index, all) =>
                all.findIndex(candidate => candidate._id === product._id) === index,
            );

        return products
            .filter(isProductVisibleOnStorefront)
            .filter((product) => {
                const haystack = product.searchText || buildProductSearchText(product);
                return terms.every((searchTerm) => haystack.includes(searchTerm));
            })
            .slice(0, limit)
            .map(toStorefrontProduct);
    },
});

export const backfillSearchText = mutation({
    args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
        const products = await ctx.db.query("products")
            .withIndex("by_search_text", q => q.eq("searchText", undefined))
            .take(limit);
        if (!args.dryRun) {
            for (const product of products) {
                await ctx.db.patch(product._id, { searchText: buildProductSearchText(product) });
            }
        }
        return { dryRun: args.dryRun, candidates: products.length, hasMore: products.length === limit };
    },
});

export const launchNextProducts = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);

        const now = new Date().toISOString();
        const launchBatchId = `launch-${Date.now()}`;
        const products = await ctx.db
            .query("products")
            .withIndex("by_storefront_status", (q) => q.eq("storefrontStatus", "next_launch"))
            .collect();

        for (const product of products) {
            await ctx.db.patch(product._id, {
                storefrontStatus: "published",
                isNew: true,
                publishedAt: now,
                launchedAt: now,
                launchBatchId,
            });
        }

        return { launched: products.length, launchBatchId };
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
        await requireCjAdminIdentity(ctx);

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
        await requireCjAdminIdentity(ctx);

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

export const removeCustomerVariant = mutation({
    args: {
        productId: v.id("products"),
        customerVariantId: v.string(),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);

        const product = await ctx.db.get(args.productId);
        if (!product || !product.variants) {
            throw new Error("Product or variants not found");
        }

        const updatedVariants = product.variants.filter(variant => variant.id !== args.customerVariantId);
        await ctx.db.patch(args.productId, {
            variants: updatedVariants,
            inStock: updatedVariants.length === 0 ? false : product.inStock,
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
        await requireCjAdminIdentity(ctx);

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
        await requireCjAdminIdentity(ctx);

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
        await requireCjAdminIdentity(ctx);

        const allProducts = await ctx.db.query("products").collect();

        const issues: Array<{
            productId: string;
            name: string;
            problems: string[];
            cjSourcingStatus?: string;
            cjSourcingId?: string;
            cjProductId?: string;
            cjVariantId?: string;
            cjInventoryStatus?: string;
            cjInventoryTotal?: number;
            cjInventoryLastCheckedAt?: string;
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

            const hasCjFootprint =
                (product.cjSourcingStatus !== undefined && product.cjSourcingStatus !== "none") ||
                Boolean(product.cjProductId || product.cjVariantId || product.cjSku || (product.cjVariants?.length ?? 0) > 0);
            if (hasCjFootprint) {
                const readiness = evaluateProductCjReadiness(product);
                for (const problem of [...readiness.errors, ...readiness.warnings]) {
                    problems.push(problem);
                }
            }

            const uniqueProblems = [...new Set(problems)];

            if (uniqueProblems.length > 0) {
                issues.push({
                    productId: product._id,
                    name: product.name,
                    problems: uniqueProblems,
                    cjSourcingStatus: product.cjSourcingStatus,
                    cjSourcingId: product.cjSourcingId,
                    cjProductId: product.cjProductId,
                    cjVariantId: product.cjVariantId,
                    cjInventoryStatus: product.cjInventoryStatus,
                    cjInventoryTotal: product.cjInventoryTotal,
                    cjInventoryLastCheckedAt: product.cjInventoryLastCheckedAt,
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


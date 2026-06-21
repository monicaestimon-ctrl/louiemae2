import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { calculatePricingBreakdown } from "../lib/pricing";

const hasFiniteNumber = (value: unknown): boolean => Number.isFinite(Number(value));

// ═══════════════════════════════════════════════════════════════════════════
// CJ DROPSHIPPING DATABASE HELPERS
// These must be in a non-Node.js file for Convex to allow queries/mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update order CJ status and error
 */
export const updateOrderCjStatus = internalMutation({
    args: {
        orderId: v.id("orders"),
        cjStatus: v.union(
            v.literal("pending"),
            v.literal("sending"),
            v.literal("confirmed"),
            v.literal("processing"),
            v.literal("shipped"),
            v.literal("delivered"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        cjOrderId: v.optional(v.string()),
        cjError: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.orderId, {
            cjStatus: args.cjStatus,
            cjOrderId: args.cjOrderId,
            cjError: args.cjError || undefined,
            cjLastSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    },
});

/**
 * Update order tracking information
 */
export const updateOrderTracking = internalMutation({
    args: {
        orderId: v.id("orders"),
        trackingNumber: v.string(),
        trackingUrl: v.optional(v.string()),
        carrier: v.optional(v.string()),
        cjStatus: v.optional(v.union(
            v.literal("shipped"),
            v.literal("delivered")
        )),
    },
    handler: async (ctx, args) => {
        const updateData: Record<string, any> = {
            trackingNumber: args.trackingNumber,
            trackingUrl: args.trackingUrl,
            carrier: args.carrier,
            shippedAt: new Date().toISOString(),
            cjLastSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (args.cjStatus) {
            updateData.cjStatus = args.cjStatus;
            updateData.status = args.cjStatus; // Also update main order status
        }

        await ctx.db.patch(args.orderId, updateData);
    },
});

/**
 * Get orders that need tracking sync
 * (CJ confirmed/processing but not yet shipped)
 */
export const getOrdersNeedingSync = internalQuery({
    args: {},
    handler: async (ctx) => {
        // Get orders with CJ status confirmed or processing
        const orders = await ctx.db
            .query("orders")
            .filter((q) =>
                q.or(
                    q.eq(q.field("cjStatus"), "confirmed"),
                    q.eq(q.field("cjStatus"), "processing")
                )
            )
            .collect();

        // Filter to only those that haven't been synced recently (1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        return orders.filter(o => !o.cjLastSyncAt || o.cjLastSyncAt < oneHourAgo);
    },
});

/**
 * Handle CJ order webhook update
 * Called when CJ sends order status updates
 */
export const handleCjWebhookUpdate = internalMutation({
    args: {
        orderNumber: v.string(),
        cjOrderId: v.optional(v.string()),
        cjStatus: v.string(),
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        carrier: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Find order by the order number we used when creating it
        // We use the last 12 chars of stripeSessionId uppercase as orderNumber
        const allOrders = await ctx.db.query("orders").collect();
        const order = allOrders.find(o =>
            o.stripeSessionId.slice(-12).toUpperCase() === args.orderNumber
        );

        if (!order) {
            console.error(`CJ Webhook: Order not found for orderNumber: ${args.orderNumber}`);
            return;
        }

        // Build update object
        const updateData: Record<string, any> = {
            cjLastSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Map cjStatus string to valid status
        const validStatuses = ["pending", "sending", "confirmed", "processing", "shipped", "delivered", "failed", "cancelled"];
        if (validStatuses.includes(args.cjStatus)) {
            updateData.cjStatus = args.cjStatus;

            // Also update main order status for shipped/delivered
            if (args.cjStatus === "shipped") {
                updateData.status = "shipped";
            } else if (args.cjStatus === "delivered") {
                updateData.status = "delivered";
            }
        }

        if (args.cjOrderId) {
            updateData.cjOrderId = args.cjOrderId;
        }

        if (args.trackingNumber) {
            updateData.trackingNumber = args.trackingNumber;
            updateData.shippedAt = new Date().toISOString();
        }

        if (args.trackingUrl) {
            updateData.trackingUrl = args.trackingUrl;
        }

        if (args.carrier) {
            updateData.carrier = args.carrier;
        }

        await ctx.db.patch(order._id, updateData);

        console.log(`CJ Webhook: Updated order ${order._id} with status ${args.cjStatus}`);
    },
});

/**
 * Handle CJ logistics/tracking webhook update
 * Called when CJ sends logistics/shipping updates
 */
export const handleCjLogisticsUpdate = internalMutation({
    args: {
        cjOrderId: v.string(),
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        carrier: v.optional(v.string()),
        cjStatus: v.string(),
    },
    handler: async (ctx, args) => {
        // Find order by CJ order ID
        const allOrders = await ctx.db.query("orders").collect();
        const order = allOrders.find(o => o.cjOrderId === args.cjOrderId);

        if (!order) {
            console.error(`CJ Logistics Webhook: Order not found for cjOrderId: ${args.cjOrderId}`);
            return;
        }

        const updateData: Record<string, any> = {
            cjLastSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Map status
        const validStatuses = ["shipped", "delivered", "failed"];
        if (validStatuses.includes(args.cjStatus)) {
            updateData.cjStatus = args.cjStatus;
            updateData.status = args.cjStatus; // Sync main status
        }

        if (args.trackingNumber) {
            updateData.trackingNumber = args.trackingNumber;
            if (!order.shippedAt) {
                updateData.shippedAt = new Date().toISOString();
            }
        }

        if (args.trackingUrl) {
            updateData.trackingUrl = args.trackingUrl;
        }

        if (args.carrier) {
            updateData.carrier = args.carrier;
        }

        await ctx.db.patch(order._id, updateData);

        console.log(`CJ Logistics: Updated order ${order._id} with tracking ${args.trackingNumber}, status ${args.cjStatus}`);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDER SPLIT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query: Find order by CJ order ID (for email notification lookup)
 * Uses the by_cj_order_id index for O(1) lookup.
 */
export const getOrderByCjOrderId = internalQuery({
    args: { cjOrderId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("orders")
            .withIndex("by_cj_order_id", q => q.eq("cjOrderId", args.cjOrderId))
            .first();
    },
});

/**
 * Mutation: Handle CJ order split — persist split order data on the parent order.
 * Merges new entries with existing split data to avoid dropping tracking info
 * that was already written by handleSplitOrderTrackingUpdate.
 */
export const handleCjOrderSplitUpdate = internalMutation({
    args: {
        originalCjOrderId: v.string(),
        splitOrders: v.array(v.object({
            cjOrderId: v.string(),
            orderStatus: v.optional(v.number()),
            splitAt: v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const order = await ctx.db
            .query("orders")
            .withIndex("by_cj_order_id", q => q.eq("cjOrderId", args.originalCjOrderId))
            .first();

        if (!order) {
            console.error(`CJ ORDERSPLIT: Parent order not found for cjOrderId=${args.originalCjOrderId}`);
            return;
        }

        // Merge with existing split data to preserve tracking already written
        const existingById = new Map(
            (order.splitOrders ?? []).map(s => [s.cjOrderId, s])
        );
        for (const incoming of args.splitOrders) {
            const existing = existingById.get(incoming.cjOrderId);
            if (existing) {
                // Preserve existing tracking fields, update status/splitAt
                existingById.set(incoming.cjOrderId, {
                    ...existing,
                    orderStatus: incoming.orderStatus ?? existing.orderStatus,
                    splitAt: incoming.splitAt,
                });
            } else {
                existingById.set(incoming.cjOrderId, {
                    cjOrderId: incoming.cjOrderId,
                    orderStatus: incoming.orderStatus,
                    splitAt: incoming.splitAt,
                });
            }
        }

        const mergedSplitOrders = [...existingById.values()];

        await ctx.db.patch(order._id, {
            splitOrders: mergedSplitOrders,
            updatedAt: new Date().toISOString(),
        });

        console.log(`CJ ORDERSPLIT: Saved ${mergedSplitOrders.length} split orders on parent ${order._id}`);
    },
});

/**
 * Mutation: Update tracking info on a split sub-order.
 * Also syncs the parent order's shipment status based on all children.
 */
export const handleSplitOrderTrackingUpdate = internalMutation({
    args: {
        splitCjOrderId: v.string(),
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        carrier: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Find any order that has this splitCjOrderId in its splitOrders array
        // Note: splitOrders is a nested array — no index possible, so scan is needed
        // Perf: if this latency grows, introduce a denormalized splitCjOrderId → parentOrderId table
        const scanStart = Date.now();
        const ordersWithSplits = await ctx.db.query("orders")
            .filter((q) => q.neq(q.field("splitOrders"), undefined))
            .collect();
        const order = ordersWithSplits.find(o =>
            o.splitOrders!.some((s: any) => s.cjOrderId === args.splitCjOrderId)
        );
        const scanMs = Date.now() - scanStart;
        if (scanMs > 500 || ordersWithSplits.length > 500) {
            console.warn(`CJ Split Tracking: Table scan took ${scanMs}ms over ${ordersWithSplits.length} split-order parents (consider denormalized lookup)`);
        }

        if (!order || !order.splitOrders) {
            // Not a split order — this is expected for most logistics updates
            return;
        }

        // Update the specific split order entry with tracking info
        const updatedSplitOrders = order.splitOrders.map((s: any) => {
            if (s.cjOrderId !== args.splitCjOrderId) return s;
            return {
                ...s,
                trackingNumber: args.trackingNumber || s.trackingNumber,
                trackingUrl: args.trackingUrl || s.trackingUrl,
                carrier: args.carrier || s.carrier,
            };
        });

        // Sync parent order status based on split children:
        // - If ALL children have tracking → "shipped"
        // - If ANY child has tracking → "shipped" (partial)
        // - Never downgrade from "delivered"
        const patchData: Record<string, any> = {
            splitOrders: updatedSplitOrders,
            updatedAt: new Date().toISOString(),
        };

        if (order.status !== "delivered" && order.cjStatus !== "delivered") {
            const anyChildShipped = updatedSplitOrders.some((s: any) => s.trackingNumber);
            if (anyChildShipped) {
                patchData.cjStatus = "shipped";
                patchData.status = "shipped";
                if (!order.shippedAt) {
                    patchData.shippedAt = new Date().toISOString();
                }
            }
        }

        await ctx.db.patch(order._id, patchData);

        console.log(`CJ Split Tracking: Updated split order ${args.splitCjOrderId} on parent ${order._id} with tracking ${args.trackingNumber}`);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT SOURCING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update product CJ sourcing status
 */
export const updateProductSourcingStatus = internalMutation({
    args: {
        productId: v.id("products"),
        status: v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("none")
        ),
        sourcingId: v.optional(v.string()),
        cjProductId: v.optional(v.string()),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        error: v.optional(v.string()),
        confirmedCjCost: v.optional(v.number()),
        confirmedCjShippingCost: v.optional(v.number()),
        confirmedCjServiceFee: v.optional(v.number()),
        confirmedCjTaxesFee: v.optional(v.number()),
        confirmedCjClearanceFee: v.optional(v.number()),
        confirmedCjRemoteFee: v.optional(v.number()),
        confirmedCjLogisticsName: v.optional(v.string()),
        cjRawPricingResponse: v.optional(v.any()),
        // CAS guard: if provided, only apply the write when the product's
        // current cjSourcingStatus matches this value. Prevents the cron job
        // from overwriting a concurrent SOURCINGCREATE webhook update.
        expectedStatus: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Idempotency check: if product is already in the desired status, skip update
        const product = await ctx.db.get(args.productId);
        if (!product) {
            console.log(`updateProductSourcingStatus: Product ${args.productId} not found`);
            return;
        }

        // CAS guard: if the caller specified an expected status and the product has
        // since been updated (e.g., by a concurrent webhook), bail out to avoid
        // overwriting with stale data.
        if (args.expectedStatus && product.cjSourcingStatus !== args.expectedStatus) {
            console.log(
                `updateProductSourcingStatus: CAS conflict for ${args.productId} — ` +
                `expected "${args.expectedStatus}" but found "${product.cjSourcingStatus}", skipping`
            );
            return;
        }

        // Skip if already approved AND no new data to update (prevents duplicate webhook processing)
        // But allow through if confirmedCjCost or other payload arrives for an already-approved product
        const hasUpdatePayload =
            hasFiniteNumber(args.confirmedCjCost) ||
            hasFiniteNumber(args.confirmedCjShippingCost) ||
            hasFiniteNumber(args.confirmedCjServiceFee) ||
            hasFiniteNumber(args.confirmedCjTaxesFee) ||
            hasFiniteNumber(args.confirmedCjClearanceFee) ||
            hasFiniteNumber(args.confirmedCjRemoteFee) ||
            !!args.sourcingId ||
            !!args.cjProductId ||
            !!args.cjVariantId ||
            !!args.cjSku ||
            !!args.error;

        if (args.status === "approved" && product.cjSourcingStatus === "approved" && !hasUpdatePayload) {
            console.log(`updateProductSourcingStatus: Product ${args.productId} already approved, skipping`);
            return;
        }

        const updateData: Record<string, any> = {
            cjSourcingStatus: args.status,
        };

        if (args.sourcingId) {
            updateData.cjSourcingId = args.sourcingId;
        }
        if (args.cjProductId) {
            updateData.cjProductId = args.cjProductId;
        }
        if (args.cjVariantId) {
            updateData.cjVariantId = args.cjVariantId;
        }
        if (args.cjSku) {
            updateData.cjSku = args.cjSku;
        }
        if (args.error) {
            updateData.cjSourcingError = args.error;
        }
        if (args.status === "approved") {
            updateData.cjApprovedAt = new Date().toISOString();
            // Clear any stale rejection metadata from a prior rejected state.
            // Without this, a re-approved product retains the old error string.
            updateData.cjSourcingError = undefined;
        }

        // Stage 2 pricing: recalculate selling price from confirmed CJ cost
        const hasPricingPayload =
            hasFiniteNumber(args.confirmedCjCost) ||
            hasFiniteNumber(args.confirmedCjShippingCost) ||
            hasFiniteNumber(args.confirmedCjServiceFee) ||
            hasFiniteNumber(args.confirmedCjTaxesFee) ||
            hasFiniteNumber(args.confirmedCjClearanceFee) ||
            hasFiniteNumber(args.confirmedCjRemoteFee);

        if (hasPricingPayload) {
            const confirmedProductCost =
                args.confirmedCjCost ??
                product.confirmedCjProductCost ??
                product.confirmedCjCost;
            const confirmedShippingCost =
                args.confirmedCjShippingCost ??
                product.confirmedCjShippingCost;
            const confirmedServiceFee =
                args.confirmedCjServiceFee ??
                product.confirmedCjServiceFee ??
                0;
            const confirmedTaxesFee =
                args.confirmedCjTaxesFee ??
                product.confirmedCjTaxesFee ??
                0;
            const confirmedClearanceFee =
                args.confirmedCjClearanceFee ??
                product.confirmedCjClearanceFee ??
                0;
            const confirmedRemoteFee =
                args.confirmedCjRemoteFee ??
                product.confirmedCjRemoteFee ??
                0;
            const sourcePriceUsd = product.estimatedCjProductCost
                ? product.estimatedCjProductCost / 1.4
                : product.estimatedCjCost
                    ? product.estimatedCjCost / 1.4
                    : undefined;
            const pricing = calculatePricingBreakdown({
                sourcePriceUsd,
                collection: product.collection,
                confirmedProductCost,
                confirmedShippingCost,
                fees: {
                    serviceFee: confirmedServiceFee,
                    taxesFee: confirmedTaxesFee,
                    clearanceFee: confirmedClearanceFee,
                    remoteFee: confirmedRemoteFee,
                },
                currentRetailPrice: product.price,
                adminLockedPrice: product.adminPriceLocked,
                pricingSource: hasFiniteNumber(confirmedShippingCost) ? "cj_freight_confirmed" : "cj_catalog_confirmed",
            });
            const adminPriceLocked = Boolean(product.adminPriceLocked);

            updateData.confirmedCjCost = confirmedProductCost;
            updateData.confirmedCjProductCost = confirmedProductCost;
            updateData.confirmedCjShippingCost = confirmedShippingCost;
            updateData.confirmedCjServiceFee = confirmedServiceFee;
            updateData.confirmedCjTaxesFee = confirmedTaxesFee;
            updateData.confirmedCjClearanceFee = confirmedClearanceFee;
            updateData.confirmedCjRemoteFee = confirmedRemoteFee;
            updateData.confirmedCjLogisticsName = args.confirmedCjLogisticsName ?? product.confirmedCjLogisticsName;
            updateData.confirmedLandedCost = pricing.landedCost;
            updateData.suggestedRetailPrice = pricing.suggestedRetailPrice;
            updateData.pricingSource = adminPriceLocked ? "manual_locked" : pricing.pricingSource;
            updateData.pricingUpdatedAt = Date.now();
            updateData.pricingWarnings = pricing.warnings;
            updateData.pricingStage = "confirmed";

            if (!adminPriceLocked) {
                updateData.price = pricing.suggestedRetailPrice;
            }

            await ctx.runMutation(internal.pricingAudits.create, {
                productId: args.productId,
                stage: adminPriceLocked ? "manual_locked" : pricing.pricingSource,
                sourcePriceUsd,
                collection: product.collection,
                productCost: pricing.productCost,
                shippingCost: pricing.shippingCost,
                serviceFee: pricing.serviceFee,
                taxesFee: pricing.taxesFee,
                clearanceFee: pricing.clearanceFee,
                remoteFee: pricing.remoteFee,
                otherFee: pricing.otherFee,
                landedCost: pricing.landedCost,
                retailMultiplier: pricing.retailMultiplier,
                suggestedRetailPrice: pricing.suggestedRetailPrice,
                previousPrice: product.price,
                appliedPrice: adminPriceLocked ? product.price : pricing.suggestedRetailPrice,
                adminPriceLocked,
                pricingWarnings: pricing.warnings,
                cjProductId: args.cjProductId ?? product.cjProductId,
                cjVariantId: args.cjVariantId ?? product.cjVariantId,
                cjSku: args.cjSku ?? product.cjSku,
                cjLogisticsName: args.confirmedCjLogisticsName ?? product.confirmedCjLogisticsName,
                cjRawResponse: args.cjRawPricingResponse,
            });

            console.log(`Stage 2 pricing for ${product.name}: landed $${pricing.landedCost} -> suggested $${pricing.suggestedRetailPrice}${adminPriceLocked ? " (admin locked)" : ""}`);
        }

        await ctx.db.patch(args.productId, updateData);
    },
});

/**
 * Get product by CJ product ID
 */
export const getProductByCjProductId = internalQuery({
    args: { cjProductId: v.string() },
    handler: async (ctx, args) => {
        const products = await ctx.db
            .query("products")
            .filter((q) => q.eq(q.field("cjProductId"), args.cjProductId))
            .collect();
        return products;
    },
});

/**
 * Get products pending CJ sourcing approval
 */
export const getProductsPendingSourcing = internalQuery({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "pending"))
            .collect();
    },
});

/**
 * Get approved products that have customer variants but are missing the CJ
 * catalog variants needed by the admin variant mapping UI.
 */
export const getApprovedProductsMissingCjVariants = internalQuery({
    args: {},
    handler: async (ctx) => {
        const products = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "approved"))
            .collect();

        return products.filter((product) =>
            !!product.cjProductId &&
            (product.variants?.length ?? 0) > 0 &&
            (product.cjVariants?.length ?? 0) === 0
        );
    },
});

/**
 * Get rejected products that have a cjSourcingId for re-checking.
 * CJ's ticket lifecycle can cause premature rejections — the cron job
 * re-checks these to auto-correct products that were actually sourced.
 * Only returns products with a cjSourcingId (so we can re-query CJ).
 */
export const getRejectedProductsForRecheck = internalQuery({
    args: {},
    handler: async (ctx) => {
        // Returns all rejected products that have a cjSourcingId (i.e., were submitted to CJ).
        // The caller (checkSourcingStatus cron) applies further recency filtering,
        // cooldown, sorting, and slicing to MAX_RECHECK_BATCH.
        // The SOURCINGCREATE webhook also uses this as a fallback to find matching products.
        //
        // NOTE: .filter() on cjSourcingId runs post-index (in-memory), not at the
        // index level. Acceptable at current scale. If the ratio of rejected products
        // without cjSourcingId grows significantly, consider a compound index.
        const rejected = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "rejected"))
            .filter((q) => q.neq(q.field("cjSourcingId"), undefined))
            .collect();

        return rejected;
    },
});

/**
 * Find a product by its CJ sourcing ID.
 * Used as a fallback in webhook handlers when the product can't be
 * found by cjProductId (which may not be set yet during sourcing).
 */
export const getProductByCjSourcingId = internalQuery({
    args: { cjSourcingId: v.string() },
    handler: async (ctx, args) => {
        // cjSourcingId should be unique per product, so use .first() for efficiency.
        // Returns an array for backward compatibility with callers that check .length.
        const product = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_id", (q) => q.eq("cjSourcingId", args.cjSourcingId))
            .first();
        return product ? [product] : [];
    },
});

/**
 * Find a product by its source URL.
 * Used as a last-resort fallback in webhook handlers when neither
 * cjSourcingId nor cjProductId match any stored product.
 */
export const getProductBySourceUrl = internalQuery({
    args: { sourceUrl: v.string() },
    handler: async (ctx, args) => {
        // Linear scan — acceptable at current product count.
        // Products table is not indexed by sourceUrl; add an index if
        // this becomes a performance concern.
        const allProducts = await ctx.db
            .query("products")
            .collect();
        return allProducts.filter(p => p.sourceUrl === args.sourceUrl);
    },
});

/**
 * Get recently approved products for admin notifications
 */
export const getRecentlyApprovedProducts = internalQuery({
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
 * Get products pending or rejected (for admin view)
 */
export const getProductsWithSourcingIssues = internalQuery({
    args: {},
    handler: async (ctx) => {
        const pending = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "pending"))
            .collect();

        const rejected = await ctx.db
            .query("products")
            .withIndex("by_cj_sourcing_status", (q) => q.eq("cjSourcingStatus", "rejected"))
            .collect();

        return { pending, rejected };
    },
});

/**
 * Delete a product from the database (called by cancelSourcingAndDelete action)
 */
export const deleteProduct = internalMutation({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.productId);
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// CJ VARIANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append a CJ variant from webhook (upsert by vid)
 * Called when CJ sends VARIANT webhooks with size/color options
 */
export const appendCjVariant = internalMutation({
    args: {
        productId: v.id("products"),
        cjVariant: v.object({
            vid: v.string(),
            sku: v.string(),
            name: v.string(),
            price: v.optional(v.number()),
            image: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.productId);
        if (!product) {
            console.error(`Product ${args.productId} not found for CJ variant append`);
            return;
        }

        // Get existing CJ variants or initialize empty array
        const existingVariants = product.cjVariants || [];

        // Check if this vid already exists (upsert)
        const existingIndex = existingVariants.findIndex(v => v.vid === args.cjVariant.vid);

        if (existingIndex >= 0) {
            // Update existing variant
            existingVariants[existingIndex] = args.cjVariant;
        } else {
            // Add new variant
            existingVariants.push(args.cjVariant);
        }

        await ctx.db.patch(args.productId, {
            cjVariants: existingVariants,
            cjSourcingStatus: "approved", // Mark as approved since we're receiving variants
        });

        console.log(`Appended CJ variant ${args.cjVariant.vid} to product ${product.name}`);
    },
});

/**
 * Link a CJ variant to a customer-facing variant (size option)
 * Called from admin UI when user maps CJ variants to sizes
 */
export const linkCjVariantToSize = internalMutation({
    args: {
        productId: v.id("products"),
        customerVariantId: v.string(),  // The internal variant ID (e.g., "size_3t")
        cjVariantId: v.string(),         // CJ vid to link
        cjSku: v.optional(v.string()),   // CJ sku to link
    },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.productId);
        if (!product) {
            throw new Error(`Product ${args.productId} not found`);
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

        console.log(`Linked CJ variant ${args.cjVariantId} to customer variant ${args.customerVariantId}`);
    },
});

/**
 * Unlink a CJ variant from a customer-facing variant
 */
export const unlinkCjVariant = internalMutation({
    args: {
        productId: v.id("products"),
        customerVariantId: v.string(),
    },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.productId);
        if (!product || !product.variants) {
            throw new Error("Product or variants not found");
        }

        const updatedVariants = product.variants.map(v => {
            if (v.id === args.customerVariantId) {
                return {
                    ...v,
                    cjVariantId: undefined,
                    cjSku: undefined,
                };
            }
            return v;
        });

        await ctx.db.patch(args.productId, {
            variants: updatedVariants,
        });
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK DEDUPLICATION HELPERS
// Prevent duplicate processing of CJ webhooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a webhook messageId has already been processed
 */
export const wasWebhookProcessed = internalQuery({
    args: {
        messageId: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("cjWebhookLog")
            .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
            .first();
        return existing !== null;
    },
});

/**
 * Record a processed webhook messageId
 */
export const recordProcessedWebhook = internalMutation({
    args: {
        messageId: v.string(),
        type: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("cjWebhookLog", {
            messageId: args.messageId,
            type: args.type,
            processedAt: new Date().toISOString(),
        });
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// CJ TOKEN STORAGE HELPERS
// Persist tokens in database to avoid rate limiting from frequent token requests
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get stored CJ tokens from database
 */
export const getCjTokens = internalQuery({
    args: {},
    handler: async (ctx) => {
        // Get the most recent token record
        const tokens = await ctx.db.query("cjTokens").order("desc").first();
        return tokens;
    },
});

/**
 * Save CJ tokens to database (creates or updates)
 * Uses CJ's actual expiry date strings from their API response
 */
export const saveCjTokens = internalMutation({
    args: {
        openId: v.optional(v.string()),
        accessToken: v.string(),
        accessTokenExpiryDate: v.string(), // CJ's date string
        refreshToken: v.string(),
        refreshTokenExpiryDate: v.string(), // CJ's date string
        createDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Delete any existing tokens
        const existingTokens = await ctx.db.query("cjTokens").collect();
        for (const token of existingTokens) {
            await ctx.db.delete(token._id);
        }

        // Insert new tokens with CJ's expiry dates
        await ctx.db.insert("cjTokens", {
            openId: args.openId,
            accessToken: args.accessToken,
            accessTokenExpiryDate: args.accessTokenExpiryDate,
            refreshToken: args.refreshToken,
            refreshTokenExpiryDate: args.refreshTokenExpiryDate,
            createDate: args.createDate,
            updatedAt: new Date().toISOString(),
        });
    },
});

/**
 * Update only the access token (when refreshing)
 */
export const updateAccessToken = internalMutation({
    args: {
        accessToken: v.string(),
        accessTokenExpiryDate: v.string(), // CJ's date string
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("cjTokens").order("desc").first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                accessToken: args.accessToken,
                accessTokenExpiryDate: args.accessTokenExpiryDate,
                updatedAt: new Date().toISOString(),
            });
        }
    },
});

/**
 * Public mutation to manually seed CJ tokens into the database
 * Used to break the rate limit cycle by inserting tokens obtained via curl
 */
export const seedCjTokens = mutation({
    args: {
        openId: v.optional(v.string()),
        accessToken: v.string(),
        accessTokenExpiryDate: v.string(),
        refreshToken: v.string(),
        refreshTokenExpiryDate: v.string(),
        createDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Delete any existing tokens
        const existingTokens = await ctx.db.query("cjTokens").collect();
        for (const token of existingTokens) {
            await ctx.db.delete(token._id);
        }

        // Insert new tokens
        await ctx.db.insert("cjTokens", {
            openId: args.openId,
            accessToken: args.accessToken,
            accessTokenExpiryDate: args.accessTokenExpiryDate,
            refreshToken: args.refreshToken,
            refreshTokenExpiryDate: args.refreshTokenExpiryDate,
            createDate: args.createDate,
            updatedAt: new Date().toISOString(),
        });

        return { success: true, message: "CJ tokens seeded successfully" };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT HELPERS FOR ADMIN ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a product by ID (internal use for resubmit action)
 */
export const getProductById = internalQuery({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.productId);
    },
});

/**
 * Clear sourcing status and error for resubmission
 */
export const clearSourcingStatus = internalMutation({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.productId, {
            cjSourcingStatus: "pending",
            cjSourcingId: undefined,
            cjSourcingError: undefined,
            cjSubmittedAt: undefined,
            cjLastCheckedAt: undefined,
        });
    },
});

/**
 * Update product with submission timestamp
 */
export const updateProductSubmittedAt = internalMutation({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.productId, {
            cjSubmittedAt: new Date().toISOString(),
        });
    },
});

/**
 * Update product with last checked timestamp
 */
export const updateProductLastChecked = internalMutation({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.productId, {
            cjLastCheckedAt: new Date().toISOString(),
        });
    },
});

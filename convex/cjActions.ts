"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { auth } from "./auth";
import { getCjAutomationConfig, type CjAutomationConfig } from "../lib/cjAutomation";
import { buildCjRetryOrderPayload } from "../lib/cjOrderRetry";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC CJ ACTIONS
// These actions can be called from the frontend for manual operations
// ═══════════════════════════════════════════════════════════════════════════

const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

const requireAdminIdentity = async (ctx: Parameters<typeof auth.getUserId>[0]) => {
    const userId = await auth.getUserId(ctx).catch(() => null);
    if (!userId) {
        throw new Error("You must be logged in to manage CJ automation.");
    }
};

/**
 * Sync all CJ tracking info (can be called from admin dashboard)
 * Returns count of synced and errored orders
 */
export const syncTracking = action({
    args: {},
    handler: async (ctx): Promise<{ synced: number; errors: number }> => {
        // Call the internal sync action
        const result = await ctx.runAction(internal.cjDropshipping.syncAllTracking, {});
        return result;
    },
});

export const syncOrderTracking = action({
    args: {
        orderId: v.id("orders"),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        message: string;
        trackingNumber?: string;
        trackingUrl?: string;
        carrier?: string;
        cjTrackingStatus?: string;
        estimatedDelivery?: string;
        error?: string;
    }> => {
        await requireAdminIdentity(ctx);

        const order = await ctx.runQuery(internal.cjHelpers.getOrderByIdInternal, {
            orderId: args.orderId,
        });
        if (!order) {
            return { success: false, message: "Order not found", error: "Order not found" };
        }
        if (!order.cjOrderId) {
            return { success: false, message: "Order has no CJ order ID", error: "Order has no CJ order ID" };
        }

        const result = await ctx.runAction(internal.cjDropshipping.getTrackingInfo, {
            orderId: args.orderId,
            cjOrderId: order.cjOrderId,
        });

        return {
            ...result,
            message: result.success
                ? result.trackingNumber
                    ? `Tracking synced: ${result.trackingNumber}`
                    : "Tracking sync completed"
                : result.error || "Tracking sync failed",
        };
    },
});

export const retryOrderFulfillment = action({
    args: {
        orderId: v.id("orders"),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        message: string;
        cjOrderId?: string;
        error?: string;
    }> => {
        await requireAdminIdentity(ctx);

        const order = await ctx.runQuery(internal.cjHelpers.getOrderByIdInternal, {
            orderId: args.orderId,
        });
        if (!order) {
            return { success: false, message: "Order not found", error: "Order not found" };
        }
        if (order.cjPaymentStatus === "paid" || order.cjFulfillmentStep === "paid") {
            return {
                success: true,
                message: "CJ fulfillment is already paid or processing",
                cjOrderId: order.cjOrderId,
            };
        }

        const retryPayload = buildCjRetryOrderPayload(order);
        if ("error" in retryPayload) {
            return { success: false, message: retryPayload.error, error: retryPayload.error };
        }

        const result = await ctx.runAction(internal.cjDropshipping.createCjOrder, {
            orderId: args.orderId,
            ...retryPayload.payload,
        });

        return {
            ...result,
            message: result.success
                ? result.cjOrderId
                    ? `CJ fulfillment retry submitted: ${result.cjOrderId}`
                    : "CJ fulfillment retry submitted"
                : result.error || "CJ fulfillment retry failed",
        };
    },
});

export const refreshInventory = action({
    args: {
        productId: v.optional(v.id("products")),
    },
    handler: async (ctx, args): Promise<{
        checked: number;
        updated: number;
        errors: number;
        products: Array<{
            productId: string;
            name: string;
            status: string;
            totalInventoryNum?: number;
            error?: string;
        }>;
    }> => {
        await requireAdminIdentity(ctx);
        return await ctx.runAction(internal.cjDropshipping.refreshProductInventory, args);
    },
});

/**
 * Test CJ API connection
 * Returns success status and any error message
 */
export const testConnection = action({
    args: {},
    handler: async (ctx): Promise<{ success: boolean; message: string }> => {
        try {
            const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
            if (token) {
                return { success: true, message: "Successfully connected to CJ Dropshipping API!" };
            }
            return { success: false, message: "Failed to authenticate - check your CJ credentials" };
        } catch (error: any) {
            return { success: false, message: error.message || "Connection failed" };
        }
    },
});

/**
 * Configure CJ webhooks to receive real-time updates
 * This calls CJ's /webhook/set API to register our endpoint
 */
export const configureWebhooks = action({
    args: {},
    handler: async (ctx): Promise<{ success: boolean; message: string }> => {
        try {
            // Get access token first
            const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
            if (!token) {
                return { success: false, message: "Failed to authenticate with CJ API" };
            }

            // Our webhook URL — configurable to avoid breakage on deployment URL changes
            const webhookUrl = process.env.CJ_WEBHOOK_URL;
            if (!webhookUrl) {
                return { success: false, message: "CJ_WEBHOOK_URL is not configured. Set it in Convex dashboard → Settings → Environment Variables." };
            }

            // Configure webhooks for order and logistics updates
            const response = await fetch(`${CJ_API_BASE}/webhook/set`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "CJ-Access-Token": token,
                },
                body: JSON.stringify({
                    product: {
                        type: "ENABLE",
                        callbackUrls: [webhookUrl],
                    },
                    stock: {
                        type: "ENABLE",
                        callbackUrls: [webhookUrl],
                    },
                    order: {
                        type: "ENABLE",
                        callbackUrls: [webhookUrl],
                    },
                    logistics: {
                        type: "ENABLE",
                        callbackUrls: [webhookUrl],
                    },
                }),
            });

            const data = await response.json();

            if (data.result === true) {
                return {
                    success: true,
                    message: "Webhooks configured! You'll now receive real-time order and tracking updates."
                };
            } else {
                return {
                    success: false,
                    message: data.message || "Failed to configure webhooks - your store may need to be verified first"
                };
            }
        } catch (error: any) {
            return { success: false, message: error.message || "Failed to configure webhooks" };
        }
    },
});

/**
 * Check CJ sourcing status for pending products
 * Can be called manually from admin dashboard
 */
export const checkSourcingStatus = action({
    args: {},
    handler: async (ctx): Promise<{ checked: number; approved: number; rejected: number }> => {
        const result = await ctx.runAction(internal.cjDropshipping.checkSourcingStatus, {});
        return result;
    },
});

/**
 * Deep diagnostic for pending products — verifies each product against
 * CJ's sourcing ticket AND catalog. Auto-approves products confirmed in
 * CJ's catalog even when the sourcing ticket status is stale.
 * Returns detailed per-product diagnostics for the admin UI.
 */
export const diagnosePending = action({
    args: {},
    handler: async (ctx): Promise<{
        results: Array<{
            productId: string;
            productName: string;
            cjSourcingId: string | null;
            sourcingTicketStatus: string;
            sourcingTicketStatusCode: string | number | null;
            cjProductIdFromTicket: string | null;
            cjProductIdFromCatalog: string | null;
            productFoundInCatalog: boolean;
            variantCount: number;
            autoApproved: boolean;
            diagnosis: string;
        }>;
        summary: string;
    }> => {
        const result = await ctx.runAction(internal.cjDropshipping.diagnosePendingProducts, {});
        return result;
    },
});

/**
 * Submit a product for CJ sourcing
 * Called when importing products from AliExpress/other sources
 * Now includes optional image, description, and price for faster CJ review
 */
export const submitProductForSourcing = action({
    args: {
        productId: v.id("products"),
        productUrl: v.string(),
        productName: v.string(),
        productImage: v.optional(v.string()),
        productDescription: v.optional(v.string()),
        targetPrice: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
        const result = await ctx.runAction(internal.cjDropshipping.submitForSourcing, {
            productId: args.productId,
            productUrl: args.productUrl,
            productName: args.productName,
            productImage: args.productImage,
            productDescription: args.productDescription,
            targetPrice: args.targetPrice,
        });
        return result;
    },
});

/**
 * Cancel a pending sourcing request on CJ and delete the product
 * Called from admin CJ Settings page to remove products from import queue
 */
export const cancelAndDeleteProduct = action({
    args: {
        productId: v.id("products"),
        cjSourcingId: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; cjCancelled: boolean; error?: string }> => {
        const result = await ctx.runAction(internal.cjDropshipping.cancelSourcingAndDelete, {
            productId: args.productId,
            cjSourcingId: args.cjSourcingId,
        });
        return result;
    },
});

/**
 * Resubmit a stuck or failed product to CJ sourcing
 * Clears previous error and resubmits with fresh request
 */
export const resubmitProduct = action({
    args: {
        productId: v.id("products"),
    },
    handler: async (ctx, args): Promise<{ success: boolean; message: string; cjSourcingId?: string }> => {
        try {
            // Get product details
            const product = await ctx.runQuery(internal.cjHelpers.getProductById, {
                productId: args.productId
            });

            if (!product) {
                return { success: false, message: "Product not found" };
            }

            if (!product.sourceUrl) {
                return { success: false, message: "Product has no source URL - cannot submit to CJ" };
            }

            if (!product.images || product.images.length === 0) {
                return { success: false, message: "Product has no images - CJ requires at least one image" };
            }

            // Clear previous sourcing status
            await ctx.runMutation(internal.cjHelpers.clearSourcingStatus, {
                productId: args.productId,
            });

            // Resubmit to CJ
            const result = await ctx.runAction(internal.cjDropshipping.submitForSourcing, {
                productId: args.productId,
                productUrl: product.sourceUrl,
                productName: product.name,
                productImage: product.images[0],
                productDescription: product.description?.slice(0, 200),
                targetPrice: product.price,
            });

            if (result.success && result.sourcingId) {
                return {
                    success: true,
                    message: `Resubmitted successfully! CJ Sourcing ID: ${result.sourcingId}`,
                    cjSourcingId: result.sourcingId
                };
            } else {
                return {
                    success: false,
                    message: result.error || "Failed to resubmit to CJ"
                };
            }
        } catch (error: any) {
            return { success: false, message: error.message || "Resubmit failed" };
        }
    },
});

/**
 * Get current CJ token status for admin display
 * Shows when tokens expire and if connection is healthy
 */
export const getTokenStatus = action({
    args: {},
    handler: async (ctx): Promise<{
        connected: boolean;
        accessTokenValid: boolean;
        accessTokenExpiresAt?: string;
        refreshTokenValid: boolean;
        refreshTokenExpiresAt?: string;
        automation: CjAutomationConfig;
        message: string;
    }> => {
        const automation = getCjAutomationConfig(process.env);

        try {
            const tokens = await ctx.runQuery(internal.cjHelpers.getCjTokens, {});

            if (!tokens) {
                return {
                    connected: false,
                    accessTokenValid: false,
                    refreshTokenValid: false,
                    automation,
                    message: "No tokens stored - run Test Connection to authenticate"
                };
            }

            const now = new Date();
            const accessExpiry = new Date(tokens.accessTokenExpiryDate);
            const refreshExpiry = new Date(tokens.refreshTokenExpiryDate);

            const accessValid = accessExpiry > now;
            const refreshValid = refreshExpiry > now;

            return {
                connected: accessValid || refreshValid,
                accessTokenValid: accessValid,
                accessTokenExpiresAt: tokens.accessTokenExpiryDate,
                refreshTokenValid: refreshValid,
                refreshTokenExpiresAt: tokens.refreshTokenExpiryDate,
                automation,
                message: accessValid
                    ? `Connected - token expires ${accessExpiry.toLocaleDateString()}`
                    : refreshValid
                        ? "Access token expired - will auto-refresh on next API call"
                        : "All tokens expired - run Test Connection to reauthenticate"
            };
        } catch (error: any) {
            return {
                connected: false,
                accessTokenValid: false,
                refreshTokenValid: false,
                automation,
                message: error.message || "Failed to check token status"
            };
        }
    },
});

/**
 * Fetch product details and variants from CJ API by SPU code
 * Used when the CJ dashboard is inaccessible but the product is already sourced
 */
export const fetchProductBySpu = action({
    args: {
        spu: v.string(),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        product?: any;
        variants?: any[];
        error?: string;
    }> => {
        try {
            const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
            if (!token) {
                return { success: false, error: "Failed to authenticate with CJ API" };
            }

            const headers = {
                "Content-Type": "application/json",
                "CJ-Access-Token": token,
            };

            const results: any = {};

            // 1. Try product detail by SPU (GET request with query param)
            try {
                const detailRes = await fetch(
                    `${CJ_API_BASE}/product/query?productSpu=${encodeURIComponent(args.spu)}`,
                    { method: "GET", headers }
                );
                const detailData = await detailRes.json();
                results.productQuery = detailData;
                console.log("CJ product/query response:", JSON.stringify(detailData, null, 2));
            } catch (e: any) {
                results.productQueryError = e.message;
            }

            // 2. Try getting variants specifically (GET request)
            try {
                const variantRes = await fetch(
                    `${CJ_API_BASE}/product/variant/query?productSpu=${encodeURIComponent(args.spu)}`,
                    { method: "GET", headers }
                );
                const variantData = await variantRes.json();
                results.variantQuery = variantData;
                console.log("CJ variant/query response:", JSON.stringify(variantData, null, 2));
            } catch (e: any) {
                results.variantQueryError = e.message;
            }

            // 3. Try product list search with GET as well
            try {
                const listRes = await fetch(
                    `${CJ_API_BASE}/product/list?productSpu=${encodeURIComponent(args.spu)}&pageNum=1&pageSize=10`,
                    { method: "GET", headers }
                );
                const listData = await listRes.json();
                results.productList = listData;
                console.log("CJ product/list response:", JSON.stringify(listData, null, 2));
            } catch (e: any) {
                results.productListError = e.message;
            }

            // Extract the best result
            const productData = results.productQuery?.data || results.productList?.data?.list?.[0];
            const variants = productData?.variants || results.variantQuery?.data || [];

            return {
                success: true,
                product: productData || results,
                variants: Array.isArray(variants) ? variants : [],
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

/**
 * Fetch full product details from CJ using sourcing ID and/or product ID
 * Queries multiple endpoints to find variants
 */
export const fetchProductDetails = action({
    args: {
        sourcingId: v.optional(v.string()),
        pid: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        results: any;
    }> => {
        try {
            const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
            if (!token) {
                return { success: false, results: { error: "Failed to authenticate" } };
            }

            const headers = {
                "Content-Type": "application/json",
                "CJ-Access-Token": token,
            };

            const results: any = {};

            // 1. Check sourcing status to get cjProductId
            if (args.sourcingId) {
                try {
                    const sourcingRes = await fetch(`${CJ_API_BASE}/product/sourcing/query`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ sourceIds: [args.sourcingId] }),
                    });
                    const sourcingData = await sourcingRes.json();
                    results.sourcingQuery = sourcingData;
                    console.log("CJ sourcing/query:", JSON.stringify(sourcingData, null, 2));

                    // Extract pid from sourcing result if found
                    const sourcing = Array.isArray(sourcingData.data)
                        ? sourcingData.data[0]
                        : sourcingData.data;
                    if (sourcing?.cjProductId) {
                        args.pid = sourcing.cjProductId;
                    }
                } catch (e: any) {
                    results.sourcingQueryError = e.message;
                }
            }

            // 2. Get product detail by pid (GET with pid in URL path)
            if (args.pid) {
                try {
                    const detailRes = await fetch(
                        `${CJ_API_BASE}/product/query?pid=${encodeURIComponent(args.pid)}`,
                        { method: "GET", headers }
                    );
                    const detailData = await detailRes.json();
                    results.productDetail = detailData;
                    console.log("CJ product detail:", JSON.stringify(detailData, null, 2));
                } catch (e: any) {
                    results.productDetailError = e.message;
                }

                // 3. Get variants by pid
                try {
                    const variantRes = await fetch(
                        `${CJ_API_BASE}/product/variant/query/byPid?pid=${encodeURIComponent(args.pid)}`,
                        { method: "GET", headers }
                    );
                    const variantData = await variantRes.json();
                    results.variantsByPid = variantData;
                    console.log("CJ variants by pid:", JSON.stringify(variantData, null, 2));
                } catch (e: any) {
                    results.variantsByPidError = e.message;
                }
            }

            // 4. Also try the "my products" / sourcing list to find it
            try {
                const myProductsRes = await fetch(
                    `${CJ_API_BASE}/product/sourcing/list?pageNum=1&pageSize=20`,
                    { method: "GET", headers }
                );
                const myProductsData = await myProductsRes.json();
                results.sourcingList = myProductsData;
                console.log("CJ sourcing/list:", JSON.stringify(myProductsData, null, 2));
            } catch (e: any) {
                results.sourcingListError = e.message;
            }

            return { success: true, results };
        } catch (error: any) {
            return { success: false, results: { error: error.message } };
        }
    },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new order
export const createOrder = mutation({
    args: {
        stripeSessionId: v.string(),
        stripePaymentIntentId: v.optional(v.string()),
        customerEmail: v.string(),
        customerName: v.optional(v.string()),
        customerPhone: v.optional(v.string()),
        items: v.array(v.object({
            productId: v.string(),
            variantId: v.optional(v.string()),
            variantName: v.optional(v.string()),
            name: v.string(),
            price: v.number(),
            quantity: v.number(),
            image: v.optional(v.string()),
            // CJ Dropshipping product mapping
            cjVariantId: v.optional(v.string()),
            cjSku: v.optional(v.string()),
            cjProductCost: v.optional(v.number()),
            cjEstimatedLandedCost: v.optional(v.number()),
        })),
        subtotal: v.number(),
        shipping: v.optional(v.number()),
        tax: v.optional(v.number()),
        total: v.number(),
        currency: v.string(),
        shippingAddress: v.optional(v.object({
            line1: v.string(),
            line2: v.optional(v.string()),
            city: v.string(),
            state: v.optional(v.string()),
            postalCode: v.string(),
            country: v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();

        // Check if any items have CJ product mapping
        const hasCjProducts = args.items.some(item => item.cjVariantId || item.cjSku);

        return await ctx.db.insert("orders", {
            ...args,
            status: "paid",
            // Set CJ status to pending if there are CJ products to fulfill
            cjStatus: hasCjProducts ? "pending" : undefined,
            cjFulfillmentStep: hasCjProducts ? "not_started" : undefined,
            cjPaymentStatus: hasCjProducts ? "not_started" : undefined,
            cjFulfillmentRetryCount: hasCjProducts ? 0 : undefined,
            createdAt: now,
            updatedAt: now,
        });
    },
});

// Get order by Stripe session ID
export const getBySessionId = query({
    args: { sessionId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("orders")
            .withIndex("by_session", (q) => q.eq("stripeSessionId", args.sessionId))
            .first();
    },
});

// Get orders by customer email
export const getByEmail = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("orders")
            .withIndex("by_email", (q) => q.eq("customerEmail", args.email))
            .order("desc")
            .collect();
    },
});

// Get all orders (for admin)
export const getAll = query({
    handler: async (ctx) => {
        return await ctx.db.query("orders").order("desc").collect();
    },
});

// Update order status
export const updateStatus = mutation({
    args: {
        orderId: v.id("orders"),
        status: v.union(
            v.literal("pending"),
            v.literal("paid"),
            v.literal("processing"),
            v.literal("shipped"),
            v.literal("delivered"),
            v.literal("cancelled")
        ),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.orderId, {
            status: args.status,
            updatedAt: new Date().toISOString(),
        });
    },
});

// Get order by ID
export const getById = query({
    args: { orderId: v.id("orders") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.orderId);
    },
});

// Reset CJ status to retry sending to CJ
export const resetCjStatus = mutation({
    args: { orderId: v.id("orders") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.orderId, {
            cjStatus: "pending",
            cjError: undefined,
            cjFulfillmentStep: "not_started",
            cjPaymentStatus: "not_started",
            cjAutoPaymentError: undefined,
            cjFulfillmentRetryCount: 0,
            cjFulfillmentIdempotencyKey: undefined,
            cjFulfillmentLastStepAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    },
});

// Get orders with failed CJ status
export const getFailedCjOrders = query({
    handler: async (ctx) => {
        return await ctx.db
            .query("orders")
            .filter((q) => q.eq(q.field("cjStatus"), "failed"))
            .order("desc")
            .collect();
    },
});

// Get orders pending CJ submission
export const getPendingCjOrders = query({
    handler: async (ctx) => {
        return await ctx.db
            .query("orders")
            .filter((q) => q.eq(q.field("cjStatus"), "pending"))
            .order("desc")
            .collect();
    },
});

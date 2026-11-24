import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const trendsiStatus = v.union(
  ...[
    'requested',
    'confirmed',
    'payment_pending',
    'paid',
    'ordered',
    'partially_shipped',
    'shipped',
    'delivered',
    'exception',
    'cancelled',
    'refunded',
  ].map((s) => v.literal(s))
);
export const trendsiAddress = v.object({
  line1: v.string(),
  line2: v.string(),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  country: v.literal('US'),
});
export const trendsiTables = {
  trendsiStockHolds: defineTable({
    orderId: v.id('trendsiOrders'),
    productId: v.id('products'),
    variantId: v.string(),
    quantity: v.number(),
    active: v.boolean(),
    expiresAt: v.optional(v.number()),
  })
    .index('by_order', ['orderId'])
    .index('by_variant', ['productId', 'variantId', 'active']),
  trendsiOrders: defineTable({
    token: v.string(),
    requestHash: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: trendsiAddress,
    items: v.array(
      v.object({
        productId: v.id('products'),
        variantId: v.string(),
        name: v.string(),
        variantName: v.string(),
        supplierProductId: v.string(),
        supplierSku: v.string(),
        sourceUrl: v.string(),
        quantity: v.number(),
        unitMinor: v.number(),
      })
    ),
    status: trendsiStatus,
    revision: v.number(),
    notes: v.string(),
    stockConfirmedAt: v.optional(v.number()),
    stockEvidence: v.optional(v.string()),
    shippingMinor: v.optional(v.number()),
    deliveryEstimate: v.optional(v.string()),
    sessionExpiresAt: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    paymentUrl: v.optional(v.string()),
    paymentAttemptRevision: v.optional(v.number()),
    paymentIntentId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidTotalMinor: v.optional(v.number()),
    taxMinor: v.optional(v.number()),
    paymentHold: v.optional(v.string()),
    supplierReference: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    shipments: v.array(
      v.object({
        lineIndex: v.number(),
        quantity: v.number(),
        carrier: v.string(),
        tracking: v.string(),
        at: v.number(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_email', ['email'])
    .index('by_status', ['status'])
    .index('by_payment', ['paymentIntentId']),
  trendsiOrderEvents: defineTable({
    orderId: v.id('trendsiOrders'),
    actor: v.string(),
    action: v.string(),
    note: v.string(),
    at: v.number(),
  }).index('by_order', ['orderId']),
};

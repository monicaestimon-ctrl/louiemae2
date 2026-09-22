import { defineTable } from 'convex/server';
import { v } from 'convex/values';
export const provider = v.union(v.literal('cj'), v.literal('ashcroft'), v.literal('owner_managed'));
export const channel = v.union(v.literal('retail'), v.literal('house'));
export const variant = v.object({
  id: v.string(),
  name: v.string(),
  sku: v.string(),
  image: v.optional(v.string()),
  cost: v.number(),
  minimum: v.number(),
  increment: v.number(),
  retail: v.number(),
  commercial: v.number(),
  cjVariantId: v.optional(v.string()),
  cjSku: v.optional(v.string()),
});
export const draft = v.object({
  name: v.string(),
  description: v.string(),
  category: v.string(),
  images: v.array(v.string()),
  referenceImages: v.array(v.string()),
  sourceUrl: v.string(),
  supplierName: v.string(),
  supplierContact: v.string(),
  facts: v.string(),
  packaging: v.string(),
  currency: v.string(),
  usdRate: v.number(),
  variants: v.array(variant),
  conflicts: v.array(v.string()),
  factsApproved: v.boolean(),
  imagesApproved: v.boolean(),
  referencePermission: v.boolean(),
});
export const snapshot = v.object({
  name: v.string(),
  description: v.string(),
  category: v.string(),
  images: v.array(v.string()),
  facts: v.string(),
  variants: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      image: v.optional(v.string()),
      minimum: v.number(),
      increment: v.number(),
      price: v.number(),
    })
  ),
});
export const address = v.object({
  line1: v.string(),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  country: v.string(),
});
export const projectLine = v.object({
  productId: v.id('commerceProducts'),
  variantId: v.string(),
  name: v.string(),
  variantName: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  provider,
  sku: v.string(),
  cjProductId: v.optional(v.id('products')),
  cjVariantId: v.optional(v.string()),
  cjSku: v.optional(v.string()),
});
export const commerceTables = {
  commercePaymentLinks: defineTable({
    paymentIntentId: v.string(),
    projectId: v.id('commerceProjects'),
  }).index('by_payment', ['paymentIntentId']),
  commerceProjects: defineTable({
    token: v.string(),
    channel,
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    business: v.string(),
    address,
    notes: v.string(),
    requested: v.array(projectLine),
    lines: v.array(projectLine),
    delivery: v.number(),
    tax: v.number(),
    revision: v.number(),
    status: v.string(),
    acceptance: v.optional(v.string()),
    readiness: v.optional(v.string()),
    maxCjCost: v.optional(v.number()),
    cjLogistics: v.optional(v.string()),
    cjApprovedUntil: v.optional(v.number()),
    coordinatedRelease: v.optional(v.boolean()),
    cjShippingAllowance: v.optional(v.number()),
    invoiceAttemptAt: v.optional(v.number()),
    stripeInvoiceId: v.optional(v.string()),
    invoiceUrl: v.optional(v.string()),
    invoiceError: v.optional(v.string()),
    customerEmailStatus: v.optional(v.string()),
    ownerEmailStatus: v.optional(v.string()),
    paymentIntentIds: v.optional(v.array(v.string())),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_email', ['email'])
    .index('by_invoice', ['stripeInvoiceId']),
  commerceFulfillments: defineTable({
    projectId: v.id('commerceProjects'),
    provider,
    status: v.string(),
    orderId: v.optional(v.id('orders')),
    supplierReference: v.optional(v.string()),
    tracking: v.optional(v.string()),
    note: v.string(),
    updatedAt: v.number(),
  }).index('by_project', ['projectId']),
  commerceGenerations: defineTable({
    productId: v.id('commerceProducts'),
    revision: v.number(),
    kind: v.union(v.literal('copy'), v.literal('image')),
    instruction: v.string(),
    reference: v.optional(v.string()),
    model: v.string(),
    status: v.string(),
    actor: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    result: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    tokens: v.optional(v.number()),
    requestKey: v.string(),
  })
    .index('by_product', ['productId'])
    .index('by_request', ['requestKey']),
  commerceProducts: defineTable({
    provider,
    sourceKey: v.string(),
    cjProductId: v.optional(v.id('products')),
    draft,
    revision: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source', ['sourceKey'])
    .index('by_cj', ['cjProductId']),
  commerceListings: defineTable({
    productId: v.id('commerceProducts'),
    channel,
    published: v.boolean(),
    revision: v.number(),
    snapshot,
    fulfillment: v.optional(v.array(variant)),
    updatedAt: v.number(),
  })
    .index('by_product_channel', ['productId', 'channel'])
    .index('by_channel_published', ['channel', 'published']),
  commerceAudit: defineTable({
    entityId: v.string(),
    actor: v.string(),
    action: v.string(),
    revision: v.number(),
    createdAt: v.number(),
  }).index('by_entity', ['entityId']),
};

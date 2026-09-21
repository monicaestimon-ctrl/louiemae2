import { defineTable } from 'convex/server';
import { v } from 'convex/values';
export const furnitureFields = {
  name: v.string(),
  category: v.string(),
  description: v.string(),
  images: v.array(v.string()),
  sourceUrl: v.string(),
  supplierKey: v.string(),
  supplierName: v.string(),
  supplierContact: v.string(),
  currency: v.string(),
  usdRate: v.number(),
  variants: v.array(
    v.object({ id: v.string(), name: v.string(), cost: v.number(), minimum: v.number(), image: v.optional(v.string()) })
  ),
  dimensions: v.string(),
  materials: v.string(),
  packaging: v.string(),
  supplierNotes: v.string(),
  imagePermission: v.boolean(),
  published: v.boolean(),
};
export const furnitureTables = {
  furnitureProducts: defineTable({
    ...furnitureFields,
    updatedAt: v.number(),
    importedAt: v.optional(v.number()),
    supplierId: v.optional(v.id('furnitureSuppliers')),
  })
    .index('by_published', ['published'])
    .index('by_source', ['sourceUrl']),
  furnitureSuppliers: defineTable({
    key: v.string(),
    name: v.string(),
    contact: v.string(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
  furnitureQuotes: defineTable({
    token: v.string(),
    name: v.string(),
    email: v.string(),
    business: v.string(),
    address: v.string(),
    phone: v.string(),
    notes: v.string(),
    service: v.string(),
    items: v.array(
      v.object({
        productId: v.id('furnitureProducts'),
        variantId: v.string(),
        name: v.string(),
        variant: v.string(),
        quantity: v.number(),
        lower: v.number(),
        upper: v.number(),
      })
    ),
    lower: v.number(),
    upper: v.number(),
    status: v.string(),
    createdAt: v.number(),
    customerEmailStatus: v.string(),
    ownerEmailStatus: v.string(),
  })
    .index('by_token', ['token'])
    .index('by_email', ['email']),
};

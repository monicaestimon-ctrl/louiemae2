import { v } from 'convex/values';
export const cjPricingReviewValidator = v.object({
  cjProductId: v.string(),
  checkedAt: v.number(),
  destination: v.string(),
  quantity: v.number(),
  quotes: v.array(
    v.object({
      vid: v.string(),
      sku: v.string(),
      name: v.string(),
      itemCost: v.optional(v.number()),
      shippingCost: v.optional(v.number()),
      taxesFee: v.optional(v.number()),
      clearanceFee: v.optional(v.number()),
      logisticsName: v.optional(v.string()),
      origin: v.optional(v.string()),
      error: v.optional(v.string()),
    })
  ),
});

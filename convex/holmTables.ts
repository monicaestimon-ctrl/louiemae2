import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// House of Louie Mae: the trade site at /trade. These tables sit beside the shared
// commerce tables; quote requests flow into commerceProjects so review, invoicing and
// fulfillment stay in one pipeline.
export const tradeStatus = v.union(
  v.literal('none'),
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('needs_info')
);
export const holmBusinessType = v.union(
  v.literal('hosp'),
  v.literal('design'),
  v.literal('re'),
  v.literal('build'),
  v.literal('pm'),
  v.literal('retail')
);
export const clientShow = v.union(v.literal('cost'), v.literal('markup'), v.literal('retail'));

export const holmTables = {
  holmProfiles: defineTable({
    userId: v.id('users'),
    displayName: v.string(),
    businessName: v.optional(v.string()),
    businessType: v.optional(holmBusinessType),
    tradeStatus,
    taxExempt: v.optional(v.boolean()),
    defaultSpace: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_trade_status', ['tradeStatus', 'updatedAt']),

  holmTradeApplications: defineTable({
    userId: v.id('users'),
    email: v.string(),
    businessType: holmBusinessType,
    businessName: v.string(),
    state: v.string(),
    einLast4: v.string(), // the full EIN is never stored
    website: v.string(),
    credential: v.string(),
    company: v.optional(v.string()),
    workEmail: v.optional(v.string()),
    taxRequested: v.boolean(),
    certificateId: v.optional(v.id('_storage')),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('needs_info')
    ),
    reviewerEmail: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
    submittedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId', 'submittedAt'])
    .index('by_status', ['status', 'submittedAt']),

  holmQuoteRequests: defineTable({
    userId: v.optional(v.id('users')),
    commerceProjectId: v.id('commerceProjects'),
    projectName: v.string(),
    priceMode: v.union(v.literal('retail'), v.literal('trade')),
    retailSubtotal: v.number(),
    subtotal: v.number(),
    projectDiscount: v.number(),
    tierBps: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_project', ['commerceProjectId']),

  holmClientQuotes: defineTable({
    slug: v.string(),
    number: v.string(),
    ownerId: v.id('users'),
    status: v.union(
      v.literal('sent'),
      v.literal('viewed'),
      v.literal('approved'),
      v.literal('changes_requested')
    ),
    show: clientShow,
    markupBps: v.number(),
    studioName: v.optional(v.string()),
    replyEmail: v.string(),
    clientName: v.string(),
    title: v.string(),
    note: v.string(),
    space: v.string(),
    lines: v.array(
      v.object({
        productId: v.id('commerceProducts'),
        variantId: v.string(),
        name: v.string(),
        image: v.optional(v.string()),
        zone: v.string(),
        quantity: v.number(),
        unitSellCents: v.number(),
      })
    ),
    deliveryCents: v.optional(v.number()),
    depositBps: v.number(),
    leadTime: v.string(),
    validUntil: v.number(),
    viewedAt: v.optional(v.number()),
    approval: v.optional(v.object({ name: v.string(), at: v.number() })),
    changeRequest: v.optional(v.object({ message: v.string(), at: v.number() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_owner', ['ownerId', 'updatedAt']),
};

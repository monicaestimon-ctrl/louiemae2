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
export const partnerTier = v.union(v.literal('base'), v.literal('active'), v.literal('top'), v.literal('elite'));
export const productType = v.union(v.literal('furniture'), v.literal('decor'), v.literal('clothing'));
export const commissionLine = v.object({
  key: v.string(),
  type: productType,
  baseCents: v.number(),
  rateBps: v.number(),
  amountCents: v.number(),
  capped: v.boolean(),
  costKnown: v.boolean(),
});
export const sourcingStatus = v.union(
  v.literal('received'),
  v.literal('sourcing'),
  v.literal('options_ready'),
  v.literal('ordered'),
  v.literal('closed')
);

export const holmTables = {
  holmProfiles: defineTable({
    userId: v.id('users'),
    displayName: v.string(),
    businessName: v.optional(v.string()),
    businessType: v.optional(holmBusinessType),
    tradeStatus,
    taxExempt: v.optional(v.boolean()),
    defaultSpace: v.optional(v.string()),
    // The browser a partner-link visit came from, kept on the account so an order placed on
    // another device within the window still counts.
    refVisitorId: v.optional(v.string()),
    refVisitCode: v.optional(v.string()), // the partner code that visit came through
    // Partner program
    partnerStatus: v.optional(v.literal('active')),
    partnerTier: v.optional(partnerTier),
    // A tier the team set by hand. While it's in force (no end date, or before it), the nightly
    // tier update leaves this partner alone.
    tierOverride: v.optional(v.object({ reason: v.string(), until: v.optional(v.number()), by: v.string(), at: v.number() })),
    tierDownCheckedAt: v.optional(v.number()), // the last quarterly check for moving down
    sales12Cents: v.optional(v.number()), // 12-month attributed sales, as of the last nightly update
    creditAutoApply: v.optional(v.boolean()), // apply store credit to the next order automatically
    // Stripe Connect Express account for automatic payouts
    stripeAccountId: v.optional(v.string()),
    payoutsReady: v.optional(v.boolean()),
    payoutsDue: v.optional(v.array(v.string())), // what Stripe still needs, if anything
    refCode: v.optional(v.string()),
    w9Status: v.optional(v.union(v.literal('pending'), v.literal('approved'))),
    w9FileId: v.optional(v.id('_storage')),
    referredBy: v.optional(v.id('users')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_trade_status', ['tradeStatus', 'updatedAt'])
    .index('by_refCode', ['refCode'])
    .index('by_partner_status', ['partnerStatus', 'updatedAt'])
    .index('by_stripe_account', ['stripeAccountId']),

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
    deliveryCents: v.optional(v.number()),
    // Partner attribution (retail-priced requests only earn commission)
    partnerId: v.optional(v.id('users')),
    refCode: v.optional(v.string()),
    channel: v.optional(v.string()),
    partnerState: v.optional(v.union(v.literal('awaiting_payment'), v.literal('credited'), v.literal('void'))),
    partnerCheckedAt: v.optional(v.number()), // last reconcile pass, so unpaid rows rotate
    board: v.optional(v.string()), // the shared board whose link the buyer came through
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_project', ['commerceProjectId'])
    .index('by_partner_state', ['partnerState', 'partnerCheckedAt'])
    .index('by_partner', ['partnerId', 'createdAt']),

  holmClicks: defineTable({
    partnerId: v.id('users'),
    refCode: v.string(),
    channel: v.string(),
    target: v.string(),
    visitorId: v.string(),
    board: v.optional(v.string()), // shared-board slug when the visit came through a board link
    at: v.number(),
  })
    .index('by_partner', ['partnerId', 'at'])
    .index('by_visitor_partner', ['visitorId', 'partnerId', 'at'])
    .index('by_board', ['board', 'at']),

  holmCommissions: defineTable({
    partnerId: v.id('users'),
    // where it came from: a /trade quote, a louiemae.com checkout, or a later adjustment
    source: v.optional(v.union(v.literal('house_quote'), v.literal('storefront_order'), v.literal('adjustment'))),
    quoteRequestId: v.optional(v.id('holmQuoteRequests')),
    commerceProjectId: v.optional(v.id('commerceProjects')),
    retailCheckoutId: v.optional(v.id('retailCheckouts')),
    stripeSessionId: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
    channel: v.optional(v.string()),
    board: v.optional(v.string()),
    originalCents: v.optional(v.number()), // before any refund
    reversedCents: v.optional(v.number()), // taken back for refunds and disputes so far
    refundedCents: v.optional(v.number()), // Stripe's running refund total on the payment
    chargeCents: v.optional(v.number()), // the payment's charged amount
    disputed: v.optional(v.boolean()), // an open or lost dispute
    adjustsId: v.optional(v.id('holmCommissions')), // for an adjustment: the commission it corrects
    note: v.optional(v.string()),
    baseCents: v.number(),
    rateBps: v.number(), // the rate earned across the order (amount ÷ base); lines hold each line's rate
    amountCents: v.number(),
    tier: v.optional(partnerTier), // the tier in effect when the order was paid
    lines: v.optional(v.array(commissionLine)), // per line: product type, rate, amount, margin guard
    status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('paid'), v.literal('void')),
    clearsAt: v.number(),
    payoutId: v.optional(v.id('holmPayouts')),
    createdAt: v.number(),
  })
    .index('by_partner', ['partnerId', 'createdAt'])
    .index('by_status_clears', ['status', 'clearsAt'])
    .index('by_partner_status', ['partnerId', 'status'])
    .index('by_session', ['stripeSessionId'])
    .index('by_payment', ['paymentIntentId']),

  // Refund and dispute state of a storefront payment, kept even when the event arrives before
  // the order's commission exists (Stripe doesn't promise event order).
  holmPaymentStates: defineTable({
    paymentIntentId: v.string(),
    refundedCents: v.number(),
    chargeCents: v.number(),
    disputed: v.boolean(),
    updatedAt: v.number(),
  }).index('by_payment', ['paymentIntentId']),

  // Every tier a partner has held and when it started, so an order is paid at the tier in
  // effect when it was paid, whatever changes later.
  holmTierChanges: defineTable({
    partnerId: v.id('users'),
    tier: partnerTier,
    from: v.optional(partnerTier),
    at: v.number(),
    reason: v.string(),
    by: v.optional(v.string()),
  }).index('by_partner', ['partnerId', 'at']),

  holmReferrals: defineTable({
    referrerId: v.id('users'),
    referredUserId: v.id('users'),
    status: v.union(v.literal('signed_up'), v.literal('verified'), v.literal('credited')),
    creditCents: v.number(),
    checkedAt: v.optional(v.number()), // last reconcile pass, so waiting referrals rotate
    createdAt: v.number(),
  })
    .index('by_referrer', ['referrerId', 'createdAt'])
    .index('by_referred', ['referredUserId'])
    .index('by_status_checked', ['status', 'checkedAt']),

  // Store credit ledger (see holmCredit.ts). The balance is the sum of amountCents.
  holmCredits: defineTable({
    userId: v.id('users'),
    amountCents: v.number(), // positive = credit, negative = held or used
    kind: v.optional(v.union(v.literal('earned'), v.literal('reserved'), v.literal('used'), v.literal('released'), v.literal('restored'))),
    ref: v.optional(v.string()), // the order a hold belongs to: checkout:<id> or project:<id>
    heldCents: v.optional(v.number()), // the amount first held
    paymentIntentId: v.optional(v.string()), // the payment that used it (storefront)
    restoredCents: v.optional(v.number()), // returned so far after refunds
    reason: v.string(),
    at: v.number(),
  })
    .index('by_user', ['userId', 'at'])
    .index('by_ref', ['ref'])
    .index('by_kind', ['kind', 'at'])
    .index('by_payment', ['paymentIntentId']),

  holmPayouts: defineTable({
    partnerId: v.id('users'),
    amountCents: v.number(),
    reference: v.string(), // the payment reference, or the Stripe transfer id
    paidBy: v.string(),
    paidAt: v.number(),
    // Automatic payouts through Stripe Connect (manual payouts leave these empty)
    method: v.optional(v.union(v.literal('manual'), v.literal('stripe'))),
    status: v.optional(v.union(v.literal('processing'), v.literal('paid'), v.literal('failed'))),
    period: v.optional(v.string()), // YYYY-MM of the monthly run
    accountId: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index('by_partner', ['partnerId', 'paidAt'])
    .index('by_partner_period', ['partnerId', 'period'])
    .index('by_status', ['status']),

  holmSourcing: defineTable({
    number: v.string(),
    userId: v.id('users'),
    email: v.string(),
    type: v.union(v.literal('specific'), v.literal('similar'), v.literal('custom')),
    title: v.string(),
    link: v.string(),
    category: v.string(),
    material: v.string(),
    dims: v.string(),
    quantity: v.number(),
    targetCents: v.optional(v.number()),
    neededBy: v.string(),
    project: v.string(),
    notes: v.string(),
    imageIds: v.array(v.id('_storage')),
    status: sourcingStatus,
    options: v.array(v.object({ title: v.string(), unitCents: v.number(), leadTime: v.string(), note: v.string() })),
    chosenOption: v.optional(v.number()),
    adminNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_status', ['status', 'createdAt']),

  // A board shared by link: shoppable (retail prices, partner code) or presentation (no prices).
  holmSharedBoards: defineTable({
    slug: v.string(),
    ownerId: v.id('users'),
    title: v.string(),
    mode: v.union(v.literal('shop'), v.literal('presentation')),
    by: v.string(),
    refCode: v.optional(v.string()),
    items: v.array(
      v.object({
        productId: v.id('commerceProducts'),
        note: v.optional(v.string()),
        variantId: v.optional(v.string()),
        qty: v.optional(v.number()),
      })
    ),
    // One stable slug per board and mode: re-sharing updates the same row, so old links keep working.
    boardKey: v.optional(v.string()),
    doc: v.optional(v.any()), // the full layout: items, styles, shape, edge, page size
    coverId: v.optional(v.id('_storage')), // the rendered board, reused for Open Graph and the bundle page
    views: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_owner', ['ownerId', 'createdAt'])
    .index('by_owner_key', ['ownerId', 'boardKey', 'mode']),

  // Board covers stored by holmSync.uploadCover, so a board can only adopt an image its owner uploaded.
  holmCoverUploads: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
    createdAt: v.number(),
  }).index('by_storage', ['storageId']),

  // What each product needs to work everywhere: true dimensions, a seamless cutout and a 3D model.
  // One row per product (variantId empty) or per colour variant when materials differ.
  holmAssets: defineTable({
    productId: v.id('commerceProducts'),
    variantId: v.optional(v.string()),
    dimsCm: v.optional(
      v.object({ w: v.number(), d: v.number(), h: v.number(), seatH: v.optional(v.number()), armH: v.optional(v.number()) })
    ),
    dimsSource: v.optional(v.union(v.literal('parsed'), v.literal('manual'), v.literal('supplier'))),
    cutoutId: v.optional(v.id('_storage')),
    cutoutAspect: v.optional(v.number()), // width / height
    cutoutStatus: v.optional(v.union(v.literal('draft'), v.literal('approved'))),
    modelId: v.optional(v.id('_storage')),
    modelLowId: v.optional(v.id('_storage')),
    modelBytes: v.optional(v.number()),
    modelStatus: v.optional(v.union(v.literal('none'), v.literal('draft'), v.literal('approved'), v.literal('rejected'))),
    hangs: v.optional(v.boolean()),
    mountHeightCm: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_product', ['productId', 'variantId']),

  // An AI render of a planned room, made from the planner's snapshot and the pieces' photos.
  holmRenderRequests: defineTable({
    userId: v.id('users'),
    title: v.string(),
    prompt: v.string(),
    camera: v.optional(v.any()),
    room: v.optional(v.any()),
    snapshotId: v.optional(v.id('_storage')),
    // 'new' to 'declined' are requests from before renders were made by AI.
    status: v.union(
      v.literal('new'),
      v.literal('in_progress'),
      v.literal('delivered'),
      v.literal('declined'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed')
    ),
    pieces: v.optional(v.array(v.id('commerceProducts'))),
    resultId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    emailStatus: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_status', ['status', 'createdAt']),

  // Projects, boards, collages and inspiration, kept with the account so they follow you.
  holmUserState: defineTable({
    userId: v.id('users'),
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index('by_user_key', ['userId', 'key']),

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

// v2 production build tables (spec docs/production-v2/02 §3). Additive only: nothing here
// replaces an existing table, and every legacy path keeps working while the v2 flags are off.
import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  availability,
  commissionCategory,
  commissionEventType,
  configStatus,
  creditEventType,
  fulfillmentRoute,
  holdReason,
  membershipSource,
  obligationState,
  publicationStage,
  retailOrTrade,
  revisionMeta,
  shipAddress,
  tierKey,
} from './v2Validators';

export const v2Tables = {
  // ---------------- system (S02, S03) ----------------
  sysConfig: defineTable({
    kind: v.string(),
    key: v.string(),
    version: v.number(),
    status: configStatus,
    value: v.any(),
    note: v.string(),
    decision: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    ...revisionMeta,
  })
    .index('by_kind_key_version', ['kind', 'key', 'version'])
    .index('by_kind_status', ['kind', 'status'])
    .index('by_status', ['status', 'createdAt']),

  sysIdempotencyKeys: defineTable({
    key: v.string(),
    scope: v.string(),
    resultRef: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_key', ['key']),

  sysAuditEvents: defineTable({
    actor: v.string(),
    action: v.string(),
    entityTable: v.string(),
    entityId: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    reason: v.optional(v.string()),
    requestId: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_entity', ['entityTable', 'entityId', 'at'])
    .index('by_actor_at', ['actor', 'at'])
    .index('by_action_at', ['action', 'at']),

  sysPaymentEvents: defineTable({
    provider: v.literal('stripe'),
    eventId: v.string(),
    type: v.string(),
    account: v.optional(v.string()),
    livemode: v.boolean(),
    payloadHash: v.string(),
    payload: v.any(),
    receivedAt: v.number(),
    status: v.union(v.literal('received'), v.literal('processed'), v.literal('failed'), v.literal('ignored')),
    attempts: v.number(),
    error: v.optional(v.string()),
    processedAt: v.optional(v.number()),
  })
    .index('by_event', ['eventId'])
    .index('by_status_received', ['status', 'receivedAt']),

  sysLocks: defineTable({
    name: v.string(),
    holder: v.string(),
    expiresAt: v.number(),
  }).index('by_name', ['name']),

  sysJobs: defineTable({
    kind: v.string(),
    dedupeKey: v.string(),
    runAt: v.number(),
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('done'), v.literal('failed')),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    payload: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_dedupe', ['dedupeKey'])
    .index('by_status_runAt', ['status', 'runAt']),

  sysNotifications: defineTable({
    dedupeKey: v.string(),
    audience: v.union(v.literal('customer'), v.literal('partner'), v.literal('admin')),
    category: v.union(v.literal('transactional'), v.literal('marketing')),
    template: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    payload: v.optional(v.any()),
    status: v.union(v.literal('queued'), v.literal('sending'), v.literal('sent'), v.literal('failed'), v.literal('suppressed')),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_dedupe', ['dedupeKey'])
    .index('by_status_next', ['status', 'nextAttemptAt']),

  sysMetrics: defineTable({
    name: v.string(),
    bucket: v.string(), // YYYY-MM-DDTHH (UTC hour)
    count: v.number(),
    sum: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_name_bucket', ['name', 'bucket']),

  sysRateLimits: defineTable({
    key: v.string(),
    tokens: v.number(),
    refilledAt: v.number(),
  }).index('by_key', ['key']),

  sysReviewItems: defineTable({
    kind: v.string(), // e.g. attribution_shared_address, identity_ambiguous, migration_ambiguous
    entityTable: v.string(),
    entityId: v.string(),
    detail: v.string(),
    status: v.union(v.literal('open'), v.literal('resolved')),
    resolution: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_kind_status', ['kind', 'status', 'createdAt'])
    .index('by_entity', ['entityTable', 'entityId']),

  // ---------------- catalog (S04) ----------------
  catSuppliers: defineTable({
    code: v.string(),
    name: v.string(),
    publicAttributionAllowed: v.boolean(),
    fulfillmentRoute,
    freshnessKey: v.string(),
    createdAt: v.number(),
  }).index('by_code', ['code']),

  catSupplierPolicies: defineTable({
    supplierId: v.id('catSuppliers'),
    kind: v.union(
      v.literal('map'),
      v.literal('trade'),
      v.literal('coupon'),
      v.literal('private_label'),
      v.literal('media'),
      v.literal('returns'),
      v.literal('promotion_stacking'),
      v.literal('store_credit')
    ),
    summary: v.string(),
    evidenceRefs: v.array(v.string()),
    scope: v.object({ all: v.optional(v.boolean()), skus: v.optional(v.array(v.string())) }),
    status: v.union(v.literal('documented'), v.literal('unverified'), v.literal('denied')),
    ...revisionMeta,
  }).index('by_supplier_kind', ['supplierId', 'kind', 'effectiveFrom']),

  catWarehouses: defineTable({
    supplierId: v.id('catSuppliers'),
    code: v.string(),
    originZip: v.string(),
    state: v.string(),
    active: v.boolean(),
  }).index('by_supplier', ['supplierId', 'code']),

  catProductMeta: defineTable({
    productId: v.id('commerceProducts'),
    supplierId: v.optional(v.id('catSuppliers')),
    commissionCategory,
    navCategory: v.string(),
    louieMaeName: v.string(),
    slug: v.string(),
    slugHistory: v.array(v.object({ slug: v.string(), until: v.number() })),
    supplierName: v.string(),
    supplierProductRef: v.optional(v.string()),
    attributionText: v.optional(v.string()),
    assemblyAssetId: v.optional(v.id('catMediaAssets')),
    holds: v.array(holdReason),
    stage: publicationStage,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_product', ['productId'])
    .index('by_slug', ['slug'])
    .index('by_stage', ['stage', 'updatedAt'])
    .index('by_supplier', ['supplierId', 'updatedAt'])
    .index('by_category', ['commissionCategory', 'updatedAt']),

  catVariants: defineTable({
    productId: v.id('commerceProducts'),
    supplierId: v.id('catSuppliers'),
    supplierSku: v.string(),
    packId: v.string(),
    optionKey: v.string(),
    supplierVariantName: v.string(),
    louieMaeVariantName: v.string(),
    material: v.optional(v.string()),
    color: v.optional(v.string()),
    size: v.optional(v.string()),
    sizeClass: v.optional(v.union(v.literal('SMALL'), v.literal('MEDIUM'), v.literal('LARGE'), v.literal('OVERSIZE'), v.literal('LTL'), v.literal('UNKNOWN'))),
    piecesPerPack: v.number(),
    orderMinimumPacks: v.number(),
    orderIncrementPacks: v.number(),
    warehouseId: v.optional(v.id('catWarehouses')),
    availability,
    availabilityObservedAt: v.optional(v.number()),
    fulfillmentRoute,
    marginPolicyKey: v.optional(v.string()),
    cohort: v.optional(v.string()),
    currentCostRevisionId: v.optional(v.id('catCostRevisions')),
    retailPriceRevisionId: v.optional(v.id('catPriceRevisions')),
    tradePriceRevisionId: v.optional(v.id('catPriceRevisions')),
    holds: v.array(holdReason),
    referralEligible: v.optional(v.boolean()),
    importFingerprint: v.optional(v.string()),
    legacyVariantId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_identity', ['supplierId', 'supplierSku', 'packId'])
    .index('by_product', ['productId'])
    .index('by_availability', ['availability', 'updatedAt'])
    .index('by_cohort', ['cohort']),

  catCartons: defineTable({
    variantId: v.id('catVariants'),
    index: v.number(),
    cartonsPerPack: v.number(),
    lengthMm: v.number(),
    widthMm: v.number(),
    heightMm: v.number(),
    grossWeightG: v.number(),
    netWeightG: v.optional(v.number()),
    supplierMethod: v.union(v.literal('ground'), v.literal('ltl'), v.literal('unknown')),
    sourceObservationId: v.optional(v.id('catSourceObservations')),
    createdAt: v.number(),
  }).index('by_variant', ['variantId', 'index']),

  catSourceObservations: defineTable({
    supplierId: v.id('catSuppliers'),
    variantId: v.optional(v.id('catVariants')),
    supplierSku: v.optional(v.string()),
    field: v.string(),
    extractedValue: v.string(),
    unit: v.optional(v.string()),
    sourceFile: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    supplierRevision: v.optional(v.string()),
    observedAt: v.number(),
    effectiveFrom: v.optional(v.number()),
    effectiveTo: v.optional(v.number()),
    contentHash: v.string(),
    verifier: v.string(),
    confidence: v.union(v.literal('confirmed'), v.literal('corroborated'), v.literal('policy_derived'), v.literal('unverified'), v.literal('conflict')),
    importBatchId: v.optional(v.id('catImportBatches')),
    createdAt: v.number(),
  })
    .index('by_variant_field_observed', ['variantId', 'field', 'observedAt'])
    .index('by_hash', ['contentHash']),

  catCostRevisions: defineTable({
    variantId: v.id('catVariants'),
    wholesaleMinor: v.union(v.number(), v.null()), // cents per piece
    wholesalePrecise: v.optional(v.string()),
    currency: v.literal('USD'),
    fxRate: v.optional(v.string()),
    fxObservedAt: v.optional(v.number()),
    dutiesMinor: v.union(v.number(), v.null()),
    dutiesConfirmedZero: v.boolean(),
    inboundFreightMinor: v.union(v.number(), v.null()),
    inboundConfirmedZero: v.boolean(),
    supplierFeesMinor: v.union(v.number(), v.null()),
    feesConfirmedZero: v.boolean(),
    mapMinor: v.union(v.number(), v.null()),
    mapUnitBasis: v.union(v.literal('piece'), v.literal('pack')),
    mapSource: v.union(v.literal('explicit_sku'), v.literal('policy_derived'), v.literal('none')),
    mapPolicyVersion: v.optional(v.string()),
    mapApplicability: v.union(v.literal('applies'), v.literal('not_applicable'), v.literal('unknown')),
    costSource: v.string(),
    verifiedAt: v.optional(v.number()),
    observationIds: v.array(v.id('catSourceObservations')),
    ...revisionMeta,
  }).index('by_variant_effective', ['variantId', 'effectiveFrom']),

  catPriceRevisions: defineTable({
    variantId: v.id('catVariants'),
    channel: retailOrTrade,
    packPriceMinor: v.number(),
    piecePriceMinorInfo: v.number(),
    marginPolicyKey: v.string(),
    marginPolicyVersion: v.number(),
    roundingPolicyVersion: v.number(),
    scenarioResultId: v.optional(v.id('catScenarioResults')),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    status: v.union(v.literal('candidate'), v.literal('approved'), v.literal('superseded')),
    origin: v.union(v.literal('import_approved'), v.literal('engine'), v.literal('manual')),
    reason: v.optional(v.string()),
    ...revisionMeta,
  }).index('by_variant_channel_effective', ['variantId', 'channel', 'effectiveFrom']),

  catScenarioResults: defineTable({
    variantId: v.id('catVariants'),
    inputsHash: v.string(),
    scenarios: v.array(
      v.object({
        name: v.string(),
        priceMinor: v.number(),
        contributionMinor: v.number(),
        contributionBps: v.number(),
        passes: v.boolean(),
        reason: v.optional(v.string()),
      })
    ),
    minimumRetailMinor: v.union(v.number(), v.null()),
    computedAt: v.number(),
    engineVersion: v.string(),
  }).index('by_variant_computed', ['variantId', 'computedAt']),

  catMediaAssets: defineTable({
    productId: v.id('commerceProducts'),
    variantId: v.optional(v.id('catVariants')),
    role: v.union(v.literal('hero'), v.literal('gallery'), v.literal('assembly'), v.literal('swatch')),
    storageId: v.optional(v.id('_storage')),
    derivatives: v.array(v.object({ width: v.number(), storageId: v.id('_storage'), format: v.string() })),
    contentHash: v.string(),
    mime: v.string(),
    width: v.number(),
    height: v.number(),
    bytes: v.number(),
    sourceUrl: v.string(),
    rights: v.object({ basis: v.string(), evidenceRef: v.optional(v.string()), attributionRequired: v.boolean(), privateOriginal: v.boolean() }),
    altText: v.string(),
    verifiedAgainst: v.optional(v.object({ sku: v.string(), color: v.optional(v.string()), pack: v.optional(v.string()) })),
    status: v.union(v.literal('pending'), v.literal('verified'), v.literal('rejected')),
    rejectReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_product', ['productId', 'role'])
    .index('by_hash', ['contentHash']),

  catImportBatches: defineTable({
    supplierId: v.id('catSuppliers'),
    sourceKey: v.string(),
    files: v.array(v.object({ name: v.string(), sha256: v.string(), rows: v.number() })),
    mode: v.union(v.literal('dry_run'), v.literal('commit')),
    status: v.union(v.literal('running'), v.literal('done'), v.literal('failed')),
    summary: v.any(),
    metadataCorrections: v.optional(v.array(v.string())),
    codeRevision: v.string(),
    schemaVersion: v.string(),
    configVersions: v.any(),
    startedBy: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index('by_source_mode', ['sourceKey', 'mode', 'startedAt']),

  catImportRecords: defineTable({
    batchId: v.id('catImportBatches'),
    sourceRowKey: v.string(),
    action: v.union(v.literal('create'), v.literal('update'), v.literal('unchanged'), v.literal('reject'), v.literal('hold')),
    reasons: v.array(v.string()),
    cohort: v.optional(v.string()),
    diff: v.optional(v.any()),
    variantId: v.optional(v.id('catVariants')),
    conflicts: v.optional(v.array(v.string())),
  })
    .index('by_batch', ['batchId', 'sourceRowKey'])
    .index('by_batch_action', ['batchId', 'action']),

  catRetailMappings: defineTable({
    holmProductId: v.id('commerceProducts'),
    holmVariantId: v.string(),
    retailProductId: v.id('commerceProducts'),
    retailVariantId: v.string(),
    status: v.union(v.literal('active'), v.literal('retired')),
    redirectFrom: v.optional(v.string()),
    ...revisionMeta,
  })
    .index('by_holm_variant', ['holmProductId', 'holmVariantId', 'status'])
    .index('by_retail_variant', ['retailProductId', 'retailVariantId']),

  catListingState: defineTable({
    listingId: v.id('commerceListings'),
    stage: publicationStage,
    holds: v.array(holdReason),
    publishedRevision: v.optional(v.number()),
    previousSnapshot: v.optional(v.any()),
    publishedAt: v.optional(v.number()),
    unpublishedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_listing', ['listingId']),

  catHolds: defineTable({
    variantId: v.id('catVariants'),
    reason: holdReason,
    detail: v.string(),
    openedAt: v.number(),
    openedBy: v.string(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    resolution: v.optional(v.string()),
  })
    .index('by_variant_open', ['variantId', 'resolvedAt'])
    .index('by_reason_open', ['reason', 'resolvedAt']),

  catMarketReviews: defineTable({
    variantId: v.id('catVariants'),
    observations: v.array(
      v.object({
        retailer: v.string(),
        url: v.string(),
        observedAt: v.number(),
        merchandiseMinor: v.number(),
        inStock: v.boolean(),
        deliveryMinor: v.number(),
        serviceLevel: v.string(),
        totalBeforeTaxMinor: v.number(),
        zip: v.string(),
        exactMatch: v.boolean(),
      })
    ),
    ourDeliveredMinor: v.number(),
    medianDeliveredMinor: v.optional(v.number()),
    flag: v.union(v.literal('ok'), v.literal('above_median_10pct'), v.literal('above_lowest_material'), v.literal('evidence_limited')),
    reviewer: v.optional(v.string()),
    decision: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_variant', ['variantId', 'createdAt']),

  catPromotions: defineTable({
    supplierId: v.optional(v.id('catSuppliers')),
    skus: v.optional(v.array(v.string())),
    channel: retailOrTrade,
    mechanism: v.union(v.literal('coupon'), v.literal('automatic'), v.literal('project'), v.literal('credit')),
    code: v.optional(v.string()),
    bps: v.optional(v.number()),
    amountMinor: v.optional(v.number()),
    fundingSource: v.string(),
    stackingPriority: v.number(),
    evidenceRef: v.optional(v.string()),
    status: v.union(v.literal('draft'), v.literal('active'), v.literal('ended')),
    ...revisionMeta,
  }).index('by_channel_status', ['channel', 'status']),

  // ---------------- delivery, cart, quotes, orders (S07) ----------------
  dlvEstimates: defineTable({
    cartRevision: v.optional(v.number()),
    channel: retailOrTrade,
    destination: v.object({ zip: v.string(), precision: v.union(v.literal('zip'), v.literal('full')), addressHash: v.optional(v.string()), state: v.optional(v.string()) }),
    service: v.string(),
    lines: v.array(v.object({ variantId: v.id('catVariants'), packs: v.number() })),
    groups: v.array(
      v.object({
        groupKey: v.string(),
        supplierCode: v.string(),
        rule: v.string(),
        classification: v.string(),
        freightMinor: v.number(),
        subsidyMinor: v.number(),
        requirementMinor: v.number(),
        chargeMinor: v.optional(v.number()),
        quoteRequired: v.boolean(),
        reasons: v.array(v.string()),
      })
    ),
    status: v.union(v.literal('ok'), v.literal('quote_required'), v.literal('unsupported')),
    deliveryChargeMinor: v.optional(v.number()),
    merchandiseMinor: v.number(),
    discountMinor: v.number(),
    creditMinor: v.number(),
    taxMinor: v.optional(v.number()),
    totalMinor: v.optional(v.number()),
    expiresAt: v.number(),
    cartHash: v.string(),
    sourceVersionsHash: v.string(),
    internal: v.any(),
    userId: v.optional(v.id('users')),
    createdAt: v.number(),
  }).index('by_cart_hash', ['cartHash', 'createdAt']),

  ordCarts: defineTable({
    ownerKey: v.string(),
    revision: v.number(),
    lines: v.array(v.object({ variantId: v.id('catVariants'), packs: v.number() })),
    channel: retailOrTrade,
    updatedAt: v.number(),
  }).index('by_owner', ['ownerKey']),

  ordQuoteVersions: defineTable({
    projectId: v.id('commerceProjects'),
    version: v.number(),
    lines: v.array(v.object({ variantId: v.string(), productId: v.id('commerceProducts'), packs: v.number(), unitPackMinor: v.number(), discountMinor: v.number() })),
    address: v.optional(shipAddress),
    service: v.string(),
    deliveryMinor: v.number(),
    taxMinor: v.number(),
    expiresAt: v.number(),
    terms: v.string(),
    status: v.union(v.literal('draft'), v.literal('sent'), v.literal('accepted'), v.literal('superseded'), v.literal('expired')),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.string()),
    checks: v.object({ map: v.boolean(), margin: v.boolean(), policy: v.boolean(), notes: v.array(v.string()) }),
    reservesInventory: v.boolean(),
    createdAt: v.number(),
  }).index('by_project_version', ['projectId', 'version']),

  ordCheckoutIntents: defineTable({
    idempotencyKey: v.string(),
    estimateId: v.id('dlvEstimates'),
    cartHash: v.string(),
    channel: retailOrTrade,
    buyer: v.object({ userId: v.optional(v.id('users')), email: v.optional(v.string()) }),
    lineSnapshot: v.array(
      v.object({
        lineKey: v.string(),
        variantId: v.id('catVariants'),
        productId: v.id('commerceProducts'),
        name: v.string(),
        packs: v.number(),
        pieces: v.number(),
        unitPackMinor: v.number(),
        discountMinor: v.number(),
        creditMinor: v.number(),
        commissionCategory,
        supplierCode: v.string(),
        costRevisionId: v.optional(v.id('catCostRevisions')),
        priceRevisionId: v.optional(v.id('catPriceRevisions')),
      })
    ),
    merchandiseMinor: v.number(),
    deliveryMinor: v.number(),
    taxMinor: v.number(),
    creditMinor: v.number(),
    totalMinor: v.number(),
    attributionSnapshotId: v.optional(v.id('prgAttributionSnapshots')),
    creditReservationRef: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
    status: v.union(v.literal('created'), v.literal('session_open'), v.literal('paid'), v.literal('expired'), v.literal('failed'), v.literal('exception')),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_key', ['idempotencyKey'])
    .index('by_session', ['stripeSessionId'])
    .index('by_status_expires', ['status', 'expiresAt']),

  ordInventoryReservations: defineTable({
    variantId: v.id('catVariants'),
    packs: v.number(),
    intentId: v.id('ordCheckoutIntents'),
    expiresAt: v.number(),
    status: v.union(v.literal('held'), v.literal('released'), v.literal('consumed')),
  })
    .index('by_variant_status', ['variantId', 'status'])
    .index('by_intent', ['intentId']),

  ordOrders: defineTable({
    number: v.string(),
    intentId: v.optional(v.id('ordCheckoutIntents')),
    legacyOrderId: v.optional(v.id('orders')),
    channel: retailOrTrade,
    buyerUserId: v.optional(v.id('users')),
    email: v.string(),
    shippingAddress: v.optional(shipAddress),
    paymentIntentId: v.optional(v.string()),
    paidAt: v.number(),
    totals: v.object({ merchandise: v.number(), discount: v.number(), credit: v.number(), delivery: v.number(), tax: v.number(), total: v.number() }),
    splitKnown: v.boolean(),
    accrualPath: v.union(v.literal('legacy'), v.literal('v2'), v.literal('none')),
    status: v.union(
      v.literal('paid'),
      v.literal('partially_shipped'),
      v.literal('shipped'),
      v.literal('partially_delivered'),
      v.literal('delivered'),
      v.literal('cancelled'),
      v.literal('exception')
    ),
    createdAt: v.number(),
  })
    .index('by_number', ['number'])
    .index('by_payment', ['paymentIntentId'])
    .index('by_buyer', ['buyerUserId', 'createdAt'])
    .index('by_email', ['email', 'createdAt']),

  ordOrderLines: defineTable({
    orderId: v.id('ordOrders'),
    lineNo: v.number(),
    lineKey: v.string(),
    variantId: v.id('catVariants'),
    productId: v.id('commerceProducts'),
    name: v.string(),
    packs: v.number(),
    pieces: v.number(),
    unitPackMinor: v.number(),
    discountMinor: v.number(),
    creditMinor: v.number(),
    taxMinor: v.number(),
    deliveryAllocMinor: v.number(),
    commissionCategory,
    supplierCode: v.string(),
    costRevisionId: v.optional(v.id('catCostRevisions')),
    priceRevisionId: v.optional(v.id('catPriceRevisions')),
    refundedMinor: v.number(),
    status: v.union(v.literal('open'), v.literal('shipped'), v.literal('delivered'), v.literal('cancelled'), v.literal('refunded')),
  }).index('by_order', ['orderId', 'lineNo']),

  ordSupplierOrders: defineTable({
    orderId: v.id('ordOrders'),
    supplierCode: v.string(),
    warehouseCode: v.optional(v.string()),
    service: v.string(),
    route: fulfillmentRoute,
    supplierPo: v.optional(v.string()),
    acceptedCostMinor: v.optional(v.number()),
    status: v.union(
      v.literal('queued'),
      v.literal('submitted'),
      v.literal('acknowledged'),
      v.literal('partially_shipped'),
      v.literal('shipped'),
      v.literal('delivered'),
      v.literal('rejected'),
      v.literal('cancelled'),
      v.literal('exception')
    ),
    submission: v.object({
      mode: v.union(v.literal('none'), v.literal('manual'), v.literal('edi')),
      handoffAt: v.optional(v.number()),
      by: v.optional(v.string()),
      payloadHash: v.optional(v.string()),
      transmissionId: v.optional(v.string()),
      ackState: v.optional(v.string()),
      uncertain: v.optional(v.boolean()),
    }),
    supplierConfirmation: v.optional(v.string()),
    exceptions: v.array(v.object({ at: v.number(), kind: v.string(), note: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_order', ['orderId'])
    .index('by_route_status', ['route', 'status', 'updatedAt']),

  ordAllocations: defineTable({
    orderLineId: v.id('ordOrderLines'),
    supplierOrderId: v.id('ordSupplierOrders'),
    pieces: v.number(),
    packs: v.number(),
    status: v.union(v.literal('open'), v.literal('shipped'), v.literal('delivered'), v.literal('cancelled')),
  })
    .index('by_line', ['orderLineId'])
    .index('by_supplier_order', ['supplierOrderId']),

  ordShipments: defineTable({
    supplierOrderId: v.id('ordSupplierOrders'),
    carrier: v.optional(v.string()),
    trackingUrl: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    shippedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    estimatedWindow: v.optional(v.string()),
    status: v.union(v.literal('shipped'), v.literal('delivered'), v.literal('lost'), v.literal('damaged')),
    createdAt: v.number(),
  }).index('by_supplier_order', ['supplierOrderId']),

  ordShipmentItems: defineTable({
    shipmentId: v.id('ordShipments'),
    allocationId: v.id('ordAllocations'),
    pieces: v.number(),
  })
    .index('by_shipment', ['shipmentId'])
    .index('by_allocation', ['allocationId']),

  ordPaidExceptions: defineTable({
    intentId: v.optional(v.id('ordCheckoutIntents')),
    paymentIntentId: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
    reason: v.union(v.literal('intent_expired'), v.literal('stock_failed'), v.literal('total_mismatch'), v.literal('policy_changed')),
    evidence: v.any(),
    status: v.union(v.literal('open'), v.literal('resolved')),
    resolution: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_status', ['status', 'createdAt']),

  ordFreightActuals: defineTable({
    supplierOrderId: v.id('ordSupplierOrders'),
    estimatedMinor: v.number(),
    actualMinor: v.number(),
    invoiceRef: v.string(),
    varianceMinor: v.number(),
    createdAt: v.number(),
  }).index('by_supplier_order', ['supplierOrderId']),

  ordReturns: defineTable({
    orderLineId: v.id('ordOrderLines'),
    policyKey: v.string(),
    reason: v.string(),
    pieces: v.number(),
    authorizedAt: v.optional(v.number()),
    condition: v.optional(v.string()),
    restockingMinor: v.number(),
    refund: v.object({ merchandise: v.number(), tax: v.number(), delivery: v.number(), creditRestored: v.number(), cash: v.number() }),
    goodwill: v.boolean(),
    status: v.union(v.literal('requested'), v.literal('authorized'), v.literal('received'), v.literal('refunded'), v.literal('rejected')),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index('by_line', ['orderLineId']),

  // ---------------- programs (S05, S24–S28) ----------------
  prgBeneficiaries: defineTable({
    kind: v.union(v.literal('person'), v.literal('business')),
    userId: v.optional(v.id('users')),
    organizationId: v.optional(v.id('prgOrganizations')),
    displayName: v.string(),
    payoutAccountRef: v.optional(v.string()),
    payoutReadiness: v.union(v.literal('not_started'), v.literal('pending'), v.literal('ready'), v.literal('restricted')),
    taxReadiness: v.union(v.literal('none'), v.literal('pending'), v.literal('approved')),
    tierKey,
    tierSnapshotId: v.optional(v.id('prgTierSnapshots')),
    legacyUserId: v.optional(v.id('users')),
    refCode: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('suspended'), v.literal('closed')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_org', ['organizationId'])
    .index('by_refCode', ['refCode'])
    .index('by_legacy_user', ['legacyUserId'])
    .index('by_status', ['status', 'updatedAt']),

  prgOrganizations: defineTable({
    legalName: v.string(),
    displayName: v.string(),
    ein4: v.optional(v.string()),
    domain: v.optional(v.string()),
    verification: v.union(v.literal('pending'), v.literal('verified'), v.literal('rejected'), v.literal('needs_info')),
    verifiedAt: v.optional(v.number()),
    referredByBeneficiaryId: v.optional(v.id('prgBeneficiaries')),
    legacyOwnerUserId: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_domain', ['domain'])
    .index('by_legacy_owner', ['legacyOwnerUserId']),

  prgOrganizationMembers: defineTable({
    organizationId: v.id('prgOrganizations'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('purchasing'), v.literal('readonly')),
    status: v.union(v.literal('invited'), v.literal('active'), v.literal('removed')),
    invitedBy: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId', 'status'])
    .index('by_user', ['userId', 'status']),

  prgMemberships: defineTable({
    program: membershipSource,
    userId: v.id('users'),
    organizationId: v.optional(v.id('prgOrganizations')),
    beneficiaryId: v.optional(v.id('prgBeneficiaries')),
    state: v.string(), // creator: email_unverified|profile|terms|checks|active|review|suspended|closed; trade: applied|evidence|review|approved|rejected|needs_info|suspended|closed
    referralActivated: v.optional(v.boolean()),
    termsAcceptanceId: v.optional(v.id('prgTermsAcceptances')),
    legacyTerms: v.optional(v.boolean()),
    profile: v.optional(v.object({ displayName: v.string(), urls: v.array(v.string()), audience: v.optional(v.string()) })),
    reviewReasons: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_program', ['userId', 'program'])
    .index('by_program_state', ['program', 'state', 'updatedAt']),

  prgTermsVersions: defineTable({
    program: v.union(v.literal('creator'), v.literal('trade'), v.literal('referral'), v.literal('privacy')),
    version: v.number(),
    title: v.string(),
    bodyHash: v.string(),
    effectiveFrom: v.number(),
    status: v.union(v.literal('draft'), v.literal('published'), v.literal('retired')),
    createdAt: v.number(),
  }).index('by_program_version', ['program', 'version']),

  prgTermsAcceptances: defineTable({
    userId: v.id('users'),
    termsVersionId: v.id('prgTermsVersions'),
    acceptedAt: v.number(),
  }).index('by_user', ['userId', 'acceptedAt']),

  prgReferralLinks: defineTable({
    linkId: v.string(),
    beneficiaryId: v.id('prgBeneficiaries'),
    membershipSource,
    destination: v.object({
      kind: v.union(v.literal('variant'), v.literal('page')),
      productId: v.optional(v.id('commerceProducts')),
      variantId: v.optional(v.string()),
      path: v.optional(v.string()),
    }),
    channelTag: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_link', ['linkId'])
    .index('by_beneficiary', ['beneficiaryId', 'createdAt']),

  prgReferralClicks: defineTable({
    clickId: v.string(),
    linkId: v.optional(v.string()),
    legacyRefCode: v.optional(v.string()),
    beneficiaryId: v.id('prgBeneficiaries'),
    membershipSource,
    visitorKeyHash: v.string(),
    userId: v.optional(v.id('users')),
    consent: v.union(v.literal('granted'), v.literal('denied'), v.literal('unknown')),
    eligible: v.boolean(),
    ineligibleReason: v.optional(v.string()),
    termsVersion: v.optional(v.number()),
    rateSnapshot: v.object({
      tierKey,
      scheduleVersion: v.number(),
      product: v.optional(v.object({ productId: v.id('commerceProducts'), category: commissionCategory, rateBps: v.number(), exceptionVersion: v.optional(v.number()) })),
    }),
    at: v.number(),
    expiresAt: v.number(),
  })
    .index('by_click', ['clickId'])
    .index('by_visitor_at', ['visitorKeyHash', 'at'])
    .index('by_user_at', ['userId', 'at'])
    .index('by_beneficiary_at', ['beneficiaryId', 'at']),

  prgAttributionSnapshots: defineTable({
    intentId: v.optional(v.id('ordCheckoutIntents')),
    clickId: v.string(),
    beneficiaryId: v.id('prgBeneficiaries'),
    membershipSource,
    scope: v.literal('basket'),
    lines: v.array(
      v.object({
        lineKey: v.string(),
        productId: v.id('commerceProducts'),
        category: commissionCategory,
        protectedRateBps: v.number(),
        currentRateBps: v.number(),
        appliedRateBps: v.number(),
        eligible: v.boolean(),
        reason: v.optional(v.string()),
      })
    ),
    tierKeyAtPurchase: tierKey,
    scheduleVersion: v.number(),
    createdAt: v.number(),
  }).index('by_intent', ['intentId']),

  prgTierSnapshots: defineTable({
    beneficiaryId: v.id('prgBeneficiaries'),
    tierKey,
    previousTierKey: v.optional(tierKey),
    qualifyingMinor: v.number(),
    windowStart: v.number(),
    windowEnd: v.number(),
    watermark: v.string(),
    localDate: v.optional(v.string()),
    computedAt: v.number(),
    reason: v.union(v.literal('daily'), v.literal('event'), v.literal('override'), v.literal('migration')),
  })
    .index('by_beneficiary_computed', ['beneficiaryId', 'computedAt'])
    .index('by_reason_date', ['reason', 'localDate']),

  prgSkuCommissionExceptions: defineTable({
    productId: v.id('commerceProducts'),
    rates: v.array(v.object({ tierKey, rateBps: v.number() })),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    visibleNote: v.string(),
    approvedBy: v.string(),
    version: v.number(),
    createdAt: v.number(),
  }).index('by_product_effective', ['productId', 'effectiveFrom']),

  // ---------------- ledger (S06, S29–S31) ----------------
  ldgObligations: defineTable({
    beneficiaryId: v.id('prgBeneficiaries'),
    source: v.union(v.literal('retail_order'), v.literal('legacy_storefront'), v.literal('legacy_house_quote'), v.literal('adjustment'), v.literal('offset')),
    orderId: v.optional(v.id('ordOrders')),
    orderLineId: v.optional(v.id('ordOrderLines')),
    legacyCommissionId: v.optional(v.id('holmCommissions')),
    category: v.optional(commissionCategory),
    rateBps: v.number(),
    basisMinor: v.number(),
    earnedMinor: v.number(),
    reversedMinor: v.number(),
    heldMinor: v.number(),
    refundedBasisMinor: v.number(),
    state: obligationState,
    paidAt: v.optional(v.number()),
    clearsAt: v.number(),
    clearedAt: v.optional(v.number()),
    payoutRunId: v.optional(v.id('ldgPayoutRuns')),
    transferAttemptId: v.optional(v.id('ldgTransferAttempts')),
    currency: v.literal('USD'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_beneficiary_state', ['beneficiaryId', 'state'])
    .index('by_state_clears', ['state', 'clearsAt'])
    .index('by_order_line', ['orderLineId'])
    .index('by_order', ['orderId'])
    .index('by_legacy', ['legacyCommissionId'])
    .index('by_beneficiary_created', ['beneficiaryId', 'createdAt']),

  ldgCommissionEvents: defineTable({
    eventKey: v.string(),
    obligationId: v.id('ldgObligations'),
    type: commissionEventType,
    amountMinor: v.number(),
    cumulativeRefundedMinor: v.optional(v.number()),
    providerRef: v.optional(v.string()),
    actor: v.string(),
    reason: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_key', ['eventKey'])
    .index('by_obligation_at', ['obligationId', 'at']),

  ldgCreditAccounts: defineTable({
    userId: v.id('users'),
    availableMinor: v.number(),
    reservedMinor: v.number(),
    pendingAwardMinor: v.number(),
    lifetimeIssuedMinor: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  ldgCreditEvents: defineTable({
    eventKey: v.string(),
    accountId: v.id('ldgCreditAccounts'),
    type: creditEventType,
    amountMinor: v.number(),
    ref: v.optional(v.string()),
    orderId: v.optional(v.id('ordOrders')),
    intentId: v.optional(v.id('ordCheckoutIntents')),
    referredOrganizationId: v.optional(v.id('prgOrganizations')),
    fundingReserveRef: v.optional(v.string()),
    availableAt: v.optional(v.number()),
    actor: v.string(),
    reason: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_key', ['eventKey'])
    .index('by_account_at', ['accountId', 'at'])
    .index('by_ref', ['ref'])
    .index('by_referred_org', ['referredOrganizationId'])
    .index('by_type_available', ['type', 'availableAt']),

  ldgPayoutRuns: defineTable({
    period: v.string(),
    kind: v.union(v.literal('monthly'), v.literal('manual')),
    cutoffAt: v.number(),
    startedAt: v.number(),
    status: v.union(v.literal('planning'), v.literal('reserving'), v.literal('submitting'), v.literal('reconciling'), v.literal('done'), v.literal('aborted')),
    totals: v.object({
      eligibleMinor: v.number(),
      reservedMinor: v.number(),
      submittedMinor: v.number(),
      transferredMinor: v.number(),
      failedMinor: v.number(),
      carriedMinor: v.number(),
    }),
    fundingCheck: v.optional(v.object({ availableMinor: v.number(), at: v.number(), ok: v.boolean() })),
    abortReason: v.optional(v.string()),
    lockName: v.optional(v.string()),
    createdBy: v.string(),
  }).index('by_period_kind', ['period', 'kind']),

  ldgTransferAttempts: defineTable({
    payoutRunId: v.id('ldgPayoutRuns'),
    beneficiaryId: v.id('prgBeneficiaries'),
    amountMinor: v.number(),
    obligationIds: v.array(v.id('ldgObligations')),
    idempotencyKey: v.string(),
    destination: v.string(),
    method: v.union(v.literal('stripe'), v.literal('manual')),
    stripeTransferId: v.optional(v.string()),
    externalReference: v.optional(v.string()),
    state: v.union(v.literal('created'), v.literal('submitted'), v.literal('succeeded'), v.literal('failed'), v.literal('uncertain'), v.literal('reversed')),
    error: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_run', ['payoutRunId'])
    .index('by_key', ['idempotencyKey'])
    .index('by_state', ['state', 'createdAt'])
    .index('by_transfer', ['stripeTransferId']),

  ldgBankPayouts: defineTable({
    accountId: v.string(),
    stripePayoutId: v.string(),
    amountMinor: v.number(),
    arrivalDate: v.optional(v.number()),
    status: v.union(v.literal('pending'), v.literal('in_transit'), v.literal('paid'), v.literal('failed'), v.literal('canceled')),
    failureCode: v.optional(v.string()),
    observedAt: v.number(),
  })
    .index('by_account', ['accountId', 'observedAt'])
    .index('by_payout', ['stripePayoutId']),
};

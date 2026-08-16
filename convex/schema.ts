import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const cjInventoryStatusValidator = v.union(
    v.literal("unknown"),
    v.literal("in_stock"),
    v.literal("low_stock"),
    v.literal("out_of_stock"),
    v.literal("partial"),
    v.literal("error")
);

const productStorefrontStatusValidator = v.union(
    v.literal("published"),
    v.literal("hidden"),
    v.literal("next_launch")
);

const cjSourcingStateValidator = v.union(
    v.literal("needs_input"),
    v.literal("queued"),
    v.literal("submitting"),
    v.literal("submitted"),
    v.literal("processing"),
    v.literal("awaiting_catalog"),
    v.literal("sourced"),
    v.literal("mapping_required"),
    v.literal("fulfillment_ready"),
    v.literal("retry_wait"),
    v.literal("reconciliation_required"),
    v.literal("rejected"),
    v.literal("dead_letter"),
    v.literal("canceled"),
);

const cjFulfillmentReadinessValidator = v.union(
    v.literal("not_required"),
    v.literal("not_ready"),
    v.literal("mapping_required"),
    v.literal("ready"),
    v.literal("blocked"),
);

export default defineSchema({
    // Convex Auth tables (users, sessions, accounts, etc.)
    ...authTables,

    // Products table
    products: defineTable({
        name: v.string(),
        price: v.number(),
        description: v.string(),
        images: v.array(v.string()),
        category: v.string(),
        collection: v.string(),
        isNew: v.optional(v.boolean()),
        inStock: v.optional(v.boolean()),
        publishedAt: v.optional(v.string()),
        storefrontStatus: v.optional(productStorefrontStatusValidator),
        launchBatchId: v.optional(v.string()),
        launchAddedAt: v.optional(v.string()),
        launchedAt: v.optional(v.string()),
        // Customer-facing variants (sizes, colors, etc.)
        variants: v.optional(v.array(v.object({
            id: v.string(),
            name: v.string(),
            image: v.optional(v.string()),
            priceAdjustment: v.number(),
            inStock: v.boolean(),
            // CJ fulfillment mapping - links customer variant to CJ variant
            cjVariantId: v.optional(v.string()),  // CJ vid for this variant
            cjSku: v.optional(v.string()),         // CJ SKU for this variant
        }))),
        // CJ Dropshipping Sourcing Fields
        cjSourcingStatus: v.optional(v.union(
            v.literal("pending"),     // Submitted to CJ, awaiting approval
            v.literal("approved"),    // CJ approved, has vid/sku
            v.literal("rejected"),    // CJ rejected the product
            v.literal("none")         // Not submitted to CJ (manual product)
        )),
        cjSourcingId: v.optional(v.string()),    // CJ sourcing request ID
        cjVariantId: v.optional(v.string()),     // CJ vid (default/legacy)
        cjSku: v.optional(v.string()),           // CJ SKU (default/legacy)
        cjProductId: v.optional(v.string()),     // CJ product ID
        cjSourcingError: v.optional(v.string()), // Rejection reason
        sourceUrl: v.optional(v.string()),       // Original AliExpress/source URL
        batchImportItemId: v.optional(v.id("batchImportItems")), // Idempotency key for batch imports
        cjApprovedAt: v.optional(v.string()),    // When CJ approved the product
        cjSubmittedAt: v.optional(v.string()),   // When product was submitted to CJ
        cjLastCheckedAt: v.optional(v.string()), // Last time we checked CJ for status
        cjRejectedAt: v.optional(v.string()),    // Immutable timestamp for terminal rejection age
        cjSourcingState: v.optional(cjSourcingStateValidator),
        cjFulfillmentReadiness: v.optional(cjFulfillmentReadinessValidator),
        cjSourcingJobId: v.optional(v.id("cjSourcingJobs")),
        cjReadinessReasons: v.optional(v.array(v.string())),
        cjProjectionUpdatedAt: v.optional(v.number()),
        cjInventoryStatus: v.optional(cjInventoryStatusValidator),
        cjInventoryTotal: v.optional(v.number()),
        cjInventoryLastCheckedAt: v.optional(v.string()),
        cjInventoryNextCheckAt: v.optional(v.number()),
        cjInventoryError: v.optional(v.string()),
        cjInventoryNeedsReview: v.optional(v.boolean()),
        cjInventoryReviewReason: v.optional(v.union(
            v.literal("restocked"),
            v.literal("out_of_stock"),
            v.literal("manual")
        )),
        cjInventoryRestockedAt: v.optional(v.string()),
        cjInventoryAutoHiddenAt: v.optional(v.string()),
        cjInventoryPreviousStatus: v.optional(cjInventoryStatusValidator),
        cjInventoryLastStatusChangeAt: v.optional(v.string()),
        cjInventoryLastWebhookAt: v.optional(v.string()),
        cjInventoryByVariant: v.optional(v.array(v.object({
            vid: v.optional(v.string()),
            sku: v.optional(v.string()),
            totalInventoryNum: v.optional(v.number()),
            cjInventoryNum: v.optional(v.number()),
            factoryInventoryNum: v.optional(v.number()),
            status: cjInventoryStatusValidator,
            lowStockThreshold: v.number(),
            lastCheckedAt: v.string(),
            error: v.optional(v.string()),
        }))),
        // All CJ variants received from webhooks (for admin linking)
        cjVariants: v.optional(v.array(v.object({
            vid: v.string(),                       // CJ variant ID
            sku: v.string(),                       // CJ SKU
            name: v.string(),                      // CJ variant name (e.g., "Size: 3T - Blue")
            price: v.optional(v.number()),         // CJ price
            image: v.optional(v.string()),         // CJ variant image
        }))),
        // Two-stage pricing fields
        sourcePriceCny: v.optional(v.number()),      // Original 1688 factory price (CNY)
        rawSourceDescription: v.optional(v.string()), // Cleaned source detail text for smart descriptions
        rawHtmlDescription: v.optional(v.string()),   // Raw source detail HTML for smart descriptions
        descriptionImages: v.optional(v.array(v.string())), // Source detail/marketing images for smart descriptions
        estimatedCjCost: v.optional(v.number()),     // Estimated CJ cost (1688 × 1.2, in USD)
        estimatedShipping: v.optional(v.number()),   // Estimated shipping (category-based)
        confirmedCjCost: v.optional(v.number()),     // Actual CJ cost after sourcing approval
        estimatedCjProductCost: v.optional(v.number()),
        estimatedCjShippingCost: v.optional(v.number()),
        estimatedCjServiceFee: v.optional(v.number()),
        estimatedLandedCost: v.optional(v.number()),
        confirmedCjProductCost: v.optional(v.number()),
        confirmedCjShippingCost: v.optional(v.number()),
        confirmedCjServiceFee: v.optional(v.number()),
        confirmedCjTaxesFee: v.optional(v.number()),
        confirmedCjClearanceFee: v.optional(v.number()),
        confirmedCjRemoteFee: v.optional(v.number()),
        confirmedCjLogisticsName: v.optional(v.string()),
        confirmedLandedCost: v.optional(v.number()),
        suggestedRetailPrice: v.optional(v.number()),
        adminPriceLocked: v.optional(v.boolean()),
        pricingSource: v.optional(v.union(
            v.literal("source_estimate"),
            v.literal("cj_catalog_confirmed"),
            v.literal("cj_freight_confirmed"),
            v.literal("manual_locked"),
            v.literal("order_reconciled")
        )),
        pricingUpdatedAt: v.optional(v.number()),
        pricingWarnings: v.optional(v.array(v.string())),
        pricingStage: v.optional(v.union(
            v.literal("estimated"),    // Pre-sourcing price based on 1688 + formula
            v.literal("confirmed")     // Post-sourcing price with real CJ cost
        )),
        // Multi-category support
        subcategory: v.optional(v.string()),         // e.g., "Skirts" (parent category auto-derived)
        smartDescription: v.optional(v.object({
            description: v.string(),
            auditId: v.id("descriptionAudits"),
            generatedAt: v.number(),
            model: v.string(),
            promptVersion: v.string(),
            sourceSnapshotHash: v.string(),
            adminEdited: v.boolean(),
            status: v.union(
                v.literal("generated"),
                v.literal("edited"),
                v.literal("approved"),
                v.literal("failed"),
                v.literal("fallback")
            ),
        })),
        descriptionSource: v.optional(v.union(
            v.literal("admin_written"),
            v.literal("ai_generated"),
            v.literal("ai_generated_admin_edited"),
            v.literal("source_original"),
            v.literal("safe_fallback")
        )),
        descriptionFingerprint: v.optional(v.object({
            normalizedOpening: v.string(),
            topPhrases: v.array(v.string()),
            productType: v.string(),
            collection: v.string(),
        })),
        searchText: v.optional(v.string()),
    }).index("by_cj_sourcing_status", ["cjSourcingStatus"])
        .index("by_cj_sourcing_status_job", ["cjSourcingStatus", "cjSourcingJobId"])
        .index("by_storefront_status", ["storefrontStatus"])
        .index("by_cj_sourcing_id", ["cjSourcingId"])
        .index("by_batch_import_item", ["batchImportItemId"])
        .index("by_inventory_next_check", ["cjInventoryNextCheckAt"])
        .index("by_search_text", ["searchText"])
        .searchIndex("search_storefront", {
            searchField: "searchText",
            filterFields: ["storefrontStatus"],
        }),

    descriptionAudits: defineTable({
        productId: v.optional(v.id("products")),
        importSessionId: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        sourceDomain: v.optional(v.string()),
        generationMode: v.union(
            v.literal("import_auto"),
            v.literal("manual_generate"),
            v.literal("manual_regenerate"),
            v.literal("batch_regenerate"),
            v.literal("repair_existing")
        ),
        model: v.string(),
        promptVersion: v.string(),
        brandVoiceVersion: v.string(),
        sourceSnapshotHash: v.string(),
        sourceSnapshot: v.any(),
        normalizedFacts: v.any(),
        generatedDraft: v.optional(v.any()),
        finalDescription: v.optional(v.string()),
        rawModelResponse: v.optional(v.string()),
        validation: v.any(),
        fallbackUsed: v.boolean(),
        fallbackReason: v.optional(v.string()),
        adminEdited: v.boolean(),
        adminEditDistance: v.optional(v.number()),
        warnings: v.array(v.string()),
        createdBy: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
        debugExpiresAt: v.optional(v.number()),
        compactedAt: v.optional(v.number()),
    })
        .index("by_product", ["productId"])
        .index("by_import_session", ["importSessionId"])
        .index("by_createdAt", ["createdAt"])
        .index("by_debug_expiry", ["debugExpiresAt"]),

    pricingAudits: defineTable({
        productId: v.id("products"),
        stage: v.union(
            v.literal("source_estimate"),
            v.literal("cj_catalog_confirmed"),
            v.literal("cj_freight_confirmed"),
            v.literal("manual_locked"),
            v.literal("order_reconciled")
        ),
        sourcePriceUsd: v.optional(v.number()),
        collection: v.optional(v.string()),
        productCost: v.number(),
        shippingCost: v.number(),
        serviceFee: v.number(),
        taxesFee: v.number(),
        clearanceFee: v.number(),
        remoteFee: v.number(),
        otherFee: v.number(),
        landedCost: v.number(),
        retailMultiplier: v.number(),
        suggestedRetailPrice: v.number(),
        previousPrice: v.optional(v.number()),
        appliedPrice: v.optional(v.number()),
        adminPriceLocked: v.boolean(),
        pricingWarnings: v.array(v.string()),
        cjProductId: v.optional(v.string()),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        cjLogisticsName: v.optional(v.string()),
        cjRawResponse: v.optional(v.any()),
        createdAt: v.number(),
    })
        .index("by_product", ["productId"])
        .index("by_createdAt", ["createdAt"]),

    // Blog posts table
    blogPosts: defineTable({
        title: v.string(),
        excerpt: v.string(),
        content: v.string(),
        date: v.string(),
        image: v.string(),
        category: v.string(),
        status: v.union(v.literal("published"), v.literal("draft")),
    }).index("by_status", ["status"]),

    // Site content - single document for nav, home, story, collections
    siteContent: defineTable({
        navLinks: v.array(v.any()), // NavLink[]
        collections: v.array(v.any()), // CollectionConfig[]
        home: v.any(), // HomePageContent
        story: v.any(), // StoryPageContent
    }),

    // Custom pages
    customPages: defineTable({
        title: v.string(),
        slug: v.string(),
        sections: v.array(v.any()), // PageSection[]
    }).index("by_slug", ["slug"]),

    // Newsletter subscribers
    subscribers: defineTable({
        email: v.string(),
        firstName: v.optional(v.string()),
        dateSubscribed: v.string(),
        status: v.union(v.literal("active"), v.literal("unsubscribed")),
        tags: v.array(v.string()),
        openRate: v.number(),
    }).index("by_email", ["email"]),

    // Email campaigns
    campaigns: defineTable({
        subject: v.string(),
        previewText: v.string(),
        content: v.string(),
        status: v.union(v.literal("draft"), v.literal("scheduled"), v.literal("sent")),
        sentDate: v.optional(v.string()),
        type: v.union(v.literal("newsletter"), v.literal("promotion"), v.literal("automation")),
        stats: v.object({
            sent: v.number(),
            opened: v.number(),
            clicked: v.number(),
        }),
    }),

    // Orders
    orders: defineTable({
        stripeSessionId: v.string(),
        stripePaymentIntentId: v.optional(v.string()),
        customerEmail: v.string(),
        customerName: v.optional(v.string()),
        customerPhone: v.optional(v.string()), // Required by CJ API
        items: v.array(v.object({
            productId: v.string(),
            variantId: v.optional(v.string()),
            variantName: v.optional(v.string()),
            name: v.string(),
            price: v.number(),
            quantity: v.number(),
            image: v.optional(v.string()),
            // CJ Dropshipping product mapping
            cjVariantId: v.optional(v.string()), // CJ variant ID (vid)
            cjSku: v.optional(v.string()), // CJ product SKU
            cjProductCost: v.optional(v.number()),
            cjEstimatedLandedCost: v.optional(v.number()),
        })),
        subtotal: v.number(),
        shipping: v.optional(v.number()),
        tax: v.optional(v.number()),
        total: v.number(),
        currency: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("paid"),
            v.literal("processing"),
            v.literal("shipped"),
            v.literal("delivered"),
            v.literal("cancelled")
        ),
        shippingAddress: v.optional(v.object({
            line1: v.string(),
            line2: v.optional(v.string()),
            city: v.string(),
            state: v.optional(v.string()),
            postalCode: v.string(),
            country: v.string(),
        })),
        // CJ Dropshipping fulfillment fields
        cjOrderId: v.optional(v.string()), // CJ's order reference ID
        cjStatus: v.optional(v.union(
            v.literal("pending"), // Not yet sent to CJ
            v.literal("sending"), // Being sent to CJ
            v.literal("confirmed"), // CJ accepted order
            v.literal("processing"), // CJ is fulfilling
            v.literal("shipped"), // CJ shipped the order
            v.literal("delivered"), // Delivered to customer
            v.literal("failed"), // CJ order creation failed
            v.literal("cancelled") // Order cancelled at CJ
        )),
        cjError: v.optional(v.string()), // Error message if CJ order fails
        cjLastSyncAt: v.optional(v.string()), // Last time we synced with CJ
        cjAutomationMode: v.optional(v.union(
            v.literal("create_only"),
            v.literal("manual_payment"),
            v.literal("balance_payment")
        )),
        cjFulfillmentStep: v.optional(v.union(
            v.literal("not_started"),
            v.literal("creating_order"),
            v.literal("order_created"),
            v.literal("adding_to_cart"),
            v.literal("cart_added"),
            v.literal("confirming_cart"),
            v.literal("cart_confirmed"),
            v.literal("generating_payment_order"),
            v.literal("payment_order_generated"),
            v.literal("paying_balance"),
            v.literal("payment_submitted"),
            v.literal("paid"),
            v.literal("processing"),
            v.literal("failed")
        )),
        cjFulfillmentLastStepAt: v.optional(v.string()),
        cjFulfillmentRetryCount: v.optional(v.number()),
        cjFulfillmentIdempotencyKey: v.optional(v.string()),
        cjPaymentStatus: v.optional(v.union(
            v.literal("not_started"),
            v.literal("manual_payment_required"),
            v.literal("payment_order_generated"),
            v.literal("balance_payment_ready"),
            v.literal("balance_payment_attempting"),
            v.literal("balance_payment_submitted"),
            v.literal("paid"),
            v.literal("failed"),
            v.literal("skipped")
        )),
        cjParentOrderId: v.optional(v.string()),
        cjShipmentOrderId: v.optional(v.string()),
        cjPayId: v.optional(v.string()),
        cjPaymentUrl: v.optional(v.string()),
        cjPaymentAmount: v.optional(v.number()),
        cjAutoPaymentAttemptedAt: v.optional(v.string()),
        cjAutoPaymentError: v.optional(v.string()),
        cjQuotedProductCost: v.optional(v.number()),
        cjQuotedShippingCost: v.optional(v.number()),
        cjQuotedTaxesFee: v.optional(v.number()),
        cjQuotedClearanceFee: v.optional(v.number()),
        cjQuotedLandedCost: v.optional(v.number()),
        cjQuotedLogisticsName: v.optional(v.string()),
        cjCustomerShippingCollected: v.optional(v.number()),
        cjEstimatedProfit: v.optional(v.number()),
        cjPricingWarnings: v.optional(v.array(v.string())),
        cjPricingUpdatedAt: v.optional(v.string()),
        cjRawPricingResponse: v.optional(v.any()),
        // Tracking information
        trackingNumber: v.optional(v.string()),
        trackingUrl: v.optional(v.string()),
        carrier: v.optional(v.string()), // Shipping carrier name
        cjTrackingStatus: v.optional(v.string()),
        trackingNotificationSentFor: v.optional(v.string()),
        trackingNotificationSentAt: v.optional(v.string()),
        // CJ order split tracking — when CJ splits into multiple shipments
        splitOrders: v.optional(v.array(v.object({
            cjOrderId: v.string(),
            orderStatus: v.optional(v.number()),
            trackingNumber: v.optional(v.string()),
            trackingUrl: v.optional(v.string()),
            carrier: v.optional(v.string()),
            splitAt: v.string(),
        }))),
        shippedAt: v.optional(v.string()), // When the order was shipped
        estimatedDelivery: v.optional(v.string()), // Estimated delivery date
        createdAt: v.string(),
        updatedAt: v.string(),
    }).index("by_session", ["stripeSessionId"])
        .index("by_email", ["customerEmail"])
        .index("by_cj_status", ["cjStatus"])
        .index("by_cj_order_id", ["cjOrderId"])
        .index("by_cj_payment_status", ["cjPaymentStatus"])
        .index("by_cj_fulfillment_step", ["cjFulfillmentStep"]),

    // CJ fulfillment audit log - reviewed risks and internal operator notes
    cjFulfillmentAudits: defineTable({
        actionType: v.union(
            v.literal("risk_reviewed"),
            v.literal("note_added")
        ),
        riskKey: v.optional(v.string()),
        riskType: v.optional(v.union(
            v.literal("automation"),
            v.literal("mapping"),
            v.literal("shipping"),
            v.literal("fulfillment"),
            v.literal("payment"),
            v.literal("tracking"),
            v.literal("inventory"),
            v.literal("notification"),
            v.literal("refund"),
            v.literal("pricing")
        )),
        severity: v.optional(v.union(
            v.literal("critical"),
            v.literal("warning"),
            v.literal("info")
        )),
        title: v.optional(v.string()),
        orderId: v.optional(v.id("orders")),
        productId: v.optional(v.id("products")),
        note: v.optional(v.string()),
        actorEmail: v.string(),
        createdAt: v.string(),
        reviewedAt: v.optional(v.string()),
    }).index("by_order", ["orderId"])
        .index("by_product", ["productId"])
        .index("by_risk_key", ["riskKey"])
        .index("by_action_type", ["actionType"])
        .index("by_created_at", ["createdAt"]),

    // AliExpress product cache - stores fetched products for faster access
    aliexpressCache: defineTable({
        aliexpressId: v.string(), // Original AliExpress product ID
        name: v.string(),
        originalPrice: v.number(),
        salePrice: v.number(),
        images: v.array(v.string()),
        category: v.string(),
        description: v.optional(v.string()),
        averageRating: v.number(),
        reviewCount: v.number(),
        productUrl: v.optional(v.string()),
        sellerName: v.optional(v.string()),
        shippingInfo: v.object({
            freeShipping: v.boolean(),
            estimatedDays: v.optional(v.string()),
            cost: v.optional(v.number()),
        }),
        inStock: v.boolean(),
        lastFetched: v.string(), // ISO timestamp
        searchQuery: v.optional(v.string()), // Query that found this product
    }).index("by_aliexpress_id", ["aliexpressId"])
        .index("by_search_query", ["searchQuery"]),

    // Import history - tracks what was imported and when
    importHistory: defineTable({
        aliexpressId: v.string(), // Original AliExpress ID
        importedProductId: v.id("products"), // Reference to imported product
        originalName: v.string(),
        importedName: v.string(),
        originalPrice: v.number(),
        importedPrice: v.number(),
        markup: v.number(), // Percentage or fixed amount
        markupType: v.union(v.literal("percentage"), v.literal("fixed")),
        collection: v.string(),
        aiEnhanced: v.boolean(),
        importedAt: v.string(), // ISO timestamp
        importedBy: v.optional(v.string()), // Future: user ID
    }).index("by_aliexpress_id", ["aliexpressId"])
        .index("by_imported_at", ["importedAt"])
        .index("by_collection", ["collection"]),

    // User preferences - stores pricing rules and settings
    adminPreferences: defineTable({
        key: v.string(), // e.g., "pricingRule", "defaultCollection"
        value: v.any(),
        updatedAt: v.string(),
    }).index("by_key", ["key"]),

    // Durable product-import pipeline. Jobs continue running when the admin
    // closes a mobile browser and can be resumed from any signed-in device.
    batchImportJobs: defineTable({
        status: v.union(v.literal("processing"), v.literal("ready"), v.literal("completed"), v.literal("cancelled")),
        total: v.number(),
        fetchConcurrency: v.number(),
        reviewBatchSize: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
        expiresAt: v.optional(v.number()),
    }).index("by_updated_at", ["updatedAt"])
        .index("by_status", ["status", "updatedAt"])
        .index("by_expiry", ["expiresAt"]),

    batchImportItems: defineTable({
        jobId: v.id("batchImportJobs"),
        position: v.number(),
        inputUrl: v.string(),
        normalizedUrl: v.string(),
        resolvedUrl: v.optional(v.string()),
        status: v.union(
            v.literal("pending"),
            v.literal("fetching"),
            v.literal("ready"),
            v.literal("error"),
            v.literal("imported"),
            v.literal("skipped")
        ),
        stage: v.string(),
        result: v.optional(v.any()),
        error: v.optional(v.string()),
        attempts: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
        resultVersion: v.optional(v.number()),
        resultBytes: v.optional(v.number()),
        expiresAt: v.optional(v.number()),
    }).index("by_job", ["jobId"])
        .index("by_job_status", ["jobId", "status"])
        .index("by_expiry", ["expiresAt"]),

    // Compact review payloads are separated from hot item status records so a
    // progress subscription does not repeatedly read/send provider-sized data.
    batchImportPayloads: defineTable({
        itemId: v.id("batchImportItems"),
        jobId: v.id("batchImportJobs"),
        version: v.number(),
        byteLength: v.number(),
        result: v.any(),
        createdAt: v.number(),
        expiresAt: v.number(),
    }).index("by_item", ["itemId"])
        .index("by_job", ["jobId"])
        .index("by_expiry", ["expiresAt"]),

    // CJ Webhook Log - tracks processed messageIds to prevent duplicate processing
    cjWebhookLog: defineTable({
        messageId: v.string(),
        type: v.string(), // ORDER, LOGISTIC, PRODUCT, VARIANT
        processedAt: v.string(), // ISO timestamp
        status: v.optional(v.union(
            v.literal("processing"),
            v.literal("processed"),
            v.literal("retryable"),
            v.literal("failed")
        )),
        claimedAt: v.optional(v.string()),
        claimToken: v.optional(v.string()),
        completedAt: v.optional(v.string()),
        lastError: v.optional(v.string()),
        attempts: v.optional(v.number()),
        payload: v.optional(v.any()),
        expiresAt: v.optional(v.number()),
    }).index("by_message_id", ["messageId"])
        .index("by_status_claimed_at", { fields: ["status", "claimedAt"], staged: true })
        .index("by_expiry", ["expiresAt"]),

    cjSourcingJobs: defineTable({
        productId: v.id("products"),
        state: cjSourcingStateValidator,
        generation: v.number(),
        activeAttemptId: v.optional(v.id("cjSourcingAttempts")),
        currentSourcingId: v.optional(v.string()),
        cjProductId: v.optional(v.string()),
        providerSourceStatus: v.optional(v.string()),
        providerStatusText: v.optional(v.string()),
        sourceSnapshot: v.object({
            productName: v.string(),
            productImage: v.optional(v.string()),
            productUrl: v.string(),
            remark: v.optional(v.string()),
            price: v.optional(v.number()),
        }),
        sourceSnapshotHash: v.string(),
        attemptCount: v.number(),
        transientFailureCount: v.number(),
        nextAttemptAt: v.optional(v.number()),
        leaseToken: v.optional(v.string()),
        leaseExpiresAt: v.optional(v.number()),
        lastPolledAt: v.optional(v.number()),
        submittedAt: v.optional(v.number()),
        sourcedAt: v.optional(v.number()),
        rejectedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        lastErrorCode: v.optional(v.string()),
        lastErrorMessage: v.optional(v.string()),
        manualReviewReason: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
        version: v.number(),
    }).index("by_product_id", ["productId"])
        .index("by_state_next_attempt", ["state", "nextAttemptAt"])
        .index("by_state_lease_expiry", ["state", "leaseExpiresAt"])
        .index("by_sourcing_id", ["currentSourcingId"])
        .index("by_cj_product_id", ["cjProductId"])
        .index("by_updated_at", ["updatedAt"]),

    cjSourcingAttempts: defineTable({
        jobId: v.id("cjSourcingJobs"),
        productId: v.id("products"),
        generation: v.number(),
        attemptKey: v.string(),
        thirdProductId: v.string(),
        state: v.union(
            v.literal("prepared"),
            v.literal("sending"),
            v.literal("accepted"),
            v.literal("ambiguous"),
            v.literal("failed_terminal"),
            v.literal("superseded"),
            v.literal("completed"),
        ),
        payloadHash: v.string(),
        payloadSnapshot: v.object({
            productName: v.string(),
            productImage: v.string(),
            productUrl: v.string(),
            remark: v.optional(v.string()),
            price: v.optional(v.string()),
            thirdProductId: v.string(),
        }),
        cjSourcingId: v.optional(v.string()),
        requestStartedAt: v.optional(v.number()),
        responseReceivedAt: v.optional(v.number()),
        acceptedAt: v.optional(v.number()),
        httpStatus: v.optional(v.number()),
        cjCode: v.optional(v.string()),
        providerRequestId: v.optional(v.string()),
        errorCode: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        reconciliationDeadlineAt: v.optional(v.number()),
        createdBy: v.union(v.literal("import"), v.literal("cron"), v.literal("admin"), v.literal("migration")),
        adminUserId: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index("by_job_generation", ["jobId", "generation"])
        .index("by_attempt_key", ["attemptKey"])
        .index("by_third_product_id", ["thirdProductId"])
        .index("by_sourcing_id", ["cjSourcingId"])
        .index("by_state_reconciliation_deadline", ["state", "reconciliationDeadlineAt"]),

    cjApiControl: defineTable({
        key: v.string(),
        nextRequestSlotAt: v.number(),
        sourceQuotaBlockedUntil: v.optional(v.number()),
        sourceQuotaReason: v.optional(v.string()),
        circuitState: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")),
        circuitOpenedAt: v.optional(v.number()),
        consecutiveFailures: v.number(),
        tokenRefreshLeaseToken: v.optional(v.string()),
        tokenRefreshLeaseExpiresAt: v.optional(v.number()),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),

    cjWorkerRuns: defineTable({
        runId: v.string(),
        type: v.string(),
        startedAt: v.number(),
        completedAt: v.optional(v.number()),
        status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
        claimed: v.number(),
        processed: v.number(),
        succeeded: v.number(),
        deferred: v.number(),
        failed: v.number(),
        deadLettered: v.number(),
        remaining: v.optional(v.number()),
        stoppedReason: v.optional(v.string()),
        oldestQueueAgeMs: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        buildRevision: v.optional(v.string()),
        expiresAt: v.number(),
    }).index("by_created_at", ["startedAt"])
        .index("by_expiry", ["expiresAt"]),

    cjInventoryPollRuns: defineTable({
        source: v.union(v.literal("manual"), v.literal("checkout"), v.literal("cron"), v.literal("webhook")),
        eligible: v.number(),
        deferredFresh: v.number(),
        checked: v.number(),
        updated: v.number(),
        errors: v.number(),
        providerTokenRequested: v.boolean(),
        durationMs: v.number(),
        createdAt: v.number(),
        expiresAt: v.number(),
    }).index("by_created_at", ["createdAt"])
        .index("by_expiry", ["expiresAt"]),

    // Short-lived anonymous storefront AI quota/deduplication records. The
    // client token is random browser state, not customer identity or content.
    aiRequestUsage: defineTable({
        clientToken: v.string(),
        requestHash: v.string(),
        operation: v.string(),
        status: v.union(v.literal("claimed"), v.literal("completed"), v.literal("failed")),
        response: v.optional(v.string()),
        createdAt: v.number(),
        expiresAt: v.number(),
    }).index("by_client_created", ["clientToken", "createdAt"])
        .index("by_operation_created", ["operation", "createdAt"])
        .index("by_request_hash", ["requestHash"])
        .index("by_expiry", ["expiresAt"]),

    // CJ API Tokens - stores access and refresh tokens persistently
    // Matches CJ API response structure from /authentication/getAccessToken
    cjTokens: defineTable({
        openId: v.optional(v.string()), // CJ Open ID (Long 20 in their docs)
        accessToken: v.string(),
        accessTokenExpiryDate: v.string(), // CJ's expiry date string
        refreshToken: v.string(),
        refreshTokenExpiryDate: v.string(), // CJ's expiry date string
        createDate: v.optional(v.string()), // CJ's create date
        updatedAt: v.string(), // Our update timestamp
    }),
});

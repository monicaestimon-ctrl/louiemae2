# 02. Domain model, configuration, flags, error codes and formulas

All new tables go in a new file, `convex/v2Tables.ts`, which exports `v2Tables`. `convex/schema.ts` spreads that object the same way it spreads `commerceTables` and `holmTables`. Table names use a short domain prefix: `cat` (catalog), `dlv` (delivery), `ord` (order), `prg` (program), `ldg` (ledger) and `sys` (system). Every table gets a `createdAt` field, and revisions also get `createdBy`. This file is the reference. Each step in 03 lists the tables it adds.

## 1. Entity map (v2 PDF §21 → Convex tables)

| PDF logical entity | Convex table(s) | Step | Notes |
| --- | --- | --- | --- |
| Identity | `users` (Convex Auth), `holmProfiles` (existing) | S05 | One login per person |
| Organization | `prgOrganizations` | S05 | A verified business |
| OrganizationMember | `prgOrganizationMembers` | S05 | role: `owner`, `purchasing`, `readonly` |
| ProgramMembership | `prgMemberships` | S05/S24 | program: `creator`, `trade` |
| TermsAcceptance | `prgTermsVersions`, `prgTermsAcceptances` | S05/S24 | |
| Partner beneficiary | `prgBeneficiaries` | S05 | Owns the payout identity and the shared tier |
| Supplier | `catSuppliers` | S04 | `zuo`, `ashcroft`, `cj`, `owner_managed:<id>` |
| SupplierPolicyVersion | `catSupplierPolicies` | S04/S13 | MAP, trade, coupon, private label, media, returns |
| SourceObservation | `catSourceObservations` | S04/S10 | Immutable |
| Product | `commerceProducts` (existing) and `catProductMeta` | S04 | Category, names, slug, redirects |
| Variant | `catVariants` | S04 | Unique on (supplier, supplierSku, packId) |
| Carton | `catCartons` | S04/S11 | Child of a variant |
| Warehouse | `catWarehouses` | S04 | Origin ZIP, for example 95206 |
| CostRevision | `catCostRevisions` | S04/S10 | |
| PriceRevision | `catPriceRevisions` | S04/S12 | Per channel: retail and trade |
| MarginPolicy | `sysConfig` (kind `marginPolicy`) and `catVariantPolicies` | S02/S12 | |
| CommissionScheduleVersion | `sysConfig` (kind `commissionSchedule`) and `prgSkuCommissionExceptions` | S28 | |
| ChannelListing | `commerceListings` (existing) and `catListingState` | S15 | |
| RetailMapping | `catRetailMappings` | S26 | HOLM variant → Louie Mae retail variant |
| MediaAsset | `catMediaAssets` | S14 | |
| ImportBatch | `catImportBatches`, `catImportRecords` | S09 | |
| DeliveryRuleVersion | `sysConfig` (kind `deliveryRule`, `carrierRule`) | S16/S17 | |
| DeliveryEstimate | `dlvEstimates` | S18 | |
| QuoteRevision | `commerceProjects` (existing, revisioned) and `ordQuoteVersions` | S20 | Accepted versions are immutable |
| Cart | `ordCarts` | S18 | Server cart revision |
| OrderSnapshot | `ordCheckoutIntents`, `ordOrders` (parent), `ordOrderLines` | S19 | |
| SupplierOrder | `ordSupplierOrders`, `ordAllocations` | S21 | |
| Shipment | `ordShipments`, `ordShipmentItems` | S21 | |
| ReferralClick | `prgReferralLinks`, `prgReferralClicks` | S26/S27 | |
| AttributionSnapshot | `prgAttributionSnapshots` | S27 | |
| TierSnapshot | `prgTierSnapshots` | S28 | |
| CommissionEvent | `ldgCommissionEvents`, `ldgObligations` (projection) | S29 | |
| CreditEvent | `ldgCreditEvents`, `ldgCreditAccounts` (projection) | S31 | |
| PayoutRun | `ldgPayoutRuns` | S30 | |
| TransferAttempt | `ldgTransferAttempts`, `ldgBankPayouts` | S30 | |
| AuditEvent | `sysAuditEvents` | S03 | |
| (support) | `sysIdempotencyKeys`, `sysPaymentEvents`, `sysJobs`, `sysNotifications`, `sysLocks` | S03/S19/S36 | |

## 2. Shared validators (`convex/v2Validators.ts`)

```ts
export const cents = v.number();            // integer, validated with assertCents()
export const bps = v.number();              // integer basis points, 0..10000
export const currency = v.literal('USD');   // widen only when a verified conversion path exists
export const decimalString = v.string();    // e.g. "115.0000" with scale kept in a sibling field
export const commissionCategory = v.union(v.literal('furniture'), v.literal('decor'), v.literal('clothing'), v.literal('review_required'));
export const availability = v.union(v.literal('in_stock'), v.literal('out_of_stock'), v.literal('discontinued'), v.literal('preorder_approved'), v.literal('unknown'));
export const publicationStage = v.union(
  v.literal('imported_draft'), v.literal('evidence_review'), v.literal('economics_review'),
  v.literal('content_review'), v.literal('ready'), v.literal('published'), v.literal('archived'));
export const holdReason = v.union(
  v.literal('COST_MISSING'), v.literal('COST_STALE'), v.literal('COST_CONFLICT'), v.literal('COST_IMPLAUSIBLE'),
  v.literal('MAP_MISSING'), v.literal('MAP_ZERO'), v.literal('MAP_POLICY_DERIVED'), v.literal('MAP_FLOOR_UNAPPROVED'),
  v.literal('CARTON_MISSING'), v.literal('STOCK_UNVERIFIED'), v.literal('SOURCE_ABSENT'), v.literal('METHOD_CHANGED'),
  v.literal('MEDIA_MISSING'), v.literal('MEDIA_RIGHTS'), v.literal('NAME_COLLISION'), v.literal('CATEGORY_REVIEW'),
  v.literal('MARGIN_BELOW_POLICY'), v.literal('COMMISSION_UNQUALIFIED'), v.literal('MAPPING_MISSING'),
  v.literal('DELIVERY_UNSUPPORTED'), v.literal('MANUAL'));
export const configStatus = v.union(v.literal('proposed'), v.literal('approved'), v.literal('retired'));
export const revisionMeta = { createdAt: v.number(), createdBy: v.string(), effectiveFrom: v.number(), effectiveTo: v.optional(v.number()), source: v.string() };
```

## 3. Table definitions

The fields listed are required unless marked `?` (which means `v.optional`). Indexes are listed after `idx:`.

### 3.1 System (S02, S03)

- **sysConfig**: `kind` (`marginPolicy` | `pricingAssumptions` | `roundingPolicy` | `freshnessPolicy` | `deliveryLadder` | `deliveryRule` | `carrierRule` | `commissionSchedule` | `tierPolicy` | `payoutSchedule` | `payoutReadinessPolicy` | `creditPolicy` | `tradeDiscountSchedule` | `projectDiscountPolicy` | `promotionPolicy` | `estimatePolicy` | `attributionPolicy` | `returnPolicy` | `serviceLevel`), `key` (a stable name such as `zuo-standard-20`), `version` (an integer that only goes up), `status`, `value` (`v.any()`, validated by a typed parser per kind in `lib/config/*.ts`), `approvedBy?`, `approvedAt?`, `note`, plus `revisionMeta`. idx: `by_kind_key_version`, `by_kind_status`.
- **sysIdempotencyKeys**: `key` (unique), `scope`, `resultRef?`, `createdAt`. idx: `by_key`.
- **sysAuditEvents**: `actor` (a user id or `system:<job>`), `action`, `entityTable`, `entityId`, `before?`, `after?`, `reason?`, `requestId?`, `at`. idx: `by_entity`, `by_actor_at`, `by_action_at`. Never patched or deleted.
- **sysPaymentEvents**: `provider` (`stripe`), `eventId` (unique), `type`, `account?` (the Connect account), `livemode`, `payloadHash`, `receivedAt`, `status` (`received` | `processed` | `failed` | `ignored`), `attempts`, `error?`, `processedAt?`. idx: `by_event`, `by_status_received`.
- **sysLocks**: `name` (unique, for example `tier:<beneficiaryId>` or `payoutRun:2026-12`), `holder`, `expiresAt`. idx: `by_name`.
- **sysJobs**: `kind`, `dedupeKey` (unique), `runAt`, `status`, `attempts`, `lastError?`, `payload`. idx: `by_dedupe`, `by_status_runAt`.
- **sysNotifications**: `dedupeKey` (unique), `audience` (`customer` | `partner` | `admin`), `category` (`transactional` | `marketing`), `template`, `to`, `payload`, `status`, `attempts`, `sentAt?`. idx: `by_dedupe`, `by_status`.

### 3.2 Catalog (S04)

- **catSuppliers**: `code` (`zuo` | `ashcroft` | `cj` | …), `name`, `publicAttributionAllowed` (bool, from rights evidence), `fulfillmentRoute` (`manual_dealer_zuo` | `manual_dealer_ashcroft` | `cj_auto` | `owner_managed`), `freshness` (a ref to `sysConfig` `freshnessPolicy`), `createdAt`. idx: `by_code`.
- **catSupplierPolicies**: `supplierId`, `kind` (`map` | `trade` | `coupon` | `private_label` | `media` | `returns` | `promotion_stacking`), `summary`, `evidenceRefs` (array of string), `scope` (`{ skus?: string[]; all?: boolean }`), `status` (`documented` | `unverified` | `denied`), plus `revisionMeta`. idx: `by_supplier_kind`.
- **catWarehouses**: `supplierId`, `code`, `originZip` (string), `state`, `active`. idx: `by_supplier`.
- **catProductMeta**: `productId` (`commerceProducts`), `supplierId`, `commissionCategory`, `navCategory` (string), `louieMaeName`, `slug`, `slugHistory` (array of `{ slug, until }`), `supplierName` (the original, always kept), `supplierProductRef`, `attributionText?`, `assemblyAssetId?`, `holds` (array of `holdReason`), `stage` (`publicationStage`), `createdAt`, `updatedAt`. idx: `by_product`, `by_slug`, `by_stage`, `by_supplier`.
- **catVariants**: `productId`, `supplierId`, `supplierSku`, `packId` (`'1'` by default), `optionKey` (normalized material, color and size), `supplierVariantName`, `louieMaeVariantName`, `material?`, `color?`, `size?`, `piecesPerPack` (integer ≥ 1), `orderMinimumPacks`, `orderIncrementPacks`, `warehouseId?`, `availability`, `availabilityObservedAt?`, `fulfillmentRoute`, `marginPolicyKey?`, `currentCostRevisionId?`, `currentPriceRevisionId?`, `holds` (array of `holdReason`), `legacyVariantId?` (the matching `draft.variants[].id`), `createdAt`, `updatedAt`. idx: `by_identity` [`supplierId`, `supplierSku`, `packId`] (unique by code check), `by_product`, `by_availability`.
- **catCartons**: `variantId`, `index`, `cartonsPerPack`, `lengthMm`, `widthMm`, `heightMm`, `grossWeightG`, `netWeightG?`, `supplierMethod` (`ground` | `ltl` | `unknown`), `sourceObservationId`, `createdAt`. idx: `by_variant`. Dimensions are stored as integer millimetres and grams, converted from the source units with the conversion recorded in the observation.
- **catSourceObservations**: `supplierId`, `variantId?`, `field` (`wholesale` | `map` | `stock` | `carton` | `method` | `image` | `name` | …), `extractedValue` (string), `unit?`, `sourceFile?`, `sourceUrl?`, `supplierRevision?`, `observedAt`, `effectiveFrom?`, `effectiveTo?`, `contentHash`, `verifier`, `confidence` (`confirmed` | `corroborated` | `policy_derived` | `unverified` | `conflict`), `importBatchId?`, `createdAt`. idx: `by_variant_field_observed`, `by_hash`. **Immutable.** A new observation creates a new row.
- **catCostRevisions**: `variantId`, `wholesaleMinor` (cents per **piece**), `wholesalePrecise` (decimal string), `currency`, `fxRate?` (decimal string), `fxObservedAt?`, `dutiesMinor` (cents or null), `dutiesConfirmedZero` (bool), `inboundFreightMinor` (cents or null), `inboundConfirmedZero`, `supplierFeesMinor` (cents or null), `feesConfirmedZero`, `mapMinor` (cents per **selling unit** or null), `mapUnitBasis` (`piece` | `pack`), `mapSource` (`explicit_sku` | `policy_derived` | `none`), `mapPolicyVersion?`, `mapApplicability` (`applies` | `not_applicable` | `unknown`), `costSource`, `verifiedAt`, `observationIds`, plus `revisionMeta`. idx: `by_variant_effective`.
- **catPriceRevisions**: `variantId`, `channel` (`retail` | `trade`), `packPriceMinor` (the authoritative sellable-pack price), `piecePriceMinorInfo` (informational only), `marginPolicyKey`, `marginPolicyVersion`, `roundingPolicyVersion`, `scenarioResultId`, `approvedBy?`, `approvedAt?`, `status` (`candidate` | `approved` | `superseded`), `origin` (`import_approved` | `engine` | `manual`), plus `revisionMeta`. idx: `by_variant_channel_effective`.
- **catVariantPolicies**: `variantId`, `policyKey` (for example `zuo-standard-20`, `zuo-approved-5`, `zuo-legacy-18`, `zuo-map-floor-pending`), `cohort` (`approved_306` | `map_135` | `original_296` | `reconciled_66` | `unpriced_62` | `excluded_226` | `other`), `documentRef?`, `createdAt`. idx: `by_variant`, `by_cohort`.
- **catScenarioResults**: `variantId`, `inputsHash`, `scenarios` (an array of `{ name, priceMinor, contributionMinor, contributionBps, passes, reason? }`), `minimumRetailMinor`, `computedAt`, `engineVersion`. idx: `by_variant_computed`.
- **catMediaAssets**: `productId`, `variantId?`, `role` (`hero` | `gallery` | `assembly` | `swatch`), `storageId`, `derivatives` (an array of `{ width, storageId, format }`), `contentHash`, `mime`, `width`, `height`, `bytes`, `sourceUrl`, `rights` (`{ basis, evidenceRef, attributionRequired, privateOriginal }`), `altText`, `verifiedAgainst` (`{ sku, color?, pack? }`), `status` (`pending` | `verified` | `rejected`), `rejectReason?`, `createdAt`. idx: `by_product`, `by_hash`.
- **catImportBatches**: `supplierId`, `sourceKey` (a hash of the package), `files` (an array of `{ name, sha256, rows }`), `mode` (`dry_run` | `commit`), `status`, `summary` (counts: create, update, unchanged, rejected and per-reason), `codeRevision`, `schemaVersion`, `configVersions`, `startedBy`, `startedAt`, `finishedAt?`. idx: `by_source_mode`.
- **catImportRecords**: `batchId`, `sourceRowKey` (supplierSku plus packId), `action` (`create` | `update` | `unchanged` | `reject` | `hold`), `reasons` (array of string), `diff` (`v.any()`), `variantId?`, `conflicts?`. idx: `by_batch`, `by_batch_action`.
- **catRetailMappings**: `holmProductId`, `holmVariantId`, `retailProductId`, `retailVariantId`, `status` (`active` | `retired`), `redirectFrom?`, plus `revisionMeta`. idx: `by_holm_variant`, `by_retail_variant`.
- **catListingState**: `listingId` (`commerceListings`), `stage`, `holds`, `publishedRevision?`, `publishedAt?`, `unpublishedAt?`, `reason?`. idx: `by_listing`.
- **catHolds**: `variantId`, `reason`, `detail`, `openedAt`, `openedBy`, `resolvedAt?`, `resolvedBy?`, `resolution?`. idx: `by_variant_open`, `by_reason_open`. Replaces hard-coded SKU arrays.
- **catMarketReviews**: `variantId`, `observations` (an array of `{ retailer, url, observedAt, merchandiseMinor, inStock, deliveryMinor, serviceLevel, totalBeforeTaxMinor, zip, exactMatch }`), `medianDeliveredMinor?`, `flag` (`ok` | `above_median_10pct` | `above_lowest_material` | `evidence_limited`), `reviewer?`, `decision?`, `createdAt`. idx: `by_variant`.

### 3.3 Delivery, cart, quote and order (S07)

- **dlvEstimates**: `cartId?`, `cartRevision`, `channel` (`retail` | `trade`), `destination` (`{ zip, precision: 'zip' | 'full', addressHash? }`), `service` (`curbside` | …), `groups` (an array of `{ groupKey, supplierId, warehouseId, classification, freightMinor, accessorialsMinor, uncertaintyMinor, subsidyMinor, requirementMinor, quoteRequired, reasons }`), `status` (`ok` | `quote_required` | `unsupported`), `deliveryChargeMinor?`, `merchandiseMinor`, `discountMinor`, `creditMinor`, `taxMinor?`, `totalMinor?`, `expiresAt`, `cartHash`, `sourceVersionsHash`, `internal` (admin-only detail), `createdAt`. idx: `by_cart_revision`.
- **ordCarts**: `ownerKey` (a user id or an anonymous token hash), `revision`, `lines` (an array of `{ variantId, packs }`), `channel`, `updatedAt`. idx: `by_owner`.
- **ordQuoteVersions**: `projectId` (`commerceProjects`), `version`, `lines` (an array of `{ variantId, packs, unitPackMinor, discountMinor }`), `address`, `service`, `deliveryMinor`, `taxMinor`, `expiresAt`, `terms`, `status` (`draft` | `sent` | `accepted` | `superseded` | `expired`), `acceptedAt?`, `acceptedBy?`, `checks` (`{ map, margin, policy }`), `reservesInventory` (bool, false by default), `createdAt`. idx: `by_project_version`.
- **ordCheckoutIntents**: `idempotencyKey`, `estimateId`, `cartRevision`, `channel`, `buyer` (`{ userId?, email? }`), `lineSnapshot` (an array of `{ variantId, packs, unitPackMinor, discountMinor, creditMinor, commissionCategory, supplierId, costRevisionId, priceRevisionId }`), `deliveryMinor`, `taxMinor`, `totalMinor`, `attributionSnapshotId?`, `creditReservationRef?`, `inventoryReservationIds`, `stripeSessionId?`, `status` (`created` | `session_open` | `paid` | `expired` | `failed` | `exception`), `expiresAt`, `createdAt`. idx: `by_key`, `by_session`, `by_status_expires`.
- **ordInventoryReservations**: `variantId`, `packs`, `intentId`, `expiresAt`, `status` (`held` | `released` | `consumed`). idx: `by_variant_status`, `by_intent`.
- **ordOrders** (parent): `number`, `intentId`, `legacyOrderId?` (`orders`), `channel`, `buyerUserId?`, `email`, `shippingAddress`, `paymentIntentId`, `paidAt`, `totals` (`{ merchandise, discount, credit, delivery, tax, total }`), `splitKnown` (bool), `status` (`paid` | `partially_shipped` | `shipped` | `partially_delivered` | `delivered` | `cancelled` | `exception`), `createdAt`. idx: `by_number`, `by_payment`, `by_buyer`.
- **ordOrderLines**: `orderId`, `lineNo`, `variantId`, `packs`, `pieces`, `unitPackMinor`, `discountMinor`, `creditMinor`, `taxMinor`, `deliveryAllocMinor`, `commissionCategory`, `supplierId`, `costRevisionId`, `priceRevisionId`, `refundedMinor` (cumulative), `status`. idx: `by_order`.
- **ordSupplierOrders** (child): `orderId`, `supplierId`, `warehouseId?`, `service`, `route` (`manual_dealer_zuo` | `manual_dealer_ashcroft` | `edi_zuo` | `cj_auto` | `owner_managed`), `supplierPo?`, `acceptedCostMinor?`, `status` (`queued` | `submitted` | `acknowledged` | `partially_shipped` | `shipped` | `delivered` | `rejected` | `cancelled` | `exception`), `submission` (`{ mode: 'manual' | 'edi', handoffAt?, by?, payloadHash?, transmissionId?, ackState? }`), `exceptions`, `createdAt`, `updatedAt`. idx: `by_order`, `by_route_status`.
- **ordAllocations**: `orderLineId`, `supplierOrderId`, `pieces`, `packs`, `status`. idx: `by_line`, `by_supplier_order`. Every physical quantity belongs to exactly one allocation.
- **ordShipments**: `supplierOrderId`, `carrier?`, `trackingUrl?`, `trackingNumber?`, `shippedAt?`, `deliveredAt?`, `estimatedWindow?`, `status`. idx: `by_supplier_order`.
- **ordShipmentItems**: `shipmentId`, `allocationId`, `pieces`. idx: `by_shipment`, `by_allocation`.
- **ordPaidExceptions**: `intentId`, `paymentIntentId`, `reason` (`intent_expired` | `stock_failed` | `total_mismatch` | `policy_changed`), `evidence`, `status` (`open` | `resolved`), `resolution?`, `createdAt`. idx: `by_status`.
- **ordFreightActuals**: `supplierOrderId`, `estimatedMinor`, `actualMinor`, `invoiceRef`, `varianceMinor`, `createdAt`. idx: `by_supplier_order`.
- **ordReturns**: `orderLineId`, `policyVersion`, `reason`, `authorizedAt?`, `condition?`, `restockingMinor`, `refund` (`{ merchandise, tax, delivery, creditRestored, cash }`), `status`, `createdAt`. idx: `by_line`.

### 3.4 Programs (S05, S24–S28)

- **prgBeneficiaries**: `kind` (`person` | `business`), `userId?`, `organizationId?`, `displayName`, `payoutAccountRef?` (the Stripe account id), `payoutReadiness` (`not_started` | `pending` | `ready` | `restricted`), `taxReadiness` (`none` | `pending` | `approved`), `tierKey`, `tierSnapshotId?`, `legacyUserId` (the partner `users` id the legacy rows use), `refCode` (the legacy code is kept), `status` (`active` | `suspended` | `closed`), `createdAt`. idx: `by_user`, `by_org`, `by_refCode`, `by_legacy_user`.
- **prgOrganizations**: `legalName`, `displayName`, `ein4?`, `domain?`, `verification` (`pending` | `verified` | `rejected` | `needs_info`), `verifiedAt?`, `createdAt`. idx: `by_domain`.
- **prgOrganizationMembers**: `organizationId`, `userId`, `role` (`owner` | `purchasing` | `readonly`), `status`, `invitedBy?`, `createdAt`. idx: `by_org`, `by_user`.
- **prgMemberships**: `program` (`creator` | `trade`), `userId`, `organizationId?`, `beneficiaryId?`, `state`. For creators the states are `email_unverified`, `profile`, `terms`, `checks`, `active`, `review`, `suspended` and `closed`. For trade they are `applied`, `evidence`, `review`, `approved`, `rejected`, `needs_info`, `suspended` and `closed`. Also `referralActivated` (trade only), `termsAcceptanceId?`, `createdAt`, `updatedAt`. idx: `by_user_program`, `by_program_state`.
- **prgTermsVersions**: `program` (`creator` | `trade` | `referral` | `privacy`), `version`, `title`, `bodyHash`, `effectiveFrom`, `status`. idx: `by_program_version`.
- **prgTermsAcceptances**: `userId`, `termsVersionId`, `acceptedAt`, `ipHash?`, `userAgentHash?`. idx: `by_user`.
- **prgReferralLinks**: `linkId` (opaque, 12–16 base32 characters), `beneficiaryId`, `membershipSource` (`creator` | `trade`), `destination` (`{ kind: 'variant' | 'page'; retailVariantId?; path? }`), `channelTag`, `createdAt`, `revokedAt?`. idx: `by_link`, `by_beneficiary`.
- **prgReferralClicks**: `clickId` (opaque), `linkId?`, `legacyRefCode?`, `beneficiaryId`, `membershipSource`, `visitorKeyHash`, `userId?`, `consent` (`granted` | `denied` | `unknown`), `eligible` (bool), `ineligibleReason?` (`bot` | `self` | `internal` | `invalid_signature` | `beneficiary_inactive`), `termsVersionId`, `rateSnapshot` (`{ tierKey, scheduleVersion, perProduct?: { variantId, category, rateBps, exceptionVersion? } }`), `at`, `expiresAt` (`at + 30 × 86_400_000`). idx: `by_visitor_at`, `by_user_at`, `by_beneficiary_at`, `by_click`.
- **prgAttributionSnapshots**: `intentId`, `clickId`, `beneficiaryId`, `membershipSource`, `scope` (`basket`), `lines` (an array of `{ lineKey, variantId, category, protectedRateBps, currentRateBps, appliedRateBps, eligible, reason? }`), `tierKeyAtPurchase`, `scheduleVersion`, `termsVersionId`, `createdAt`. idx: `by_intent`.
- **prgTierSnapshots**: `beneficiaryId`, `tierKey`, `qualifyingMinor`, `windowStart`, `windowEnd` (exclusive), `watermarkEventId`, `computedAt`, `reason` (`daily` | `event` | `override`). idx: `by_beneficiary_computed`.
- **prgSkuCommissionExceptions**: `variantId`, `schedule` (an array of `{ tierKey, rateBps }` per category), `effectiveFrom`, `effectiveTo?`, `visibleNote`, `approvedBy`, `version`. idx: `by_variant_effective`.

### 3.5 Ledger (S06, S29–S31)

- **ldgObligations**: `beneficiaryId`, `source` (`retail_order` | `legacy_storefront` | `legacy_house_quote` | `adjustment`), `orderId?`, `orderLineId?`, `legacyCommissionId?` (`holmCommissions`), `category`, `rateBps`, `basisMinor`, `earnedMinor`, `reversedMinor`, `state` (`pending` | `cleared` | `held` | `reserved` | `transfer_submitted` | `transferred` | `void`), `clearsAt`, `payoutRunId?`, `transferAttemptId?`, `currency`, `createdAt`, `updatedAt`. idx: `by_beneficiary_state`, `by_state_clears`, `by_order_line`. This is a **projection** that only `applyCommissionEvent()` writes.
- **ldgCommissionEvents**: `eventKey` (unique idempotency key), `obligationId`, `type` (`earned` | `refund_reversal` | `dispute_hold` | `dispute_release` | `dispute_lost` | `cleared` | `reserved` | `reservation_released` | `transfer_submitted` | `transferred` | `transfer_failed` | `transfer_reversed` | `offset` | `manual_adjustment` | `opening_balance`), `amountMinor` (signed), `cumulativeRefundedMinor?`, `providerRef?`, `actor`, `reason?`, `at`. idx: `by_key`, `by_obligation_at`. **Append-only.**
- **ldgCreditAccounts**: `beneficiaryId` or `userId`, `availableMinor`, `reservedMinor`, `pendingAwardMinor`, `lifetimeIssuedMinor`, `updatedAt`. This is a projection.
- **ldgCreditEvents**: `eventKey` (unique), `accountId`, `type` (`award_pending` | `award_available` | `award_cancelled` | `reserved` | `reservation_released` | `redeemed` | `reversed` | `reinstated` | `offset_created` | `opening_balance`), `amountMinor`, `orderId?`, `intentId?`, `referredOrganizationId?`, `fundingReserveRef?`, `actor`, `reason?`, `at`. idx: `by_key`, `by_account_at`, `by_referred_org`.
- **ldgPayoutRuns**: `period` (`YYYY-MM`), `kind` (`monthly` | `manual`), `cutoffAt`, `startedAt`, `status` (`planning` | `reserving` | `submitting` | `reconciling` | `done` | `aborted`), `lockName`, `totals` (`{ eligibleMinor, reservedMinor, submittedMinor, transferredMinor, failedMinor, carriedMinor }`), `fundingCheck` (`{ availableMinor, at, ok }`), `createdBy`. idx: `by_period_kind`.
- **ldgTransferAttempts**: `payoutRunId`, `beneficiaryId`, `amountMinor`, `obligationIds`, `idempotencyKey`, `stripeTransferId?`, `state` (`created` | `submitted` | `succeeded` | `failed` | `uncertain` | `reversed`), `error?`, `submittedAt?`, `resolvedAt?`. idx: `by_run`, `by_key`, `by_state`.
- **ldgBankPayouts**: `accountId`, `stripePayoutId`, `amountMinor`, `arrivalDate?`, `status` (`pending` | `in_transit` | `paid` | `failed` | `canceled`), `failureCode?`, `observedAt`. idx: `by_account`, `by_payout`.

## 4. Error codes (`lib/errors.ts`)

Define `class CommerceError extends ConvexError<{ code, message, detail? }>`. Customer messages must be useful without exposing supplier economics, and `detail` goes only to admins.

| Code | Customer-safe message (example) | Raised by |
| --- | --- | --- |
| `COST_REVIEW_REQUIRED` | "This item isn't available to order yet." | publish, add-to-cart, estimate, checkout, link builder |
| `MAP_POLICY_REVIEW` | Same as above | publish, price change, promotion |
| `STOCK_UNAVAILABLE` | "This item is out of stock." / "…has been discontinued." | cart, estimate, checkout |
| `DELIVERY_QUOTE_REQUIRED` | "Delivery to this address needs a quote. Request a delivery quote." | estimate, checkout |
| `QUOTE_EXPIRED` | "Your delivery estimate expired. Please review the updated total." | checkout, quote accept |
| `PRICE_CHANGED` | "Your total changed. Please review before paying." | checkout |
| `TRADE_APPROVAL_REQUIRED` | "Trade pricing is available to approved trade members." | any trade price or quote endpoint |
| `REFERRAL_INELIGIBLE` | "Referral links aren't available for this item." | link builder |
| `PAYMENT_RECONCILIATION_REQUIRED` | Admin only | payout, refund, transfer |
| `POLICY_NOT_APPROVED` | Admin only | any gate that depends on proposed config |
| `FEATURE_DISABLED` | "This isn't available yet." | every flag gate |
| `INVALID_INPUT` | Field-level message | validators |
| `FORBIDDEN` | "You don't have access to this." | authorization |

## 5. Feature flags (`lib/flags.ts`, read on the server only)

Flags are Convex environment variables parsed with `flag(name) === 'true'`. Every flag defaults to **off**, and turning one on never bypasses a source, policy or economics gate.

| Flag | Controls | Legacy behaviour while off |
| --- | --- | --- |
| `CATALOG_PUBLICATION_V2_ENABLED` | Zuo and v2 publication through S15 gates | Existing `COMMERCE_PUBLISHING_ENABLED` path for Ashcroft and CJ |
| `RETAIL_ZUO_CHECKOUT_ENABLED` | Zuo lines in Louie Mae checkout | Ashcroft-only checkout (`retailLaunch`) |
| `TRADE_CHECKOUT_V2_ENABLED` | v2 trade quote and checkout | Existing House quote, invoice and payment |
| `DELIVERY_AUTOMATION_ENABLED` | Ladder estimates and automatic delivery charge | Ashcroft per-item fees and House quotes |
| `CREATOR_ENROLLMENT_V2_ENABLED` | v2 creator onboarding | Existing `holmPartners.join` |
| `RETAIL_LINK_GENERATION_V2_ENABLED` | Opaque retail links and mappings | Existing `?ref=` links |
| `COMMISSION_ACCRUAL_V2_ENABLED` | Ledger-v2 accrual and rate protection | Existing `holmCommissions` accrual |
| `CREDIT_V2_ENABLED` | Credit issuance and redemption v2 | Existing `holmCredit` |
| `PAYOUT_EXECUTION_ENABLED` | Any automatic transfer (v2 run). Must be off while `PARTNER_PAYOUTS_ENABLED` is on, and the reverse. | `PARTNER_PAYOUTS_ENABLED` run |
| `HOLM_TRADE_ONLY_ENABLED` | HOLM restricted to approved trade, with retail-quote commission off | Retail quotes allowed and earning commission |
| `ATTRIBUTION_V2_ENABLED` | Click-v2 and attribution snapshots | Existing `holmClicks` resolution |
| `EDI_ZUO_ENABLED` | Zuo EDI adapter. This stays off in this release. | Manual dealer queue |

Rule: a v2 accrual flag and its legacy path must never both create obligations for the same order. Each order records `accrualPath: 'legacy' | 'v2'` when it is paid.

## 6. Configuration registry (seed records, `scripts/seed-config.ts`)

Every value below is a seeded `sysConfig` record. **Status** shows how it is seeded. `approved` is used only where the v2 PDF or an earlier owner decision approves the value. Everything else is `proposed` and needs the named sign-off (05 §1).

| Key (kind) | Value | Status | Source |
| --- | --- | --- | --- |
| `zuo-standard-20` (marginPolicy) | `{ targetBps: 2000 }` | approved | §7 default model |
| `zuo-approved-5` (marginPolicy) | `{ targetBps: 500, cohort: 'approved_306', expandable: false }` | approved | §1, §7 |
| `zuo-legacy-18` (marginPolicy) | `{ targetBps: 1800, requiresDocumentRef: true }` | approved per SKU only with a document reference | §7 |
| `zuo-map-floor-pending` (marginPolicy) | `{ blocksAutomaticSale: true }` | approved (a hold) | §7, §26 |
| `zuo-pricing-assumptions-v1` (pricingAssumptions) | `{ supplierPaymentReserveBps: 300, handlingPerPieceMinor: 1000, processingBps: 300, returnsBps: 200, overheadBps: 500, allowanceBySize: { SMALL: 1500, MEDIUM: 2500, LARGE: 4000, OVERSIZE: 6000, LTL: 10000 }, unknownAllowance: null }` | approved as *provisional*. Finance replaces these with observed values. | §7 |
| `rounding-pack-up-cents-v1` (roundingPolicy) | `{ unit: 'pack', mode: 'ceil', toMinor: 1 }` | approved | §7 |
| `freshness-default-v1` (freshnessPolicy) | `{ stockSyncMaxHours: 24, checkoutSourceMaxHours: 24, costMapMaxDays: 7, recheckOnSupplierNotice: true }` | **proposed** | §6 |
| `delivery-ladder-v1` (deliveryLadder) | `{ tiersMinor: [4999,5999,6999,7999,8999,9999,10999,11999,12999,13999,14999,15999,16999,17999,18999,19999], quoteAboveMinor: 19999, minimumMinor: 4999, deliveryProcessingBps: 300 }` | approved ladder; processing rate **proposed** | §9, §11 |
| `ashcroft-launch-v1` (deliveryRule) | The current `retailDelivery()` table, unchanged | approved (existing) | §1 |
| `house-flat-v1` (deliveryRule) | The current `DELIVERY_TIERS` and `FREIGHT_BY_PREFIX`, unchanged | approved (existing) | §1 |
| `zuo-95206-curbside-v1` (deliveryRule) | `{ originZip: '95206', service: 'curbside', scope: '50_states_ex_AK_HI', quoteOnly: ['AK','HI','PO_BOX','APO_FPO','territories','islands','remote','restricted'], truckload: 'quote_only' }` | **proposed** | §9, §10 |
| `carrier-*-v1` (carrierRule) | Dimensional divisors, maximums and surcharges per carrier, service and effective date | **proposed**. Must come from the carrier contract. | §10 |
| `estimate-policy-v1` (estimatePolicy) | `{ validityMinutes: 30, zipNonbinding: true }` | **proposed** | §12 |
| `commission-schedule-v2` (commissionSchedule) | The tier table below | approved (Nov 3 and v2) | §15 |
| `tier-policy-v2` (tierPolicy) | `{ recompute: ['paid','refund','dispute','daily'], dailyLocal: '00:15', tz: 'America/Chicago', windowMonths: 12, crossingEarns: 'pre_purchase', downgrade: 'D-07' }` | **proposed** | §15 |
| `attribution-v2` (attributionPolicy) | `{ windowMs: 2_592_000_000, lastClickWins: true, basketScope: true, rateProtection: 'max(protected,current)' }` | **proposed** | §16 |
| `payout-schedule-v2` (payoutSchedule) | `{ day: 15, local: '09:00', tz: 'America/Chicago', cutoff: 'day 14 23:59:59 local', minimumMinor: 5000 }` | **proposed** | §17 |
| `clearing-v1` | `{ clearAfterDays: 30, from: 'verified_payment' }` | approved | §17 |
| `payout-readiness-v1` (payoutReadinessPolicy) | `{ require: 'D-10' }` | **proposed** | §28 |
| `business-credit-v2` (creditPolicy) | `{ awardMinor: 10000, qualifyingMinMinor: 50000, awardAfterDays: 30, expires: false, newBusiness: 'no prior verified business account or paid order under same beneficiary', dualReward: 'forbidden' }` | **proposed** (the award amount and minimum are approved) | §19 |
| `trade-discount-v2` (tradeDiscountSchedule) | `{ general: { maxBps: 2500, requiresSchedule: true }, zuo: { defaultBps: 1000, approvedExceptionBps: 500, projectStacking: false } }` | approved for Zuo; the general schedule needs a per-supplier entry | §18 |
| `project-discount-v2` (projectDiscountPolicy) | `{ tiers: [{ minMinor: 1_000_000, bps: 300 }, { minMinor: 2_500_000, bps: 500 }], basis: 'eligible merchandise after trade discount, before project discount, excl tax/delivery/credits', stack: 'highest_only' }` | **proposed** | §18 |

**Commission schedule v2** (rates in bps; the category is the explicit commission category):

| Tier | 12-month eligible attributed sales | Furniture | Décor and lighting | Clothing |
| --- | --- | --- | --- | --- |
| `base` | 0 ≤ s < 1,500,000¢ | 1000 | 800 | 500 |
| `active` | 1,500,000 ≤ s < 5,000,000 | 1200 | 900 | 600 |
| `top` | 5,000,000 ≤ s < 10,000,000 | 1500 | 1000 | 700 |
| `elite` | s ≥ 10,000,000 | 1800 | 1200 | 800 |

## 7. Money and rounding (`lib/money.ts`)

- `type Minor = number` must be a safe integer. Use `assertMinor(x)`, which throws `INVALID_INPUT` when `!Number.isSafeInteger(x)`.
- `type Bps = number`, an integer from 0 to 10000. Use `assertBps`.
- `ceilDiv(a, b)` and `floorDiv(a, b)` for positive integers. Use `BigInt` whenever `a > 2**53 / 10000`.
- `mulBps(minor, bps, mode)` returns `round_mode(minor * bps / 10000)`, with an explicit mode (`ceil` | `floor` | `half_even`).
- `Decimal` inputs (source wholesale, MAP and FX) are parsed from strings into `{ int: bigint, scale: number }`. Rational arithmetic stays exact in bigint until the final conversion to minor units with the named rounding policy.
- Never compute money with `Math.round(x * 100)` on a float that came from arithmetic. Only parse literal decimal strings.

## 8. Core formulas (pure functions, in `lib/economics/*.ts`)

Each formula's variables, units and rounding are fixed below. Golden tests in 04 check them against the worked illustrations in the v2 PDF.

### 8.1 Zuo merchandise base per piece (§7)

```
B_piece = wholesale_piece × (1 + supplierPaymentReserve) + handlingPerPiece + allowance(sizeClass)
        = wholesale × 1.03 + $10 + {15|25|40|60|100}
```

The calculation is exact rational, kept in micro-cents (10⁻⁴ cent) internally. `sizeClass = UNKNOWN` means no allowance can be inferred, so the variant is put on hold with reason `CARTON_MISSING` or `DELIVERY_UNSUPPORTED`.

### 8.2 Minimum retail per selling pack (§7)

Let p = processing, r = returns reserve, o = overhead, c = maximum applicable commission (the elite rate for the category, unless an approved SKU exception schedule sets a lower maximum), m = the SKU margin target, d = the trade discount for the SKU. Then:

```
B_pack = B_piece × piecesPerPack (+ verified fixed/per-unit costs: duties, inbound freight, fees — confirmed-zero allowed)
D1 = 1 − p − r − o − c − m           (retail with max commission)
D2 = (1 − p − r − o − m) × (1 − d)   (trade scenario)
minRetail = max( B_pack / D1, B_pack / D2, MAP_pack / (1 − d) )
```

Reject `D1 ≤ 0` or `D2 ≤ 0` with `INVALID_INPUT`. Round the pack price **up to the cent** (`rounding-pack-up-cents-v1`). Then `trade = ceil_cents(retail × (1 − d))`. Recalculate margin from the final pack price and never from a rounded piece price. The MAP test uses the matching selling-unit basis.

**Golden test G1 (SKU 111182, a pair):** wholesale $115.00 per piece, MEDIUM. B_piece = 118.45 + 10 + 25 = **$153.45**. B_pack = $306.90. p+r+o = 0.10, c = 0.18, m = 0.05, d = 0.10. D1 = 0.67, so 306.90 / 0.67 = 458.0597, which rounds up to **$458.06**. D2 = 0.85 × 0.9 = 0.765, so 306.90 / 0.765 = 401.18. MAP is unknown in the illustration, so that term is excluded. Retail = **$458.06**. Trade = ceil(458.06 × 0.9 = 412.254) = **$412.26**. Retail contribution at 18% commission = 458.06 × 0.90 − 306.90 − 0.18 × 458.06 = **$22.90** (about 5%). Trade contribution = 412.26 × 0.90 − 306.90 = **$64.13** (about 15.56%). For the approved cohort, the engine must *preserve* the imported approved pack price exactly, and *recompute* only to verify it.

### 8.3 Scenario economics (§7)

For each variant, compute these independently: retail direct (no commission), retail at the maximum eligible commission, trade at 5%, trade at 10%, and any eligible project or promotion scenario. Each scenario gives `contributionMinor = price × (1 − p − r − o) − B_pack − commission − otherVerifiedCosts` and `contributionBps`. **Prequalification:** full-schedule furniture at 18%, décor and lighting at 12%, clothing at 8% must have `contribution ≥ m × price`. If that fails, the referral eligibility state is `COMMISSION_UNQUALIFIED`, which stays until price or allowance is adjusted, a visible exception schedule is approved, or referral eligibility is disabled.

### 8.4 Line contribution and delivery subsidy (§11)

For each line *i* in a shipment group:

```
R_i = net merchandise actually paid after allocated discounts and credit (minor)
C_i = landed merchandise cost incl. supplier payment cost
H_i = actual supplier handling allocated by physical units within its supplier order
       (fee charged once per supplier order; allocate by physical units; if units = 0 allocate by net merchandise)
K_i = frozen eligible commission dollars (for estimates: reserve max published eligible/protected commission; trade: 0)
V_i = other known variable/fixed expenses incl. fixed payment cost & processing on allocated tax
A_i = R_i × (1 − p_i − r_i − o_i − m_i) − C_i − H_i − K_i − V_i
B_i = allowance_i + max(0, $10 × physicalUnits_i − H_i)
U_i = min(A_i, B_i)          // per line, never min(ΣA, ΣB)
```

Any `A_i < 0`, or any line with an unresolved `m_i`, blocks automatic checkout (`COST_REVIEW_REQUIRED` or `DELIVERY_QUOTE_REQUIRED`). For the group: `S = Σ U_i`. The budget allocation is not subtracted again as an expense.

### 8.5 Delivery requirement and ladder (§11)

```
F = modeled outbound freight + accessorials + one uncertainty reserve (never double-apply a buffer already in the source)
q_group = max(0, (F − S) / (1 − pd))          // pd = delivery processing rate
q = Σ q_group over shipment groups (each group's uncovered requirement once, respecting each group's subsidy cap)
qc = ceil(q) in cents
tier = 4999 + 1000 × max(0, ceil((qc − 4999) / 1000))
if tier > 19999 → DELIVERY_QUOTE_REQUIRED (whole cart; no partial total shown)
charge = max(tier, 4999)    // minimum applies even when subsidy covers all freight
```

Golden tests: requirements of $49.99, $50.00, $195.00 and $200.00 give **$49.99**, **$59.99**, **$199.99** and **quote required**. For F = $100, S = $25 and pd = 3%: q = $77.32, charge = **$79.99**, leaving about $2.59 after delivery processing on top of the $75 of unfunded freight.

### 8.6 Tax iteration (§11)

```
tier_0 = ladder(q)
loop k = 0..4:
  tax_k = taxFor(merchandise, tier_k, address)           // provider estimate or conservative table, see S17
  V_i += p × allocatedTax_i ; recompute A_i, U_i, q
  tier_{k+1} = max(tier_k, ladder(q))
  stop when tier_{k+1} == tier_k
if not stable after 5 iterations or tier > 19999 → DELIVERY_QUOTE_REQUIRED
```

The tier only moves up. Collected tax is never counted as revenue.

### 8.7 Shipment classification (§10)

For each carton: `longest`, `girth = 2 × (sum of the two other sides)`, `lengthPlusGirth`, `cubicVolume`, `actualWeight`, `dimWeight = ceil(volume / divisor(carrier, service, date))` and `billable = max(actual, dim)`. A carton is Ground-eligible only when every limit in the active `carrierRule` passes. Supplier-marked LTL is never downgraded automatically. LTL requires pallet dimensions and weight, pallet count, stackability, freight class or NMFC when applicable, residential, liftgate and appointment flags, and destination access. Truckload is quote-only. Never average dimensions across cartons.

### 8.8 Tier computation (§15)

```
window = [startOfMonthUTC(now) − 12 months, now)   // "preceding 12 calendar months of UTC payment timestamps"; lower inclusive, upper exclusive
qualifying = Σ eligible paid merchandise (after discounts & credit, excl tax/delivery) of attributed retail orders
             incl. pending commissions; excl. disputed/fraud-held while unresolved; minus refunds against the original sale
tier = highest t with qualifying ≥ threshold(t)     // boundaries inclusive at exactly 1,500,000 / 5,000,000 / 10,000,000
```

The exact window definition (calendar months against a rolling 365 days) is confirmed in decision D-06. Implement it behind `tier-policy-v2` and test both shapes at leap days.

### 8.9 Commission on a line (§10, §16)

```
basis_i = R_i (eligible merchandise actually paid after discounts and applied store credit; excl tax, delivery, other charges)
rate_i = max(protectedRate_i (from winning click snapshot, if within window), currentEligibleRate_i(tierAtPurchase))
earned_i = floor(basis_i × rate_i / 10000)
```

The rate is zero for trade-priced purchases, self-referrals, purchases for the beneficiary's own account, fraudulent or cancelled orders and ineligible products. There is no hidden cap. The only caps are visible SKU exception schedules.

### 8.10 Refund reversal (§17)

For each line, keep `cumulativeRefundedMinor`:

```
targetReversed_i = earned_i − floor((basis_i − cumulativeRefundedMerch_i) × rate_i / 10000)
delta = targetReversed_i − alreadyReversed_i  (≥ 0) → append refund_reversal(−delta)
```

The result can't go below zero or reverse more than the line earned. Repeated or out-of-order events never reverse twice.

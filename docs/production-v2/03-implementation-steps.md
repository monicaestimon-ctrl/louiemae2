# 03. Implementation steps S00–S40

Rules from [00-README.md](00-README.md) §2 apply to every step. Table and field definitions are in [02](02-domain-model-and-config.md) §3, formulas in 02 §8, and acceptance IDs in [04](04-acceptance-tests.md). When a step says "flag", the flag defaults to off.

Status line convention: replace `Status: not started` with `Status: in progress (branch …)` or `Status: done in PR #…`, and add a `Blocked:` line where it applies.

---

## Phase 0: handoff

### S00. Handoff setup and baseline
Status: done (Phase B PR)

**Goal.** Record the starting point, put the working tools in place and make a read-only export before any migration.

**PDF sections.** §22 (snapshot before migration), §24 (evidence), §25.

**Touches.** New: `scripts/v2/export-snapshot.ts`, `docs/production-v2/evidence-log.md` (already present, add rows), `data/.gitignore` (ignore `data/zuo/**` except `*.sha256` and `parity-*.md`).

**Work.**
1. Run the six checks from README §2 rule 12 on the current head. Record pass or fail and the test count in the evidence log as `BASE-01`.
2. Write `export-snapshot.ts`. It is a read-only `npx convex export`-style script, or an internal query paged into JSON, covering `commerceProducts`, `commerceListings`, `orders`, `retailCheckouts`, `commerceProjects`, `holmProfiles`, `holmCommissions`, `holmCredits`, `holmPayouts`, `holmTierChanges`, `holmClicks`, `holmQuoteRequests`, `holmReferrals` and `holmCommissionExclusions`. Output goes outside the repository, with a manifest of row counts and SHA-256 hashes. Record the code commit, schema hash and env flag names (not values).
3. Fill in README §4. List which external inputs exist and save their checksums under `data/zuo/2026-11-06/*.sha256`.
4. Copy the decision register (05 §1) into the admin backlog. Nothing is enabled.

**Exit criteria.** BASE-01 is recorded, the snapshot script runs against a dev deployment, and the input inventory is complete or the blockers are listed.

---

## Phase B: foundations and schema (package B)

### S01. Money, rates and rounding library
Status: done (Phase B PR)

**Goal.** Exact integer money arithmetic for all v2 code.

**PDF sections.** §4 (integer minor units, precise decimal inputs, no unconstrained floats), §7 (versioned rounding).

**Touches.** New: `lib/money.ts`, `lib/money.test.ts`, `lib/decimal.ts`, `lib/decimal.test.ts`.

**Contracts.** `assertMinor`, `assertBps`, `ceilDiv`, `floorDiv`, `mulBps(minor, bps, mode)`, `divByComplementBps(minor, bpsSum, mode)` (computes `minor / (1 − bpsSum/10000)` exactly), `parseDecimal('115.0000') → { int, scale }`, `decimalToMinor(dec, mode)`, `rational` helpers on bigint, and `applyRounding(policy, value)`.

**Tests.** Property tests (no float drift over 10⁵ random cases against a bigint reference), boundary tests (0, negative rejected, `2**53−1`), `ceil` of exact cents unchanged, and 458.0597 → 45806.

**Exit criteria.** The library is fully covered (≥ 95% lines). Nothing else changes.

### S02. Flags, error codes and versioned config registry
Status: done (Phase B PR)

**Goal.** One server-side place for flags (02 §5), typed errors (02 §4) and approvable config records (02 §6).

**PDF sections.** §1 (versioned configuration, owner sign-off), §21 (failure codes), §25 (flags).

**Touches.** New: `lib/flags.ts`, `lib/errors.ts`, `lib/config/*.ts` (one typed parser per `kind`), `convex/sysConfig.ts`, `scripts/v2/seed-config.ts`. Change: `convex/v2Tables.ts` (new file, spread into `convex/schema.ts`), `.env.example` (document every new flag with `false`).

**Schema.** `sysConfig`.

**Contracts.**
- `sysConfig.active(kind, key, at?)` (internal query): the newest `approved` record effective at `at`. Throws `POLICY_NOT_APPROVED` when only a `proposed` one exists, unless the caller passes `{ allowProposed: 'simulation' }`. Simulation is allowed only in admin preview, never in customer paths.
- `sysConfig.propose({ kind, key, value, note })` (admin mutation): validates through the parser and appends a new version.
- `sysConfig.approve({ id })` (admin mutation): requires the admin allowlist. Writes an audit event. Retires overlapping approved records by setting `effectiveTo`.
- `seedConfig` (internal mutation, idempotent by `kind+key+version`): loads the 02 §6 seed.

**Tests.** Parser rejects malformed values. `active()` picks the version by effective date. A proposed record blocks customer paths. Approval is audited.

**Exit criteria.** The seed runs twice with no duplicates, and every flag reads `false` when unset.

### S03. Idempotency keys and audit events
Status: done (Phase B PR)

**Goal.** Primitives that make "exactly once" and "who changed what" enforceable at the transaction layer.

**PDF sections.** §17 (stable idempotency key on every event), §21 (monetary uniqueness at the database transaction layer, audit of privileged changes).

**Touches.** New: `convex/sysIdempotency.ts`, `convex/sysAudit.ts`, `convex/sysLocks.ts`, tests with `convex-test`.

**Schema.** `sysIdempotencyKeys`, `sysAuditEvents`, `sysLocks`.

**Contracts.**
- `claimKey(ctx, key, scope)`: inside the *calling* mutation, looks the key up with `by_key`. If it exists, returns `{ duplicate: true, resultRef }`. Otherwise it inserts and returns `{ duplicate: false }`. Convex's optimistic concurrency guarantees two concurrent claims can't both succeed. The test covers this with parallel `t.mutation` calls.
- `audit(ctx, { actor, action, entityTable, entityId, before?, after?, reason? })`.
- `withLock(ctx, name, ttlMs)`: a lease row that lets a scheduled action sequence keep its lock across mutations.

**Exit criteria.** The concurrent-claim test passes. Audit rows can't be changed: no exported mutation patches them, and the `verify:catalog-writers`-style script `scripts/verify-append-only.mjs` greps for `db.patch`/`db.delete` on append-only tables. CI runs it.

### S04. Catalog and supplier schema
Status: done (Phase B PR)

**Goal.** Canonical products and variants, cartons, observations, revisions, media, imports, mappings and holds.

**PDF sections.** §4, §5, §6, §21, §22.

**Touches.** Change: `convex/commerceTables.ts` (`provider` gains `v.literal('zuo')`). Audit every `switch`/`if` on `provider` (search `provider ===`, `provider !==`, `'ashcroft'`, `'owner_managed'`) so the new value is explicitly *not orderable* until S19. New: catalog tables in `convex/v2Tables.ts`, `convex/catVariants.ts` (internal helpers `upsertVariantIdentity`, `openHold`, `resolveHold`).

**Schema.** Every table in 02 §3.2.

**Rules.**
- Variant identity is unique on `(supplierId, supplierSku, packId)`. `upsertVariantIdentity` reads `by_identity` and inserts in the same mutation.
- Original supplier names and SKUs are written once and never overwritten. A rename changes only `louieMaeName`.
- No product is copied per channel. A `commerceListings` row references `productId`, and Zuo `draft.variants` is regenerated from `catVariants` by `projectDraftVariants(productId)`.

**Tests.** Duplicate identity insert leaves one row. `zuo` provider products are rejected by `retailLaunch.createSnapshot` (legacy) with `This item is Coming Soon.`. Strict tsc passes.

**Exit criteria.** The schema deploys additively. Existing tests are unchanged and passing.

### S05. Identity, organization and membership schema with backfill
Status: done (Phase B PR)

**Goal.** Keep a person login, a business organization, a program membership and a payout beneficiary as separate things.

**PDF sections.** §2 (organization rules), §14, §21, §22 (no guessed merges).

**Touches.** New: tables in 02 §3.4 (`prgBeneficiaries`, `prgOrganizations`, `prgOrganizationMembers`, `prgMemberships`, `prgTermsVersions`, `prgTermsAcceptances`), `convex/prgIdentity.ts`, `convex/migrations/v2Identity.ts`. Change: `convex/holmAccess.ts` `viewer()` additionally returns `{ memberships, organizations, beneficiary }` (read-only, so callers that ignore them keep working).

**Backfill** (`migrations/v2Identity.backfill`, paged by 50, `dryRun` default `true`):
- Each `holmProfiles` row with `partnerStatus: 'active'` gets a `prgBeneficiaries` row with `kind: 'person'`, `legacyUserId = userId`, `refCode` copied, `tierKey = partnerTier ?? 'base'`, `payoutAccountRef = stripeAccountId`, `payoutReadiness` derived from `payoutsReady`, and `taxReadiness` from `w9Status`. It also gets a creator `prgMemberships` row with `state: 'active'` and `termsAcceptanceId: undefined`, flagged `legacyTerms: true`.
- Each profile with `tradeStatus !== 'none'` gets a trade membership with the status mapped across. For `approved` profiles that have a `businessName`, create a `prgOrganizations` row (`verification: 'verified'`) and an owner member. **Do not merge** organizations by name similarity. Ambiguous cases go into `migrationReview` output.
- The dry run reports counts by action and a list of ambiguous cases. A commit run writes rows and is idempotent by `legacyUserId`.

**Tests.** The dry run writes nothing. The commit run is idempotent. A profile that is both a partner and approved trade ends up with one beneficiary and two memberships (ACC01 groundwork).

**Exit criteria.** The dry run on dev matches the profile counts exactly.

### S06. Referral, ledger, credit and payout schema with opening snapshot
Status: done (Phase B PR)

**Goal.** Append-only financial ledger tables, and a non-destructive opening snapshot of legacy balances.

**PDF sections.** §17, §19, §21, §22 (never regenerate old earnings).

**Touches.** New: the tables in 02 §3.4 (clicks, links, attribution, tier snapshots, exceptions) and 02 §3.5, `convex/ldgCore.ts` (`applyCommissionEvent`, `applyCreditEvent`, the projection reducers), and `convex/migrations/v2Ledger.ts`.

**Core reducer.** `applyCommissionEvent(ctx, { eventKey, obligationId?, type, amountMinor, … })`:
1. `claimKey(eventKey)`. If it's a duplicate, return the existing result.
2. Load the obligation (or create it for `earned` and `opening_balance`).
3. Validate the transition using the state machine below. An invalid transition throws `PAYMENT_RECONCILIATION_REQUIRED`.
4. Insert the event, then patch the projection (`earnedMinor`, `reversedMinor`, `state`).

**Obligation state machine.**
```
pending ──clear(t ≥ clearsAt, no hold)──▶ cleared ──reserve──▶ reserved ──submit──▶ transfer_submitted ──succeeded──▶ transferred
   │  ▲                                     ▲  │                 │                         │uncertain stays submitted until reconciled
   │  └dispute_release──held◀──dispute_hold─┘  └reservation_released◀──failed──────────────┘
   └──full refund/dispute_lost──▶ void          transferred ──transfer_reversed──▶ cleared (re-payable) + offset rules
```
After `transferred`, a reversal or refund never debits a bank account. It appends an `offset` (a negative obligation) that is netted in a later run under the accepted terms.

**Opening snapshot** (`v2Ledger.snapshot`, dry run first): for each `holmCommissions` row, create one `ldgObligations` row with `source = legacy_storefront | legacy_house_quote | adjustment` and `legacyCommissionId`. Add one `opening_balance` event for the row's current amount, and map its state: `pending`→`pending`, `cleared`→`cleared`, `void`→`void`, and `paid` with a Stripe payout→`transferred` (with a manual payout→`transferred`, `providerRef: reference`). **Do not recompute any amount.** Do the same for `holmCredits`: credit accounts from ledger sums, with an `opening_balance` event per user that holds the available and reserved amounts. Holds stay linked by `ref`.

**Tests.** The legacy sum equals the v2 projection sum per partner (to the cent). A rerun creates no new events. Invalid transitions are rejected.

**Exit criteria.** The parity report is stored in the evidence log (`MIG-LEDGER-01`). The legacy tables are untouched.

### S07. Cart, estimate, quote, order and fulfillment schema
Status: done (Phase B PR)

**Goal.** Durable records for the whole checkout and fulfillment lifecycle.

**PDF sections.** §12, §13, §21.

**Touches.** New: the tables in 02 §3.3 and `sysPaymentEvents`, `sysJobs` and `sysNotifications`.

**Exit criteria.** The schema deploys. Each table has a minimal `convex-test` insert and read test. No functions are exposed yet.

---

## Phase C: catalog and economics (package C)

### S08. Explicit commission categories and lighting migration
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** Every product has an explicit commission category. Lighting becomes décor for future eligibility, and history stays exactly as it was.

**PDF sections.** §1 (audit Ashcroft and House-managed products), §5, §22 (lighting migration with preview), §24 CAT04.

**Touches.** New: `convex/catCategories.ts`, `lib/catCategory.ts` (a nav category → commission category map, held as config `kind: 'categoryMap'`). Change: `convex/holm.ts` `houseUnitCosts` and `convex/holmPartners.ts`. When `COMMISSION_ACCRUAL_V2_ENABLED`, read `catProductMeta.commissionCategory`. Otherwise keep `productTypeFor` (legacy). Make **no** edits to stored `holmCommissions.lines[].type`.

**Contracts.**
- `catCategories.preview()` (admin query): for every `commerceProducts` row, shows the proposed category from the map, the current legacy type and any conflict. Lighting rows are highlighted.
- `catCategories.commit({ productIds, category, reason })` (admin): writes `catProductMeta.commissionCategory` and an audit event. Products without a confident mapping get `review_required`, which blocks referral eligibility.
- Ashcroft and House audit report: lists products with a missing category or incomplete cost. It is read-only and feeds S35.

**Tests.** CAT04 (a lighting product with an existing earned commission: future category is décor, and the old commission's line type, rate and amount stay unchanged). `review_required` blocks the link builder.

**Exit criteria.** Preview and commit work. No historical row is changed (a hash of the `holmCommissions` table is identical before and after).

### S09. Zuo import adapter: dry run and commit
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** A repeatable adapter from the neutral staging package (JSON or CSV) to the real schema. Every record keeps its holds and exclusions, and no import creates duplicates.

**PDF sections.** §3, §4, §22, §24 CAT01.

**Touches.** New: `lib/zuoImport/parse.ts` (pure: JSON and CSV into `ZuoRecord[]`), `lib/zuoImport/validate.ts`, `lib/zuoImport/diff.ts`, `convex/zuoImport.ts` (admin actions and mutations), `scripts/v2/zuo-parity.ts`, fixtures in `lib/zuoImport/__fixtures__/` (synthetic data shaped like the package, **no real costs**).

**Algorithm.**
1. **Upload.** The admin uploads the package files. The server computes SHA-256 per file and `sourceKey = sha256(sorted file hashes)`, then creates `catImportBatches` with `mode: 'dry_run'`.
2. **Parse and validate.** For every record, check: supplier SKU present; no duplicate `(sku, packId)` inside the batch; `piecesPerPack` an integer ≥ 1; consistent unit bases (piece against pack for wholesale and MAP); no negative amounts; currency `USD`, or else `INVALID_INPUT: unsupported currency`; and every required value present. A value that is unknown is stored as `null` with a hold, never as 0 unless it is `confirmedZero`.
3. **Classify.** Each record goes into its cohort: `approved_306`, `map_135`, `original_296`, `reconciled_66`, `unpriced_62` (38 with missing carton inputs, 24 without a confirmed current cost), `excluded_226` (out of stock kept separate from discontinued), and `nonexcluded_draft_639`. Cohort counts must equal the package counts: 865, 803, 306, 135, 296, 66, 62, 226 and 639. A mismatch fails the batch with a per-cohort report.
4. **Diff** against existing `catVariants` by identity: `create`, `update` (source changes, pack conversions, prices, mappings, media, eligibility), `unchanged`, `reject` and `hold`. Owner-approved edits (fields with `approvedBy` set after the last import) are preserved, and a conflicting source value is reported as a conflict. The update is not applied.
5. **Commit** (a separate admin action with explicit confirmation, `mode: 'commit'`, idempotent by `sourceKey + batch hash`). Write `catSourceObservations` (immutable), `catVariants`, `catCartons`, `catCostRevisions`, approved `catPriceRevisions` for the 306 cohort with `origin: 'import_approved'` (exact approved pack amounts and rounding), `catVariantPolicies` and `catHolds`. **Every Zuo variant starts at `imported_draft`, with retail, trade and referral disabled.** A repeat import creates nothing new and never republishes a held variant.
5a. **Evidence confidence.** The 128-record reconciliation recovered 104 corroborated costs (`confidence: corroborated`), 5 explicit SKU MAP values (`mapSource: explicit_sku`), 99 MAP values labelled as policy-derived (`mapSource: policy_derived`, which are **not** confirmed SKU-level floors and give hold `MAP_POLICY_DERIVED` until reviewed) and 66 complete carton records. Image references exist for 844 records, but a URL being present is not proof of a usable image or of publication rights. Every variant starts with `MEDIA_MISSING` until S14 verifies its media. The JSON and CSV files are neutral staging formats until this adapter is validated. Editing the workbook does not regenerate them, so the adapter reads only the JSON and CSV files and checks them against the workbook export in the parity step.
6. **Metadata correction.** The package's `settings.pricingPrecedence` text still says 128 unpriced (it should be 62), and `settings.targetContributionScope` leaves out the 66 reconciled 20% candidates. Row-level data and the reconciliation summary are authoritative. The adapter records these as `metadataCorrections` on the batch and refuses to use the stale settings text for any decision.
7. **Parity report** (`scripts/v2/zuo-parity.ts`): reconcile each variant's wholesale, MAP basis, approved price, category, pack and image mapping against the workbook export and the canonical JSON. Output checksums, row totals and a per-record reason report as `parity-<date>.md` (no costs, safe to commit). Internal cost fields are never put in public exports.

**Named SKU handling** (seeded as holds by the adapter):
- `110799`: method changed from Ground to LTL. Hold `METHOD_CHANGED`. Earlier delivery assumptions are not reused.
- `101771`: missing from the latest Install source. Hold `SOURCE_ABSENT` (a verification hold, not discontinued).
- `111300`, `111303`, `111311`: authenticated checks showed out of stock. Status `out_of_stock` (not discontinued). Excluded until a stock refresh.

**UI.** In the admin Import tab (S35): upload, dry-run summary table, per-record drill-down, conflicts, commit button, and the parity report link.

**Tests.** CAT01 (importing the same batch twice gives stable identities and no duplicates, with exact count reconciliation). Each validation rule is checked on fixtures. A cohort count mismatch fails the batch. Approved-306 prices are preserved exactly (PRI01 groundwork).

**Exit criteria.** The fixture import runs end to end. The real-package dry run is recorded (or blocked by README §4 inputs).

**Blocked by.** Real package files (README §4).

### S10. Source observations, freshness and availability
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** Separate states for source data, economics and publication. Freshness is enforced, and availability is never inferred.

**PDF sections.** §4 (immutable observations), §6, §24 CAT02 and CAT05.

**Touches.** New: `convex/catFreshness.ts`, `lib/catFreshness.ts` (pure evaluation), `convex/catStock.ts` (refresh job and adapter interface `StockSource`), and a cron entry in `convex/crons.ts` (`refresh-zuo-stock`, hourly, processing variants whose last observation is older than `stockSyncMaxHours − 2h`, behind `BACKGROUND_MONITORING_ENABLED`, with a manual "Refresh now" admin action).

**Algorithm.** `evaluateVariant(variant, observations, policy, now)` returns `{ ok, holds[] }`:
- Cost or MAP older than `costMapMaxDays` → `COST_STALE`, unless a documented effective price list covers `now`.
- A known `effectiveTo < now` → stale, whatever the timestamp says. An old timestamp never overrides a known expiry or conflict.
- Conflicting observations (same field, different values, both current) → `COST_CONFLICT`.
- Implausible values (cost ≤ 0, MAP < cost, piece/pack mismatch) → `COST_IMPLAUSIBLE`.
- Stock older than `stockSyncMaxHours` → `STOCK_UNVERIFIED`.
- If a live source fails, use only observations that are still valid. Otherwise hold.
- Availability is one of `in_stock`, `out_of_stock`, `discontinued`, `preorder_approved` or `unknown`. A missing feed row or an ambiguous public page sets `unknown` and a hold. Neither one is proof of discontinuation or availability. Discontinued variants can never become sale- or referral-eligible again without a new observation and admin review. Out of stock stays off sale (Zuo has no preorder in v1).

**No silent substitution.** A missing value never quietly turns into a base commission, a zero cost or another supplier's fee. It opens a `Cost review required` item (a `catHolds` row) instead. Freshness policy is stored per supplier (`catSuppliers.freshness`).

**Server enforcement.** A single helper, `assertSellable(ctx, variantId, purpose: 'publish' | 'purchase' | 'link' | 'estimate')`, is called by every publish, cart, estimate, checkout, link-builder, bulk-import and background path. It throws `COST_REVIEW_REQUIRED`, `MAP_POLICY_REVIEW` or `STOCK_UNAVAILABLE`. Existing public URLs show an unavailable state rather than a 404.

**Paid orders affected by a later stock change** go to `ordPaidExceptions` (`stock_failed`). They are never silently substituted or cancelled.

**Tests.** CAT02 (missing or stale cost, MAP applicability, carton or stock: a direct API call and the UI both fail to publish or buy). CAT05 (discontinued, out of stock and feed omission give distinct statuses, with no inferred availability or deletion). Freshness boundaries at exactly 24h and 7d.

**Exit criteria.** Every caller path goes through `assertSellable`. A grep test enforces this: every `publish`, `createSnapshot` and link mutation file imports it.

### S11. Cartons, packs and physical units
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** A two-piece pack consistently means two physical pieces in cost, handling, allocation, MAP, cartons, price, inventory and customer copy.

**PDF sections.** §4, §11 (separate counts), §24 CAT03.

**Touches.** New: `lib/catUnits.ts` with `physicalUnits(variant, packs)`, `cartonsFor(variant, packs)` and `piecePriceInfo(packPrice, piecesPerPack)`. Change: the S09 adapter and the S17 engine use these.

**Rules.** Keep these counts separate: physical pieces, sellable packs, cartons, fulfillment groups and supplier orders. Assembled product dimensions are **never** substituted for carton dimensions. Per-piece price is informational only. The authoritative price is the pack price. Customer copy says "Set of 2" (from `piecesPerPack`) wherever a quantity is shown.

**Tests.** CAT03 (a 2-piece pack with 2 cartons: piece cost and handling, pack price, inventory, cartons and the customer's quantity all agree).

### S12. Pricing engine, margin policies and scenario economics
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** Every variant has a policy id and a reproducible scenario result. Approved prices are preserved and the 5% scope can't expand.

**PDF sections.** §2, §3, §7, §24 PRI01, PRI02 and PRI04, §26 (135 MAP floor).

**Touches.** New: `lib/economics/base.ts` (02 §8.1), `lib/economics/minRetail.ts` (§8.2), `lib/economics/scenarios.ts` (§8.3), `lib/economics/*.test.ts` (golden G1), `convex/catPricing.ts`.

**Contracts.**
- `catPricing.simulate({ variantId, overrides? })` (admin query): runs the engine with the active approved config. With `allowProposed: 'simulation'` it shows proposed config, clearly marked. Returns the scenarios and the minimum retail.
- `catPricing.recompute({ variantIds })` (internal, batched): writes `catScenarioResults`. It **never** overwrites an `approved` price revision. A difference is flagged instead.
- `catPricing.proposePrice` and `catPricing.approvePrice({ variantId, channel, packPriceMinor, policyKey, reason })` (admin): approving checks `packPrice ≥ minRetail` (or the documented exception) and `≥ MAP` on the matching basis, then appends a `catPriceRevision`.
- `catPricing.assignPolicy({ variantId, policyKey, documentRef? })`: `zuo-approved-5` is allowed **only** for variants whose cohort is `approved_306` (the server rejects anything else). `zuo-legacy-18` requires `documentRef`.

**Rules.**
- 135 MAP-based candidates: automatic sale stays held (`MAP_FLOOR_UNAPPROVED`) until a per-SKU floor is approved. Never infer 5% or 20% for them (decision D-01).
- 66 newly reconciled: candidate prices only. A 5% exception is never inferred.
- The revised 441 MAP and 5% cohort records (306 + 135): authoritative sellable-pack retail and trade prices are rounded **up** to cents, and fractional per-piece references are informational. The original cohort's approved rounding and exact amounts are kept as imported. New calculations use the versioned rounding policy (`rounding-pack-up-cents-v1`), and margin is recalculated from the final charged pack price.
- The 5% target is not a promise of 5% net business profit. Scenario output says "contribution", never "profit".
- 62 unpriced: held, with 38 `CARTON_MISSING` and 24 `COST_MISSING`.
- 226 excluded: history kept, never activated.
- A fee change triggers a proposed price revision or a hold, never an undisclosed reduction in partner earnings.
- Report contribution and actual operating profit separately (S35 report).

**Tests.** G1 golden values. PRI01 (approved-306 and original price exports: exact approved pack amounts preserved, and assigning the 5% policy to another variant is rejected). PRI02 (full Elite commission and trade scenarios: separate calculations, and the engine never combines commission and trade on one purchase). PRI04 (zero MAP → review, final pack rounding correct, policy and economics enforced after credits are applied, which is checked again in S19). Non-positive denominators are rejected.

**Exit criteria.** The engine is deterministic: the same inputs hash to the same output (`inputsHash`).

### S13. MAP, promotions and market review
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** MAP, advertised-price constraints, coupons, trade treatment and rights are separate controls that the server enforces.

**PDF sections.** §8, §24 PRI03.

**Touches.** New: `convex/catPromotions.ts`, `lib/promotionPolicy.ts`, `convex/catMarketReview.ts`.

**Rules.**
- A promotion policy holds: supplier and SKU scope, channel, allowed mechanism (`coupon` | `automatic` | `project` | `credit`), effective dates, code or automatic rule, funding source, stacking priority and evidence ref. With no documented supplier authorization for a mechanism, that mechanism is disabled for the supplier's SKUs. **Zuo: coupons, public promotions and automatic project stacking are disabled** until documented.
- A final price above MAP doesn't by itself authorize a prohibited coupon. Delivery and tax can't be used to hide merchandise advertised below MAP.
- Server checkout rechecks every affected line after all discounts and credits (S19 calls `assertLineEconomics`). If an advertised eligible rate can't be honored, the promotion is removed going forward or the sale is held. A smaller reward is never silently substituted.
- Store credit on restricted products is enabled per supplier only once the supplier policy confirms it.
- Market review: record identical SKU, variant and pack where possible, then clearly labelled substitutes. Record retailer, date, merchandise price, stock, mandatory delivery, service level and total before tax at representative ZIPs. MSRP is not an observed price. Trigger a review when the delivered price is more than 10% above the median of at least 3 valid exact comparisons, or materially above the lowest. With fewer than 3, set `evidence_limited`. The trigger creates an admin task and never changes a price automatically.

**Tests.** PRI03 (a Zuo coupon, project discount or 25% attempt is rejected by the server whatever the client or MAP arithmetic says). The review trigger fires at 10% exactly and handles fewer than 3 references.

### S14. Names, slugs, redirects and the media pipeline
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** Short Louie Mae names, stable links, and media that is verified and stored, never hot-linked.

**PDF sections.** §5.

**Touches.** New: `convex/catNaming.ts` (reuse `convex/productNameRegistry.ts` and `lib/productNames.ts` for collision checks), `convex/catMedia.ts` (actions), `lib/safeFetch.ts` (host allowlist, redirect re-check, size and time limits, content-type sniffing). Change: the storefront router resolves `slugHistory` to a 301-style client redirect.

**Rules.**
- Names: type and variant descriptors where needed. Factual specs are kept, and no copy implies exclusive design or manufacture. Duplicate-name, slug-collision and mismatched-variant-image checks give holds `NAME_COLLISION` or `MEDIA_MISSING`.
- Public supplier attribution (`Louie Mae x Zuo`) is rendered only when `catSupplierPolicies(kind: 'private_label' | 'media')` says it is required. Permission is never inferred from the existence of a private-label program. If rights are unverified, the hold is `MEDIA_RIGHTS`.
- Media ingest (`catMedia.ingest`, an action): fetch only from allowlisted supplier hosts (`lib/safeFetch.ts`; SSRF protection that re-checks every redirect, blocks private IP ranges, and caps at 20 MB and 15 s). Reject non-image and broken responses. Validate the MIME type and dimensions. Dedupe by SHA-256. Store the original privately when licensing requires it. Make responsive derivatives (640, 1280 and 2048 webp/avif). Save rights metadata. An admin verifies hero and gallery against SKU, color and pack, and writes alt text. Assembly instructions are stored as `role: 'assembly'` with the correct product mapping.
- Failed media leaves the listing in draft. A published card is never blank.

**Tests.** Allowlist and redirect SSRF tests. Hash dedupe. A rejected HTML response. A slug rename keeps the old URL working.

### S15. Publication state machine and server gates
Status: done (Phase C PR). Admin screens ship with S35.

**Goal.** One server-owned path from imported draft to published, for both channels.

**PDF sections.** §6, §8, §22 (publish only the verified subset), §25.

**Touches.** New: `convex/catPublication.ts`. Change: `convex/commerce.ts` `publish` and `unpublish`. For `provider: 'zuo'`, route through `catPublication` when `CATALOG_PUBLICATION_V2_ENABLED`, and otherwise reject. The Ashcroft and CJ paths stay the same.

**State machine.** `imported_draft → evidence_review → economics_review → content_review → ready → published`, and `archived` from any stage. A hold can interrupt any stage (stage kept, `holds` non-empty means not publishable). Each transition is a mutation that checks its gate:

| Transition | Gate |
| --- | --- |
| → evidence_review | Required source fields present (S10) |
| → economics_review | Approved cost revision, MAP applicability resolved, cartons complete, policy assigned |
| → content_review | Approved price revision per enabled channel, scenarios pass, commission prequalification resolved (S28) or referral disabled |
| → ready | Name and slug unique, media verified, rights documented, retail mapping present (for HOLM variants with a retail destination) |
| → published | `assertSellable('publish')`, flag on, and the selected channels pass atomically (publish-to-both commits both or neither) |

**Rules.** Publishing by count ("publish all 639") is forbidden. The API takes explicit variant ids, at most 50 per call, and every one must pass. Unpublish keeps URLs, orders, tracking and valid obligations working (OPS01). Rollback restores the prior listing revision and disables the affected new listings. It never erases paid orders or financial obligations.

**Tests.** Every gate rejects through a direct mutation call. Publish-to-both is atomic. OPS01 (unpublish or roll back with paid orders outstanding: new sales stop, and orders, tracking and valid obligations keep working).

---

## Phase D: delivery, checkout and fulfillment (package D)

### S16. Shipment classification
Status: done (Phase D PR).

**Goal.** Ground against LTL against quote-only, from real carton evidence.

**PDF sections.** §10.

**Touches.** New: `lib/shipping/classify.ts` (02 §8.7), `lib/shipping/carrierRules.ts` (parsed `carrierRule` config), and tests.

**Rules.** Size class alone is never enough. Calculate each carton separately. Divisors, maximums, additional handling, oversize, residential, delivery-area, fuel and peak surcharges are versioned by carrier, service and effective date. A conditional $315 minimum isn't a universal price for items under 350 lb. Supplier-marked LTL is never downgraded. Don't invent pallet rotations. Large sofas, unusual quantities and truckloads are quote-only.

**Tests.** Boundary tests per limit, an oversize carton, the supplier-LTL lock (SKU 110799 fixture), and a missing carton giving `CARTON_MISSING`.

### S17. Delivery and cart economics engine
Status: done (Phase D PR).

**Goal.** One server-owned delivery service for product estimates, cart estimates, checkout and trade quotes.

**PDF sections.** §9, §10, §11, §24 DEL01–DEL03 and DEL05.

**Touches.** New: `lib/delivery/engine.ts` (pure), `lib/delivery/groups.ts`, `lib/delivery/ladder.ts`, `lib/delivery/tax.ts` (interface), `lib/delivery/*.test.ts`, `convex/dlvEngine.ts` (loads inputs and calls the pure engine).

**Algorithm.**
1. **Group lines** by actual supplier, origin warehouse, service and fulfillment constraint. Unrelated warehouses are never consolidated. Start with origin ZIP **95206**, and only for shipments confirmed from that warehouse. Other origins give `DELIVERY_QUOTE_REQUIRED` until a rule exists.
2. **Per group:** classify (S16). Get the freight estimate from an authorized live carrier or supplier quote adapter when one exists. Otherwise use a calibrated, dated ZIP-zone and carton matrix (`carrierRule`) with an uncertainty reserve. Store the raw estimate, accessorials, uncertainty, confidence, quote id, source and expiry. Distance helps pick the region but is not the pricing formula. November 5 benchmarks are research evidence only.
3. **Per line:** compute `A_i`, `B_i` and `U_i` (02 §8.4). Supplier handling is charged once per supplier order and allocated by physical units. `K_i` for retail estimates reserves the maximum published eligible or protected commission, so following a referral link never raises the customer's delivery fee. For trade it is 0.
4. **Group requirement:** `q_group = max(0, (F − S) / (1 − pd))`. **Cart:** sum the groups, then round once on the ladder (02 §8.5). Any group needing a manual quote makes the whole cart quote-required, and no partial total is shown.
5. **Supplier-specific rules:** Ashcroft lines use `ashcroft-launch-v1` (the existing per-item fees, unchanged). House quote lines use `house-flat-v1`. A mixed Zuo and Ashcroft cart is decision **D-12**. The proposed rule: the Ashcroft group's existing per-item charge plus the Zuo ladder charge, shown as one delivery line with a breakdown by shipment group. It's built behind config and blocked until approved.
6. **Tax iteration** (02 §8.6). `lib/delivery/tax.ts` defines `TaxEstimator`. The production implementation is `stripeTaxCalculation` (the Stripe Tax Calculations API: no charge is created, but it is a Stripe call and needs authorization under README rule 5 before real use). Until then, `conservativeTaxTable` uses the highest combined rate per state from config. Taxes collected are never counted as revenue.
7. **Final order economics** at checkout recheck every expense, the actual charged delivery and the line minimums before payment.
8. After payment, the accepted charge is honored. Carrier variance becomes an internal `ordFreightActuals` exception, never an automatic customer debit (DEL05). Customer-requested address or service changes need a revised quote and explicit acceptance before any extra collection.
9. **Free delivery** requires a separately funded, approved policy. The $49.99 minimum always applies otherwise.

**Scope rules** (config `zuo-95206-curbside-v1`): standard service is curbside where the supplier or carrier supports it. Inside delivery, assembly, room of choice and white glove are never promised without a validated service and price. PO boxes, restricted areas, islands, remote access, Alaska, Hawaii, APO/FPO and territories go to quote. Show appointment, liftgate, access limitations and customer responsibilities before payment.

**Reference scenarios** (provisional customer targets, valid only when validated shipment economics support them): California small $59.99, California medium $79.99, Phoenix small $69.99, Phoenix medium $89.99, New York medium $199.99 (not a sofa, a full truck or a universal East Coast charge), and Alaska/Hawaii, oversized, multipallet and unknown inputs → request a delivery quote. Add them as **fixture scenarios** in tests with synthetic freight inputs. The tests check that the engine *reproduces the ladder logic*. They do not assert carrier truth.

**Tests.** DEL01 (49.99, 50, 195 and 200 give 49.99, 59.99, 199.99 and quote-required). DEL02 (mixed-margin, mixed-origin cart: per-line floors, group-specific costs and subsidies, the actual $10 fee and the allowance never spent twice; includes the "4 pieces, one $10 order fee, $40 allocation, $30 left" case). DEL03 (oversize carton, sofa, AK/HI, remote address: supported classification or quote, and never a distance-only or $199.99 cap fallback). DEL05 (freight invoice above the estimate: internal variance exception, no extra customer charge). Worked example F=100, S=25, pd=3% gives $79.99. A negative `A_i` blocks checkout.

### S18. Estimate service and storefront UI
Status: done (Phase D PR).

**Goal.** ZIP estimates on product and cart pages, and full-address confirmation at checkout.

**PDF sections.** §9 (product page, cart and checkout UX), §12 (estimate contract), §24 DEL04.

**Touches.** New: `convex/dlvEstimates.ts`, `convex/ordCarts.ts`, `components/delivery/DeliveryEstimate.tsx`, `components/delivery/QuoteRequest.tsx`. Change: the product detail (`components/product/*`), cart (`components/cart/*`) and checkout (`components/checkout/*`).

**Contract.** `dlvEstimates.estimate({ cartRevision | lines: [{ variantId, packs }], channel, destination: { zip } | { address }, service })`:
- The server reloads prices, membership, stock, source versions and restrictions. It **ignores** any price, role, allowance or commission rate from the client, and logs it if one was sent.
- It returns `{ estimateId, status: 'ok' | 'quote_required' | 'unsupported', deliveryChargeMinor?, serviceName, timingCaveat, expiresAt, cartHash, addressHash?, reasons: customerSafe[] }`. The internal breakdown is admin-only.
- Validity is 30 minutes (`estimate-policy-v1`), shortened to any underlying quote or price expiry. ZIP estimates are non-binding.
- Invalidation: any change to cart, address, membership, service, quantity, credit, discount or a source version makes the estimate stale (`QUOTE_EXPIRED` at checkout).

**UI.**
- **Product page:** ZIP and quantity inputs. Show one estimated charge **or** "Request a delivery quote", the service name and a short timing caveat. Show no supplier costs, allowance formulas or margin warnings.
- **Cart:** recompute the whole shipment. Never add up product-page estimates. Show the groups when the split is known.
- **Checkout:** confirm the full address, delivery service, merchandise, discounts, credit, delivery, tax and total before payment. Show split-shipment disclosure copy (S21).
- States: loading, error and expired ("Your estimate expired, refresh") are announced to screen readers with `aria-live`.

**Tests.** DEL04 (a change to quantity, address or service, or an expired quote, means requote and reconfirm before payment, and the paid amount stays immutable). Client-sent prices are ignored and logged (SEC01 part).

### S19. Checkout service (mixed supplier, reservations, verified payment)
Status: done (Phase D PR).

**Goal.** One idempotent checkout for Louie Mae. It can include Zuo and Ashcroft in one parent order, and only a verified payment event marks it paid.

**PDF sections.** §12, §13 (confirmed routing direction), §24 FUL01 and FUL05, §21.

**Touches.** New: `convex/ordCheckout.ts`, `convex/ordPayments.ts` (event inbox processor). Change: `convex/http.ts` `/stripe/checkout` (when `RETAIL_ZUO_CHECKOUT_ENABLED` or v2 is on, call `ordCheckout.createIntent`; otherwise keep the legacy `retailLaunch.createSnapshot`). The webhook persists every verified event to `sysPaymentEvents` first (dedupe by `event.id`), returns 200 and processes asynchronously with `ctx.scheduler.runAfter(0, internal.ordPayments.process, { eventId })`. Legacy handling stays for legacy sessions (`metadata.retailCheckoutId`).

**Algorithm (`createIntent`).**
1. Require a full-address estimate (`precision: 'full'`) that is still valid through payment initiation, matching cart hash and address hash. Recompute merchandise eligibility, tax and economics (S17 step 7). If anything changed, return `PRICE_CHANGED` with the new totals and don't create a session until the client sends `acceptTotalMinor` equal to the new total.
2. `claimKey('checkout:' + clientIdempotencyKey)`.
3. Reserve inventory (`ordInventoryReservations`, expiring with the intent, default 30 minutes, matching the Stripe session `expires_at`). Reserve store credit (S31 `reserveCredit`, off merchandise only).
4. Freeze `lineSnapshot` (variant, packs, unit pack price, allocated discount and credit, category, supplier, cost and price revision ids), delivery, tax and `attributionSnapshotId` (S27).
5. Create the Stripe Checkout session for **exactly** the accepted total. Line items come from the snapshot, delivery is a single fixed shipping rate, the store-credit coupon has `max_redemptions: 1`, and `metadata: { intentId }`. Use the idempotency key `checkout-session:<intentId>`. Payment methods are card only at first. Long-running asynchronous methods stay disabled until a stock and price policy for them exists.
6. On session failure, release the reservations.

**Payment processing (`ordPayments.process`).** For `checkout.session.completed` with `payment_status: 'paid'` (or `async_payment_succeeded`): load the intent and verify currency, amount and line totals. If the intent is still `session_open`, create `ordOrders`, `ordOrderLines` and the supplier partition (S21) in one mutation, consume reservations and settle credit. If the intent is `expired`, or stock or policy failed after expiry, create an `ordPaidExceptions` row, keep the payment evidence, and **never create a second charge**. Duplicate or out-of-order events are no-ops (idempotency by `order:<intentId>`). A browser success redirect is never treated as payment evidence.

**Exit criteria.** A Zuo plus Ashcroft cart produces one Stripe session, one parent order and two child supplier orders. Every quantity is allocated exactly once and the parent totals reconcile (FUL01).

**Tests.** FUL01. Duplicate `checkout.session.completed` gives one order. Payment after intent expiry goes to the exception queue. A total mismatch is rejected. The legacy Ashcroft-only path still passes its existing tests with the flag off.

**Blocked by.** D-12 (mixed delivery). Real Stripe calls (README rule 5) are mocked in tests.

### S20. Versioned manual quotes
Status: done (Phase D PR).

**Goal.** Delivery quotes and trade quotes with immutable accepted versions.

**PDF sections.** §9 (request delivery quote), §12 (manual quote contents), §18 (trade checks).

**Touches.** New: `convex/ordQuotes.ts`. Change: `convex/commerceProjects.ts` (`save` creates an `ordQuoteVersions` row per revision, and `accept` marks the version accepted and immutable), and `components/delivery/QuoteRequest.tsx`.

**Rules.** A quote holds exact variants, packs, quantities, address, delivery service, per-item discounts, taxes, expiry, terms and an immutable accepted version. Changing an accepted quote creates a new version that needs acceptance again. Trade quote prices must still pass MAP, policy and margin (S12 and S13). A saved quote does not reserve inventory unless `reservesInventory: true` is set explicitly by an admin. Paying an accepted quote creates an intent from the quote version (same S19 path).

**Tests.** Editing an accepted quote creates a new version. An expired quote gives `QUOTE_EXPIRED`. A trade quote below MAP is rejected.

### S21. Parent and child orders, manual dealer queues and shipments
Status: done (Phase D PR).

**Goal.** Explicit Zuo fulfillment, partial fulfillment and honest split-shipment communication.

**PDF sections.** §13, §24 FUL01, FUL04 and FUL05.

**Touches.** New: `convex/ordFulfillment.ts`, `components/admin/DealerQueue.tsx` (Zuo and Ashcroft tabs, also mounted in the trade admin), and `components/orders/OrderStatus.tsx` (customer order page). Change: `convex/emails.ts` (confirmation and shipping templates) and `convex/commerceFulfillment.ts` (add a `zuo` group that routes to the manual queue and never to CJ).

**Rules.**
- **Partition** after verified payment: one child supplier order per (supplier, origin, dispatch and service when needed). Supplier identity comes from the canonical variant and never from the customer payload, product name or collection label. Every physical quantity gets exactly one `ordAllocations` row. Parent totals and child allocations must reconcile without a second customer charge.
- **Queues.** Zuo child orders go to the Zuo manual dealer-order queue and Ashcroft child orders to the Ashcroft manual queue. Paid Zuo orders are never routed to CJ and never auto-purchased in a dealer account. Each task stores: supplier PO, accepted costs, shipping method, delivery address, supplier confirmation, tracking, shipment contents and exceptions.
- **Operations** verify availability and submit the correct physical quantities and pack increments. They reconcile supplier acknowledgements and invoices against the accepted order and escalate any discrepancy before an unauthorized substitution or extra spend.
- **Partial fulfillment.** A supplier rejection or delay changes only that supplier's lines. It never resends or cancels the other supplier's accepted order. Refunds, cancellations and credits reference the affected original lines and keep the parent payment history.
- **Customer disclosure** (required before payment, on the post-checkout confirmation page, in the confirmation email and on the order details): "Your order may arrive in separate shipments. Items may ship from different locations and arrive on different dates. We'll send tracking updates as each shipment ships. Splitting your order will not add delivery charges beyond the amount confirmed at checkout." When the split is already known, use "Your order will arrive in separate shipments" instead of "may". Show confirmed shipment groups and their items when available. Never invent shipment counts or dates. Internal supplier names don't appear. For an accepted custom quote, the same protection covers its confirmed delivery total. Put this copy in `lib/customerCopy.ts`, and a test asserts that the exact strings are used in all four places.
- **Shipping notifications** list the items and quantities in that shipment, the tracking link when available, and the status of remaining items. The order page tells partially shipped apart from fully shipped, and partially delivered apart from fully delivered. It never marks the whole order delivered when only one shipment has arrived. A split found after confirmation sends a notification and updates the order. A change to a delivery estimate sends a clear update and never silently edits the original confirmation.
- Support split shipments, partial cancellation, damage claims, lost packages, supplier rejection and customer notifications. Customer-facing delivery windows come from verified supplier or service data and are never a hard-coded promise.

**Tests.** FUL01, FUL04 (one supplier rejects, partially ships or cancels: only its lines change, parent status, tracking and refunds stay accurate, and the other supplier's order is preserved) and FUL05 (the disclosure appears before payment, after checkout and in the confirmation email, notifications identify shipped and outstanding items, and there is no extra charge just for splitting).

### S22. Returns, refunds and goodwill
Status: done (Phase D PR).

**Goal.** Return terms per supplier and category, and refunds per line.

**PDF sections.** §13 (returns).

**Touches.** New: `convex/ordReturns.ts`, config `returnPolicy` per supplier and category (eligibility window, condition, authorization, restocking, original-delivery and return-freight treatment, damage evidence and claim deadline).

**Rules.** Show the applicable terms before payment (checkout summary link). The 2% returns reserve doesn't define or fund every return. A refund covers line merchandise, tax, delivery and credit according to the accepted policy and the actual event. Commission is recalculated only on refunded eligible merchandise (S29). Credit-funded shares go back as credit, never as cash (S31). Goodwill adjustments are a separate, audited type.

**Blocked by.** Supplier return and damage policies (README §4, decision D-08). Build the model. Checkout activation stays blocked.

### S23. EDI adapter interface (disabled)
Status: done (Phase D PR).

**Goal.** A future Zuo EDI is a supplier-specific fulfillment adapter. It is not a new checkout and not a universal forwarding rule.

**PDF sections.** §13 (EDI), §24 FUL02 and FUL03.

**Touches.** New: `convex/fulfillment/adapters/types.ts` (`FulfillmentAdapter { submit(childOrder): Promise<SubmitResult>; parseAck(msg); parseShipment(msg); parseInvoice(msg) }`), `convex/fulfillment/adapters/zuoEdiMock.ts` (mock transport only) and `convex/fulfillment/submit.ts`.

**Rules.**
- With `EDI_ZUO_ENABLED` on (it stays off this release), only paid, released **Zuo** child orders are eligible. The payload carries only that child's Zuo supplier SKUs, quantities, agreed costs and the necessary shipping and contact information. Ashcroft lines, other suppliers' costs, referral information and the whole mixed cart are never sent.
- Store the mapping version, child-order id, supplier PO, outbound payload hash, transmission id and acknowledgement state. Retry the same logical PO idempotently. An uncertain transmission must be reconciled before any manual fallback. Manual and EDI submission are mutually exclusive per child order, with an audited handoff.
- Supplier acknowledgement, shipment and invoice messages update the child order and roll up to the parent, without changing customer prices that were already accepted.
- Onboarding needs Zuo's actual transport, document formats, SKU and quantity units, and the acknowledgement, shipment and tracking, invoice, and cancellation and change workflows (decision D-11). Don't assume a particular transaction set. Test and production connections stay isolated.

**Tests.** FUL02 (EDI for a mixed cart: the Zuo payload holds only its items and permitted shipping data, and Ashcroft stays on its own route, using the mock). FUL03 (a duplicate event, an uncertain EDI send or a manual fallback: one logical PO, uncertainty reconciled before resubmission, no duplicate fulfillment).

---

## Phase E: programs and referrals (package E)

### S24. Creator and trade memberships, versioned terms
Status: not started

**Goal.** One login, two independent memberships, and versioned acceptance of terms.

**PDF sections.** §14, §20 (onboarding states), §24 ACC01.

**Touches.** New: `convex/prgMemberships.ts`, `convex/prgTerms.ts`, `components/creator/Onboarding.tsx`. Change: `convex/holmPartners.ts` `join`. When `CREATOR_ENROLLMENT_V2_ENABLED`, delegate to `prgMemberships.creatorStart`. Otherwise keep the legacy behaviour. `convex/holm.ts` `applyTrade` and `reviewApplication` write the trade membership state too.

**Creator flow.** `email_unverified` → (Convex Auth email verification) → `profile` (display name, social, site URLs, validated with `lib/importUrl.ts` safe-URL rules) → `terms` (accept the current `prgTermsVersions` for creator and referral, recording the version and time) → `checks` (automated basic abuse checks: disposable email domain, duplicate payout identity, URL reputation denylist, rate limits) → `active`, or `review` when a check flags. There is no follower minimum and no automatic trade discount.

**Trade flow.** `applied` → `evidence` (business or professional evidence upload) → `review` → `approved`, `rejected` or `needs_info` → optional **referral terms activation** in the same account (a separate step, `referralActivated: true`). Approval to buy is distinct from referral activation. A second creator account is never required.

**Rules.** Duplicate enrollment resolves to the existing identity without revealing another account's private details (a generic message). Similar business or legal names flag a review and never merge identities or payouts automatically. Shared email or domain, multiple team members and business changes go through an audited ownership process (admin tool in S35). One sale gets at most one retail-referral reward, however many memberships exist. A beneficiary has one shared tier and one payout identity.

**Tests.** ACC01 (creator and trade memberships on one identity: shared tier and payout beneficiary, separate permissions, no second account). Each state transition, a duplicate enrollment and the terms version stored.

### S25. Cross-site identity, trade-only HOLM, retiring HOLM retail commission
Status: not started

**Goal.** Trade authorization is checked on the server everywhere. HOLM is for approved trade purchasing only.

**PDF sections.** §14 (same-identity auth, server checks), §18 (HOLM purchases earn trade savings, not commission), §24 ACC02 and REF01.

**Touches.** Change: `convex/holm.ts` (`catalog`, `priceSelection`, `requestQuote`, `createClientQuote`), `convex/holmPartners.ts` `reconcile` (skip `priceMode: 'retail'` requests created after the flag-on timestamp), and `trade/app.ts` (a retail visitor sees "Shop retail on Louie Mae" with a link to the mapped retail page).

**Rules.**
- With `HOLM_TRADE_ONLY_ENABLED` on: `requestQuote` without an approved trade membership throws `TRADE_APPROVAL_REQUIRED`. No new `holmQuoteRequests` with `priceMode: 'retail'` are created. Existing retail-priced requests created before the switch keep their earned or awaiting state (record the flag-on time in `sysConfig`).
- Trade prices, quotes, downloads and checkout check trade approval on the server. Retail catalog pages never return wholesale costs or private project information (projection whitelist test).
- Same-identity authentication across Louie Mae and HOLM: they share an origin today (`/trade`). If the domains ever differ, use short-lived, validated redirect tokens (single use, 60 s, audience-bound). Never put credentials in referral URLs and never allow open redirects (`lib/safeRedirect.ts`, allowlisted paths only).

**Tests.** ACC02 (unapproved trade access or a direct endpoint call: trade pricing and checkout are denied and no private data leaks). A retail visitor on HOLM is routed to Louie Mae. A HOLM retail-quote commission path cannot be created with the flag on.

### S26. Retail mappings and the link builder
Status: not started

**Goal.** Retail links only for approved referral members and mapped, published, purchasable retail variants.

**PDF sections.** §16 (links), §20, §22 (one retail mapping per eligible HOLM variant, redirects), §24 REF01.

**Touches.** New: `convex/catRetailMappings.ts` (admin create and retire, plus a validation job), `convex/prgLinks.ts`, `components/partner/LinkBuilder.tsx` (shared by the Creator Hub and Trade Hub; port the trade copy into `trade/app.ts` as a small `htm` wrapper). Change: `lib/partnerLink.ts`. Add `retailReferralUrl(linkId)` → `https://www.louiemae.com/r/<linkId>`, and keep `partnerPageUrl` for legacy use. `App.tsx` gets a route for `/r/<linkId>` (or `#r/<linkId>`, decided by the router), which records the click (S27) and then navigates to the destination.

**Contract.** `prgLinks.create({ destination: { retailVariantId } | { path }, channelTag })`:
- Requires an active creator membership or a trade membership with `referralActivated`, and a beneficiary in `active` status.
- For a variant: a `catRetailMappings` entry must exist (when generated inside HOLM) and the retail variant must be published, purchasable (`assertSellable('link')`) and referral-eligible (category not `review_required`, prequalified or an exception schedule). Otherwise `REFERRAL_INELIGIBLE` is returned with a customer-safe reason, and the UI shows a clear unavailable state.
- The response is `{ linkId, url, destinationLabel, productName, variantName, category, applicableRateBps, eligibility, disclosureExample }`. Rate and eligibility come from the server and are the same values the terms and ledger use.

**UI.** Three separate actions: **Copy retail referral link**, **Share trade project** (a trade board or project link, no referral) and **Invite a business** (a business-referral invite that leads to S31 credit). Each has a copy confirmation, a QR code (`qrcode-generator`) and a disclosure example ("#ad — I earn a commission if you buy through my link"), with guidance for posts, Stories and video.

**Tests.** REF01 (HOLM's Copy retail referral link gives the correct published Louie Mae variant destination and a tracked retail purchase). An unmapped variant shows the unavailable state. A creator without an active membership is denied.

### S27. Attribution v2 and rate protection
Status: not started

**Goal.** Deterministic last-eligible-click attribution with exact 30×24h windows, and a protected rate snapshot taken at the click.

**PDF sections.** §16, §24 REF02 and REF03.

**Touches.** New: `convex/prgAttribution.ts`, `lib/attribution.ts` (pure resolution). Change: `lib/partnerLink.ts` (store the opaque `clickId` returned by the server in a first-party cookie or `localStorage` when consent allows; without consent, keep only in-memory session attribution), `convex/holmPartners.ts` `recordClick` (when `ATTRIBUTION_V2_ENABLED`, also write a `prgReferralClicks` row; when the flag is off, legacy only), and the consent banner if one exists (search for `consent`). If there isn't one, consent is `unknown`, and legal decides whether `unknown` permits storage (decision D-13).

**Algorithm.**
- `recordClickV2({ linkId | refCode, visitorKey, userAgent, referrerHost })`: validate the link signature or existence. Mark `eligible: false` with a reason for bots (user-agent denylist and missing JS challenge), internal self-navigation (a referrer on our own host with the same session), an invalid signature, an inactive beneficiary or a self-click (the authenticated user is the beneficiary or one of its organization members). Write the rate snapshot: the tier, schedule version and, for a product link, the product's category, rate and any exception version. Set `expiresAt = at + 30 × 86_400_000`. Rate-limit to 30 clicks per minute per visitor key.
- `resolve({ visitorKey, userId?, at })`: among eligible clicks for that visitor (and, when authenticated, for the user through a permitted association) with `at ≤ now < expiresAt`, pick the latest `at` (ties broken by `clickId`). Direct visits never overwrite. Expiry is exclusive at exactly `at + 30d`. Cross-device association happens only through authentication (`linkVisit`-style). Never claim guaranteed cross-device tracking.
- At checkout, `prgAttribution.snapshotForIntent(intentId)` writes `prgAttributionSnapshots`. **Basket scope:** all eligible merchandise lines in the attributed retail order, not only the linked product. Each line qualifies separately and the scope is disclosed. For each line: `protectedRate` (from the click snapshot, for the linked product or category in scope), `currentRate` (tier at purchase) and `applied = max(protected, current)`. A later eligible click replaces the attribution and its protection snapshot. Protection survives commercial rate reductions, but not fraud or self-referral exclusions. Category changes need both the old and new mappings for the calculation.
- A product that becomes unavailable or cost-held can't be bought until resolved. Its protected rate is never lowered to make it eligible. If it becomes purchasable within the window, the protected rate is honored.
- Self-referral uses partner and customer identity, organization ownership and risk indicators. A shared address alone creates review (`prgReviewQueue`) and never an automatic, irreversible finding. A trade member's independent retail client can qualify.
- The client never sends the beneficiary or commission amount. Any such field is ignored and logged.

**Tests.** REF02 (last valid click, a direct visit, an expired click and a self click: deterministic winner, exact 30-day boundary at `expiresAt − 1 ms` and `expiresAt`). REF03 (rate reduction, rate increase and category change: protected window honored, higher eligible rate applied, earned terms immutable).

### S28. Commission schedules, tier computation and SKU prequalification
Status: not started

**Goal.** One versioned schedule, deterministic tiers with explicit timing, and no hidden caps.

**PDF sections.** §7 (prequalification), §15, §24 REF04 and PRI02.

**Touches.** New: `convex/prgTiers.ts`, `lib/tiers.ts` (02 §8.8), `convex/prgPrequalify.ts`. Change: `convex/crons.ts` (add `tier-daily-chicago` hourly at minute 15. The handler runs only when local America/Chicago time is 00:15–01:14 and no `prgTierSnapshots` with `reason: 'daily'` exists for that local date. This handles daylight saving with `Intl.DateTimeFormat`). The legacy `update-partner-tiers` stays until v2 accrual is on, then it is disabled by a flag check inside the handler.

**Algorithm.**
- `recomputeTier(beneficiaryId, reason, watermarkEventId)`: take `withLock('tier:' + id)` and compute qualifying sales (02 §8.8) from `ldgObligations` and `ordOrderLines` (eligible retail-attributed merchandise, including pending, excluding disputed or fraud-held, minus refunds). Write a `prgTierSnapshots` row with window bounds and the watermark. Apply the downgrade policy from `tier-policy-v2` (D-07).
- Triggered on: a paid order (S19), a refund or dispute event (S29), and the daily job.
- **Crossing:** the tier used for a purchase is the snapshot in force *before* the purchase's own qualifying amount is added (pre-purchase tier). Later purchases use the upgraded tier. Two simultaneous purchases are serialized by the lock, so their order is deterministic (OCC retry). A later refund or rolling-window expiry changes **future** rates only. Valid earned commissions are never changed.
- The portal shows the visible tier and the next threshold (`tierProgress`).
- **Prequalification** (`prgPrequalify.run(variantIds)`): for each variant, use the S12 scenario at the full schedule (furniture 18%, décor and lighting 12%, clothing 8%). If it passes, the variant is referral-eligible. If it fails, the variant gets `COMMISSION_UNQUALIFIED`. The fixes are to adjust price or allowance, approve a visible tier-by-tier `prgSkuCommissionExceptions` schedule (effective dates and a visible note shown in the link builder, terms and ledger), or disable referral eligibility. Audit listings before making any full-schedule promise. Economics must support every advertised applicable rate. Never advertise 10% and then pay less because of internal costs.
- With `COMMISSION_ACCRUAL_V2_ENABLED`, the 40% `MARGIN_GUARD_BPS` and the unknown-cost base fallback are **not** used for v2 accrual. Unknown cost means not eligible. The legacy functions stay for legacy rows.

**Tests.** REF04 (tier crossing, rolling expiry and refund: pre-purchase and new-tier timing as defined, no retroactive rewrite of earned rates). Boundary tests at exactly $15,000, $50,000 and $100,000. A concurrency test with two simultaneous purchases. The DST test runs the daily job across the March and November transitions. PRI02 (Elite full schedule and trade scenarios are computed separately).

---

## Phase F: financial lifecycle (package F)

### S29. Commission ledger v2
Status: not started

**Goal.** Earned, cleared, reversed and held amounts as append-only events on immutable line snapshots.

**PDF sections.** §17 (states, clearing, refunds, disputes), §10 (commission basis), §24 LED01 and LED02.

**Touches.** New: `convex/ldgCommissions.ts`. Change: `ordPayments.process` (S19) calls `accrueForOrder(orderId)` when `COMMISSION_ACCRUAL_V2_ENABLED` and records `accrualPath: 'v2'`. Otherwise the legacy `storefrontCommission` runs and records `accrualPath: 'legacy'` (they never both run). Refund and dispute webhooks route to `ldgCommissions.onRefund` and `onDispute*` for v2 orders and to the legacy `storefrontReversal` for legacy ones.

**Rules.**
- `accrueForOrder`: for each line in the attribution snapshot, `earned_i` follows 02 §8.9. One obligation per line, event key `earn:<orderLineId>`. Basis = eligible merchandise actually paid after allocated discounts and applied store credit, excluding tax, delivery and other charges. The amount is zero for trade-priced purchases, self-referrals, purchases for the beneficiary's own account, fraudulent or cancelled orders and ineligible products. `clearsAt = paidAt + 30d`.
- **Clearing job** (hourly): pending obligations with `clearsAt ≤ now`, with no open refund review, dispute or fraud hold, get a `cleared` event.
- **Refunds** use cumulative cents per line (02 §8.10) with key `refund:<chargeId>:<refundId>:<lineId>`. Repeated partial refunds can never over-reverse.
- **Disputes:** `dispute_hold` holds the affected unpaid amount. A won dispute (`dispute_release`) restores the eligible obligation once. A lost dispute (`dispute_lost`) voids it.
- Reversals of amounts already transferred append an `offset` that reduces future earnings under accepted terms. A bank account is never silently debited.
- Admin `manual_adjustment` requires a reason, and over the threshold (config, proposed $250) a second confirmation (S38).
- Out-of-order events (a refund before the earn) are stored in `holmPaymentStates`-style pending state (reuse the existing table) and applied when the obligation is created.

**Tests.** LED01 (duplicate or out-of-order paid and refund events: exactly one obligation and correct cumulative reversals). LED02 (a partial refund, and a dispute won or lost: correct pending, cleared and paid adjustments and restoration with no duplication). A sum invariant: `Σ events = projection` for every obligation (property test).

### S30. Payout runs v2
Status: not started

**Goal.** Monthly payouts that are safe to retry, with a cutoff, reservations, uncertain-result reconciliation and transfer kept separate from bank arrival.

**PDF sections.** §17, §28 (crons, W-9 policy, transfer versus bank), §24 PAY01 and PAY02.

**Touches.** New: `convex/ldgPayouts.ts` (mutations), `convex/ldgPayoutActions.ts` (actions). Change: `convex/http.ts` handles connected-account events `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated` (writing `ldgBankPayouts`) and platform `transfer.reversed` (appending `transfer_reversed`). `convex/crons.ts` gets `payout-run-chicago` (hourly at minute 0; runs only when local Chicago time is the 15th, 09:00–09:59, with no run for that period). The legacy `partner-payouts` keeps its own flag. Both are guarded so that only one of `PARTNER_PAYOUTS_ENABLED` and `PAYOUT_EXECUTION_ENABLED` can be true (the handler refuses when both are true and raises an alert).

**Algorithm.**
1. `withLock('payoutRun:' + period)`. Create `ldgPayoutRuns` (`by_period_kind` must be unique) with `cutoffAt` = the 14th at 23:59:59.999 America/Chicago.
2. **Planning:** for each beneficiary, eligible = obligations `cleared` with `clearedAt ≤ cutoffAt`, net of offsets. Require `payoutReadiness: 'ready'` (refreshed from Stripe) and the tax readiness from `payout-readiness-v1` (D-10, one policy for manual and automatic). If eligible is less than $50 (5000), the amount carries forward and the beneficiary sees why.
3. **Funding check:** read the platform available balance (a Stripe balance read, mocked in tests). The run aborts with an alert if the total exceeds available funds less a reserve. The historical "$0 balance / daily bank payout" observation is not a current balance check.
4. **Reserve:** append `reserved` events (key `reserve:<runId>:<obligationId>`). Each payable cent can be reserved at most once.
5. **Submit:** create `ldgTransferAttempts` (key `transfer:<runId>:<beneficiaryId>`), then `stripe.transfers.create({ amount, currency: 'usd', destination, metadata: { attemptId, runId } }, { idempotencyKey: attempt.key })`. Success means `transfer_submitted` then `transferred` (state `succeeded`). A definite rejection (invalid request, permission or authentication error) means `transfer_failed` and `reservation_released`, so the obligation is free again. A timeout or 5xx means `uncertain`: **never retry blindly**. Reconcile by listing transfers for the destination with `metadata.attemptId` (reuse the existing `runMonthlyPayouts` pattern). If the remote transfer succeeded but the local write failed, the next run's reconcile step completes it.
6. Weekend and holiday processing and bank arrival are never promised as same day. Customer-facing copy says "sent to your connected account". Bank status shows separately when observed.
7. Manual payout route (`adminRecordPayout` v2) uses the same reservation and readiness rules, with method `manual` and an external reference.
8. Moving money, changing payout switches or bank schedules is never a side effect of a build step.

**Admin view.** Pending, cleared, held, reserved, submitted, transferred, bank-paid where known, failed and carry-forward balances, plus the total eligible due on the next 15th (S35).

**Tests.** PAY01 ($49.99, $50, a held balance and monthly concurrency: carryforward and eligibility correct, one reservation per payable cent, and a concurrent manual and monthly run can't pay the same cents). PAY02 (timeout, remote success with local failure, and retry: reconcile before retry, no double transfer, no erased obligation). Cutoff at exactly 23:59:59.999 Chicago on the 14th across DST.

**Blocked by.** D-09 and D-10. Real transfers are prohibited (README rule 5).

### S31. Business referral credit v2
Status: not started

**Goal.** A $100 one-time credit with pending, award, reservation, redemption, reversal and liability treatment.

**PDF sections.** §19, §24 CRE01 and CRE02.

**Touches.** New: `convex/ldgCredits.ts`. Change: `convex/holmCredit.ts` (when `CREDIT_V2_ENABLED`, `reserveCredit`, `settleCredit` and `restoreOnRefund` delegate to v2. The legacy path stays otherwise), and `convex/holmPartners.ts` `reconcile` step 3 (skip when v2 is on).

**Rules.**
- **Qualifying:** a newly referred business (no prior verified business account or paid order under the same beneficiary, with an auditable duplicate review) is verified and completes qualifying paid merchandise of **at least $500.00** (50000), after discounts and credit, excluding delivery and tax. $499.99 does not qualify.
- **Timing:** `award_pending` when the qualifying payment is verified. `award_available` 30 days after payment and validation. If a refund reduces qualifying merchandise below $500 before the award, `award_cancelled`.
- **Anti-double-reward:** one order can't trigger both this award and a retail-referral commission for the same beneficiary. The flow is chosen before checkout (the invite link sets `businessReferral` intent and the attribution snapshot excludes retail commission for that beneficiary), the benefit is disclosed, and the flow never switches silently after payment. A trade purchase never earns retail commission.
- **Uniqueness:** one award per referred-business identity (`by_referred_org`, key `award:<orgId>`).
- **States:** pending award, available, reserved, redeemed, reversed and reinstated. Reservations are atomic (projection `availableMinor` checked and decremented in one mutation), so concurrent carts can't overspend. Expired or failed checkouts release them.
- **Refunds:** a partial refund restores the originally credit-funded share and refunds only the cash-funded share. It never converts credit to cash. Refunding a qualifying business order after the award reverses unspent credit, or creates a visible offset if it has already been spent, under finalized terms.
- **Liability:** credit is non-cash, separate from commission and trade savings, and does not expire (proposed terms). Show eligibility restrictions before redemption. Finance records the liability and an approved funding reserve at issuance (`fundingReserveRef`) and reconciles redemption without counting the marketing expense twice. A $100 credit is never treated as $100 of cash merchandise revenue in commission or checkout economics. Credit-funded value is excluded both from `R_i` in the S17 engine and from the commission basis (02 §8.9: "after … applied store credit"), so credit always **reduces** both. If a later economics change prevents automatic redemption, already-earned rights are kept and a reviewed redemption route is offered. Credit is never silently revoked or recovered as a disguised shipping surcharge.

**Tests.** CRE01 ($499.99 against $500 qualifying business order: correct one-time award after review, with tax and delivery excluded). CRE02 (concurrent redemption, refund and duplicate business: no overspend, no duplicate award, credit and cash refund allocated correctly).

**Blocked by.** D-05 (dual-reward and review rules), and funding approval for issuance.

### S32. Trade and project benefits v2
Status: not started

**Goal.** Trade discounts from an explicit product and supplier schedule, with project tiers that never override policy.

**PDF sections.** §18.

**Touches.** Change: `lib/holmPricing.ts`. Add `tradeDiscountFor(variant, schedule)`, keeping `HOLM_RULES` for legacy. `convex/holm.ts` `pricedListing` and `priceSelection` use the schedule when `TRADE_CHECKOUT_V2_ENABLED`. New: `lib/projectDiscount.ts`.

**Rules.**
- General eligible products can advertise **up to** 25% off, but only through an explicit product and supplier schedule entry.
- **Project thresholds** (proposed, D-04): the basis is eligible merchandise after the standard trade discount and before the project discount, excluding tax, delivery and credits. At $10,000 or more, at most an additional 3%. At $25,000 or more, at most an additional 5%, not both. Combined with 25%, the total reduction is 27.25% or 28.75%.
- Every line shows project eligibility and the actual discount before acceptance. A project threshold never overrides MAP, a supplier restriction, a published exception or a margin floor.
- **Zuo:** the approved 10% trade offer, or an explicitly approved 5% exception, and **no stacked project discount**. The general 25% is never applied silently to Zuo.
- Credit redemption on trade orders passes its own policy and economics checks.
- HOLM purchases earn trade savings, not retail commission (S25).

**Tests.** 27.25% and 28.75% combined reductions. Zuo lines excluded from the project tier. A MAP floor beats the project discount.

---

## Phase G: portals (package G)

### S33. Creator Hub v2
Status: not started

**Goal.** A complete creator portal.

**PDF sections.** §20.

**Touches.** Change: `components/CreatorHub.tsx` (split into `components/creator/*`). New queries: `prgPortal.creatorSummary` (whitelisted fields only).

**Contents.** Membership and onboarding status. Eligible products with search and filter (eligible variants only, rate shown). Link builder (S26) with copy confirmation. Disclosure examples. Click metrics, labelled "informational". Attributed order totals with privacy-safe references (order number suffix and date; never buyer name or email). Pending, cleared and paid earnings (using ledger v2 states, with "Transferred to your Stripe account" and "Arrived in your bank" shown separately). Tier progress. Payout and tax status. Terms version and support. Clear empty, loading, failed, unavailable and suspended states.

**Tests.** A snapshot test per state. A projection test shows no PII and no supplier cost in the query result.

### S34. Trade Hub v2
Status: not started

**Goal.** A complete trade portal in `/trade`.

**PDF sections.** §20.

**Touches.** Change: `trade/app.ts` (Hub section). New: `prgPortal.tradeSummary`.

**Contents.** Application and approval status. Business users and roles (invite, change role and remove, owner only). Trade catalog with actual prices. Projects and versioned quotes (S20). Order tracking (S21). **Referrals & Earnings**: retail links and the same retail commission ledger as creators. Business invitations and credit history (S31). Payout setup. Terms and support. A second creator account is never required, and the referral activation step is separate from approval to buy.

### S35. Admin consoles and the decision register UI
Status: not started

**Goal.** Every operational queue the PDF names, kept out of reach of creators and unauthorized trade users.

**PDF sections.** §20 (admin list), §26.

**Touches.** New: `components/admin/v2/*` mounted in `AdminPage.tsx` and in the trade admin. Queries are admin-only (`requireCjAdminIdentity`).

**Screens.** Application review. Product and source import batches (S09). Cost and policy queues (holds by reason). Availability refresh. Category migration preview (S08). Price comparisons and scenario economics (S12, S13). Delivery quotes and actuals (S17, S21). Media review (S14). Publication controls (S15). SKU rate exceptions (S28). Attribution investigations (S27 review queue). Ledger adjustments with a reason (S29). Credit review (S31). Payout reconciliation and obligations due (S30). Dealer-order queues (S21). Paid-order exceptions (S19). **Decision register** (each `sysConfig` proposed record, with its decision id, approve or reject, approver and timestamp). The Ashcroft and House audit report (S08). A contribution against operating profit report (S12).

**Rules.** Supplier cost data and customer PII are never exposed to creators or unauthorized trade users (a projection test per query). Every write is audited.

### S36. Durable notifications
Status: not started

**Goal.** Notifications go out as durable jobs with deduplication, and transactional and marketing preferences are kept separate.

**PDF sections.** §20 (notifications).

**Touches.** New: `convex/sysNotify.ts` (enqueue with `dedupeKey`, a worker that retries with backoff and uses provider idempotency through Resend's `Idempotency-Key`). Reuse `convex/holmEmail.ts` and `convex/emails.ts` templates.

**Events.** Approval, missing information, quote readiness, shipment (per shipment, S21), commission adjustment, payout failure, tier change, credit award or reversal. Transactional messages ignore marketing opt-out. Marketing messages require consent.

### S37. Accessibility, copy, terms and privacy
Status: not started

**Goal.** Public terms match the implemented behaviour, and the two sites use the same vocabulary.

**PDF sections.** §20 (WCAG 2.2 AA, consistent vocabulary), §21 (privacy notices), §26 (public terms), §24 UX01.

**Touches.** Change: `lib/holmPartners.ts` `partnerTerms()`. Generate it from the v2 config records, keeping the user's terms structure, and add v2 rules. New: `lib/vocabulary.ts` (status labels for currency, dates and order, commission and payout states, used by both sites), `docs/production-v2/terms-draft.md` (for legal review), and a privacy notice section.

**Terms must state.** Exact tier timing and basket scope. Click-time protection and its exceptions. Transfer against bank receipt terminology. The payout cutoff. Business-team ownership. Product-specific eligibility. Zuo exclusions from general trade and project offers. Credit reservation, refund and dual-reward treatment. Tracking consent. Account closure and record retention. Separate Creator Program and HOLM Trade Program explanations, with shared retail-referral terms and versioned acceptance. The disclosure example with guidance for posts, Stories and video. No promised free products, no guaranteed earnings, and no automatic ownership of participant content. Campaign gifting and paid usage rights need separate agreements. **No placeholders**, and no claim of a universal 25% discount. A test asserts that every number in the terms comes from config (extend `trade/partnerCopy.test.ts`).

**Privacy notice** covers cross-site referral tracking and payout providers.

**Accessibility.** Mobile-first layouts, readable tables, keyboard navigation, visible focus, labelled errors and `aria-live` status announcements. Check representative flows with keyboard only and a screen reader (VoiceOver or NVDA), and record the results in the evidence log. Run `@axe-core/playwright` on the main pages in CI as a non-blocking report first.

**Blocked by.** D-08 (service and returns) and D-14 (operator legal identity, support address, privacy and tax details).

**Tests.** UX01 (mobile, keyboard, empty, error and onboarding flows: usable complete journeys and consistent public promises).

---

## Phase H: security, operations and release (package H)

### S38. Security hardening and data retention
Status: not started

**Goal.** The security and privacy controls the PDF requires.

**PDF sections.** §21, §24 SEC01.

**Work.**
- Webhooks: verified signatures on the raw payload (already done), persist `event.id` (S19), process durably, handle retries and out-of-order delivery. Pin `apiVersion` in every `new Stripe(...)` and verify the endpoint configuration for the actual environment. `shouldAllowUnsignedStripeWebhook` must return false whenever `CONVEX_CLOUD_URL` is a production deployment (test).
- Secrets stay on the server. Grep for secrets in logs and import files (`scripts/verify-client-secrets.mjs` extended to the `data/` and `docs/` folders).
- Rate limits (`sysRateLimits`, a token bucket by key) for link generation, quotes, enrollment, click recording and image fetching.
- SSRF: `lib/safeFetch.ts` allowlist for every server fetch of a source URL (S14).
- Every mutation: authenticated authorization, typed validation, idempotency where it can create obligations, and a domain result. Add a test that lists the exported mutations and checks each one calls an auth helper or is internal.
- Data retention policy per table (legal and operational purpose). Handle consent withdrawal and account deletion. Keep legally required financial records while minimizing or splitting personal identifiers. Partners receive only the customer information they need.
- Privileged changes: payout beneficiary changes and manual financial adjustments over the threshold need re-authentication (fresh sign-in within 10 minutes) plus a second admin confirmation. Record privileged access in `sysAuditEvents`.

**Tests.** SEC01 (client price tampering, webhook forgery and cross-account access: rejected and logged without leaking secrets or private financial data).

### S39. Monitoring, alerts and runbooks
Status: not started

**Goal.** Make operations visible and owned.

**PDF sections.** §25.

**Touches.** New: `convex/sysMetrics.ts` (counters written by the services), `convex/sysAlerts.ts` (checks every 5 minutes, sending alerts through `sysNotify` to the operations inbox), `components/admin/v2/Health.tsx`, and the runbooks in 05 §4.

**Metrics.** Import and source freshness, stock conflicts, publication holds, estimate success and latency, quote-required rate, delivery estimate against actual variance, contribution by SKU and channel, payment-event backlog, failed fulfillment tasks, attribution loss, commission liabilities, credit liabilities and payout exceptions.

**Proposed alerts.** Any negative realized contribution. Any duplicate financial event (a duplicate idempotency claim on a money scope). A missed daily source or tier job. A webhook backlog older than 15 minutes. Payout reconciliation exceptions. Review the first 20 fulfilled shipments by hand and recalibrate reserves from actual invoices, without presenting that sample as statistically conclusive.

### S40. Staging validation, pilot cohort and controlled release
Status: not started

**Goal.** A controlled production activation with evidence.

**PDF sections.** §22 (pilot cohort, rollback), §24, §25.

**Sequence.**
1. Deploy disabled code (flags off) and run the additive migrations (S05, S06 commits after dry-run parity).
2. Dry-run the real Zuo import (S09) and review the parity report.
3. Choose the **pilot cohort**: one single item, one multi-piece pack, one décor or lighting item, one Ground shipment and one manually quoted LTL item, each passing every gate.
4. Inspect the pilot listings in staging. Run all of 04 in staging with mocks. Record the evidence.
5. Rehearse rollback: unpublish the pilot, restore the previous listing revisions, and confirm paid-order and obligation integrity (OPS01).
6. Get release gates 1–5 signed (05 §2). Enable flags one at a time, following 05 §3, and only for permitted flows.
7. Verify real customer journeys read-only, then expand only after review.
8. Any money-moving function whose verification is unauthorized or incomplete stays disabled, and the unmet gate is reported.

**Exit criteria.** The definition of done in 05 §5.

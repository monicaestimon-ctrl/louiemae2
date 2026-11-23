# 06. Release checklist: what is live, and what turns each v2 feature on

The initial Phase G+H implementation is merged, but that is not end-to-end operational acceptance. Use the dated production evidence and current feature flags to establish what is actually active. The remaining catalog, delivery, authenticated-journey and financial gates below must be checked against current production records.

After a successful main build, CI deploys Convex, adds missing configuration records, runs the additive identity backfill and runs `v2Migrations:runLedgerParity`. This read-only report exhausts user and legacy-source reference pages, includes credit-only users, and records completion, mismatch counts and diagnostic truncation. It remains informational in CI: a green deployment is not cutover approval. A report with `passed: false` or `complete: false` must be resolved. The scan is explicitly `paginated_not_atomic`; run it in the controlled quiet window and retain its timestamps before financial cutover. CI receives only counts and statuses; identifying mismatch details are redacted by default. An authorized operator can request `includeDetails: true` and retain that report privately. CI never commits financial openings or enables credit/payout execution.

Standing owner authorization covers ordinary implementation, review, merge, deployment and eligible-product rollout. Do not request the same authorization again. Deferred authenticated browser access is a verification dependency, not a reason to stop independent code work. Real test payments, transfers, payouts and supplier dispatch remain unauthorized.

The owner has approved provisional modeled freight from the retained supplier/reference evidence. Exact account-specific freight quotes are not a prerequisite for that model. Keep source dates, assumptions, supported coverage and quote-required exceptions explicit; do not describe planning values as contracted carrier quotes or silently extend expired evidence.

Operational decisions are recorded under **Admin → Commerce v2 → Operations & decisions**. Deployment flags are stored in the production Convex environment. Enable each only when its applicable readiness gate passes; deployed code alone does not enable shopping.

## Step 1. Decisions to approve (decision register)

Check each current registry record before changing it. Seeded defaults start as `proposed`. Record existing owner decisions without asking for repeated approval; unresolved business or legal decisions still need their designated owner. Approval of an approach does not establish missing supplier evidence.

| Decision | Record(s) to approve | Unblocks |
| --- | --- | --- |
| D-16 freshness and estimate validity | `freshnessPolicy/freshness-default`, `estimatePolicy/estimate-policy` | Sellability checks, estimates |
| D-03 delivery processing and freight | `deliveryLadder/delivery-ladder`. Install the approved, versioned modeled `carrierRule/zuo-freight` with supported destination and package coverage, or verified carrier rates when available. Preserve quote-required behavior outside that scope. Tax calculation is a separate verified checkout dependency; do not invent per-state rates. | Zuo delivery estimates |
| D-08 service and returns | `deliveryRule/zuo-95206-curbside`. Then propose `returnPolicy/returns-zuo-<category>` and `returnPolicy/returns-ashcroft-<category>` records. | Checkout, returns |
| D-12 mixed carts | `deliveryRule/mixed-zuo-ashcroft` | Zuo + Ashcroft in one checkout |
| D-01 MAP floors | Assign a per-SKU policy for each of the 135 MAP-based candidates (Admin → Catalog). Until then they stay held. | Those SKUs only |
| D-02 Zuo policies | Record documented MAP, trade, coupon, private-label and media policies (`catPolicies.savePolicy`) | Coupons, attribution text, media rights |
| D-06 / D-07 tiers | `tierPolicy/tier-policy`. The downgrade stays quarterly (the November 3 rule) unless a new version says `immediate`. | v2 tiers |
| D-13 consent | `attributionPolicy/attribution`. Set `consentUnknownAllowsStorage` to whatever legal decides first. | Attribution v2 |
| D-09 / D-10 payouts | `payoutSchedule/payout-schedule`, `payoutReadinessPolicy/payout-readiness` | Payout runs |
| D-05 credit | `creditPolicy/business-credit` | Credit v2 |
| D-04 project discounts | `projectDiscountPolicy/project-discount` | Trade checkout v2 project tiers |
| D-17 adjustments | `ledgerPolicy/ledger-adjustment-threshold`. Until it's approved, every adjustment needs two admins. | Ledger adjustments |
| D-14 operator details | Propose `operatorDetails/operator` (legal name, support email and address, jurisdiction, privacy URL, effective date). Then approve it, then **Publish creator, referral, trade and privacy terms** under Partners & payouts. | Program terms and enrollment |

## Step 2. Catalog (gate 1)

1. Reconcile the current import manifest and existing records first. Do not reimport the already-staged 803 products merely to activate them. Under **Catalog & import**, upload `Zuo-Draft-Import.json` and run **Dry run**. For the historical reconciled snapshot only, tick "Require the reconciled package counts" and require 865 / 803 / 306 / 135 / 296 / 66 / 62 / 226 / 639. For a genuinely new package, leave that historical-count option unticked and reconcile every dry-run count against the new package’s manifest. If the column names differ, add aliases in `lib/zuoImport.ts`, never edit the source file. Then run **Commit**.
2. Pick the pilot cohort: one single item, one multi-piece pack, one décor or lighting item, one Ground shipment and one manually quoted LTL item. For each one:
   1. Verify its source-bound images using the reviewed ingestion/verification workflow and record revision-bound stock with `catStock.recordEvidence`. Preserve warehouse, pack/unit basis, source date and whether the quantity is on-hand or available-to-sell; the legacy binary stock setter is not a substitute.
   2. Resolve evidence-backed cost, stock and policy holds. If the draft was excluded solely for temporary unavailability, first record current confirmed available-to-sell stock evidence, then use **Restore restocked draft** in **Product review and publication**. On-hand quantity alone does not qualify. After restoration, verify the selected canonical identities, then complete manual review only after all other gates pass. A generic review note is not a substitute for missing evidence.
   3. Run pricing (`catPricing.recomputeVariants`).
   4. Advance it through each stage.
3. Turn on `CATALOG_PUBLICATION_V2_ENABLED=true`, then publish the pilot products by name. Publishing takes at most 50 products per call and never works "by count".

### Bed-frame category verification after PR349

The classification rule changes proposals; it does not rewrite existing metadata. The November 22 production readback confirmed these three Salisbury Queen Platform Bed Frame records already have `commissionCategory: furniture`, with only `MANUAL` in their metadata holds and no `CATEGORY_REVIEW` hold:

- `qn7cxz4r71qr54kb601hab0mpx8htg58`
- `qn7cphnwgkphrk2yk2x65nrtr98hvs4p`
- `qn74xgkxhqqazcgngj5snmsa658hvknn`

No reclassification write is needed for that verified state. After deployment, rerun the read-only category audit and confirm the proposals now agree with the stored furniture category. Preserve the MANUAL hold and all other eligibility gates; this correction does not publish products, activate checkout or alter earned commissions. If later records actually contain `review_required`, review their identity first and use the authenticated `catCategories.commit` workflow, then read back the stored category and CATEGORY_REVIEW hold. Never assume a proposal mismatch means the stored category needs changing.

The production evidence is retained under `outputs/production-access-audit-20261122/category-review/meta-readback.json` outside the repository.

## Step 3. Flags, in order

Inventory source corrections precede activation. Zuo's on-hand feed can withdraw an older availability claim, but does not establish available-to-sell quantity. Explicit zero in both CA and FL means unavailable; missing counts, positive physical counts and conflicting same-time files remain unverified. A strictly newer verified stock check can supersede the feed. Discontinued variants still require the existing reviewed restoration path.

For evidence already imported, use the deployment-admin `catEvidence:supplierSourceSnapshot` read and `catEvidence:reconcileZuoAvailability` dry run with the exact returned inventory observation and stock revision IDs. Review the results, then commit the same rows and read them back. A changed observation/revision rejects the request. This correction is bounded to 20 named variants, preserves the original supplier files, and audits changed availability/holds. It never enables products or changes prices. Ordinary future source reconciliation applies the same conservative rule; older source-effective dates cannot replace newer cost or inventory evidence.

| # | Flag(s) | Requires |
| --- | --- | --- |
| 1 | `CATALOG_PUBLICATION_V2_ENABLED` | Gate 1 |
| 2 | `DELIVERY_AUTOMATION_ENABLED`, then `RETAIL_ZUO_CHECKOUT_ENABLED` | Gates 1–4. Stripe webhook must be subscribed to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. |
| 3 | `CREATOR_ENROLLMENT_V2_ENABLED`, `ATTRIBUTION_V2_ENABLED` | Gates 2–3. Terms published (D-14). |
| 4 | `HOLM_TRADE_ONLY_ENABLED`, `TRADE_CHECKOUT_V2_ENABLED` | Gates 2–3. BC1 and BC9 approved by the owner. |
| 5 | `COMMISSION_ACCRUAL_V2_ENABLED`, then `RETAIL_LINK_GENERATION_V2_ENABLED` | Gates 2–5. Links stay off until accrual is on. |
| 6 | In a quiet window: review and commit each `creditSnapshot` page with its returned `sourceHash` supplied as `expectedSourceHash`; require complete passing `runLedgerParity`, then set `CREDIT_V2_ENABLED` | Gates 2–5, D-05 |
| 7 | First review and commit each `ledgerSnapshot` page with its source hash and require complete passing `runLedgerParity`. Cutover: set `PAYOUT_EXECUTION_ENABLED=true` **and** `PARTNER_PAYOUTS_ENABLED=false` in the same change. The hourly `sync-legacy-ledger` job then mirrors every legacy commission into the v2 ledger and keeps later changes in step; check the complete `v2Migrations:runLedgerParity` report | Gate 5, D-09, D-10. Stripe webhook must also be subscribed to `charge.dispute.closed` and `transfer.reversed`, and the Connect endpoint to `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated`. |
| — | `EDI_ZUO_ENABLED` | Stays off. It needs a real transport and onboarding first (D-11). |

After each step:

- Watch **Health & alerts** for 24 hours.
- Verify the real customer journey read-only.
- Record the result in [evidence-log.md](evidence-log.md).

To roll back, turn the flag off. Paid orders, tracking and obligations keep working (OPS01).

## Step 4. Remaining access and owner decisions

- Use the already-downloaded private Zuo package and dated evidence first. Ask for a missing source only when it cannot be verified from those files or authorized connected sources.
- Resolve only outstanding decisions in Step 1; do not repeat approvals already provided.
- Normal authenticated HOLM sign-in, Trade Hub and House management access were verified November 23. Authenticated checkout and program lifecycle acceptance remain separate checks. Restore Zoho access when available; do not treat the browser sign-in result as supplier-email verification.
- Authorize any Stripe test or live payment, transfer or payout check. The agent build makes none, and those scenarios are recorded as BLOCKED in the evidence log.
- Production environment changes are within the standing rollout authorization once their readiness gates pass. Do not activate financial execution or unsupported checkout paths merely to remove a visible blocker.
- Name an owner for each runbook (05 §4).

### Atomic delivery policy release

The decision register can release 1–20 selected delivery proposals in one transaction. The approver reviews their displayed values and enters a release note. Select only one latest version per kind/key; scheduled future proposals must use the existing individual approval path. A changed, rejected, stale, or expired carrier record causes the entire release to fail without partial approval or audit events. Each successful approval records the authenticated actor and a common effective timestamp.

This action does not activate feature flags, approve catalog evidence, qualify tax setup, change supplier rights, or grant payout permissions. Only delivery rules, ladder, carrier rates, controls, monitoring, and estimate policy are eligible. Renew dated freight evidence before approving an expired model. The same expiration check also applies to individual carrier approval.


### Financial migration review and integrity

For each financial page, call `ledgerSnapshot` or `creditSnapshot` with `dryRun: true` and the current cursor. Review counts, missing identities and source evidence. Submit that same cursor with `dryRun: false` and `expectedSourceHash` equal to the returned `sourceHash`. A changed source, ownership or opening state rejects the whole page transaction. Use the returned continuation cursor until `isDone`. Bulk `runBackfills` commits are restricted to additive identity; financial dry runs remain supported. Do not bypass a source mismatch by guessing a hash. Review a fresh dry run.

Financial scans read one extra row at each limit and refuse incomplete scopes: 2,000 legacy credit rows or account credit events, 5,000 legacy commissions or beneficiary obligations, 100 active legacy credit holds, and 200 linked sync/dispute events per commission. Larger histories need a separately reviewed reconciliation; their partial totals never qualify for cutover. Cursor cycles or the 10,000-page driver limit are errors, with a last cursor for review. Previously committed pages remain committed if a later page fails. Backfill `complete` means traversal finished; missing/ambiguous counts and notes still require resolution.

Negative legacy balances and underfunded holds require explicit reconciliation; never clamp them to zero or create funding to carry a hold. New credit openings carry an immutable source fingerprint. A retry checks the complete legacy source, exact active hold references and amounts, and the complete event replay against available, reserved, pending and lifetime-issued projections. Legitimate native v2 activity is replayed separately from the legacy opening. Old openings without source provenance require explicit reconciliation; preserve them and their audit history. Never patch ledger events to add invented provenance.

Commission synchronization includes prior source-linked offsets/restorations. New transition keys permit the same target amount after an intervening restoration while duplicate delivery remains a no-op. Corrections reverse unpaid positive obligations first; paid amounts retain their original amounts/rates/state and later reductions become visible offsets. Pending restorations remain pending. A disputed restoration requires resolution before new earnings can clear. Source scans flag deleted/missing legacy owners instead of silently omitting their money rows.

Acceptance uses local synthetic records only: reduction/restoration cycles, old-format offsets, negative adjustments, incomplete histories, credit-only users, native credit activity, stale source commits, malformed holds, missing owners and pagination failure cases. These tests do not authorize or establish a real/test payment, payout, bank transfer or production financial migration.


### Bounded financial transactions and dispute evidence

Credit snapshot and user-account parity pages process one user per transaction. An existing credit opening reuses the already-read source evidence. The 100-hold limit bounds reference checks and opening-event writes; larger hold sets require explicit reconciliation before an automatic opening. Financial page cursors remain resumable and each committed page retains its reviewed source hash.

Commission amount/ownership checks run in global subpages of ten legacy commissions, separately from each user's bounded account/count checks. This traverses every user's entire commission history without opening thousands of sync-history index ranges inside one transaction. `runLedgerParity` reports completion only after user, commission and orphan-credit passes finish. `ledgerParity` alone is an account/count page, never full monetary parity. Synchronization writes at most two legacy commissions per scheduled transaction, then schedules its continuation.

These work units leave headroom under [Convex transaction limits](https://docs.convex.dev/production/state/limits): the largest user account pass reads fewer than 15,000 bounded records; a commission evidence page reads fewer than 5,000 with fewer than 2,100 index/get operations; a credit opening has at most 100 hold events. Oversized individual histories still fail closed. Exceptional document sizes or platform failures do not produce a passing report.

A full refund of a held commission now preserves `held` with zero remaining amount. An explicit won/lost resolution records its immutable event and then leaves a fully reversed original void. Restoration consults the original append-only dispute events, legacy commission dispute flag and payment-state record; an open or lost dispute blocks positive restoration even for an older original already marked void. Old void records with an unresolved event require explicit reconciliation; changing the legacy amount or projection state alone cannot authorize payment. Immutable hold/release/lost history is retained.


### Business-referral award reconciliation

Each new pending award records its accepted configuration ID, version and merchandise minimum. The amount and clearing date remain on the immutable source event. Later policy changes must not retroactively qualify or disqualify that award. An older event without accepted terms requires review, never guessed terms or automatic release.

Before clearing, reconcile complete order lines and completed return allocations. Cancelled orders, full payment refunds, and merchandise retained below the original minimum cancel a pending award. A verified refund or completed return also reconciles an already-cleared award. Revoke each exact source award once: remove available credit first and record spent/reserved amounts as an offset against future credit, preserving history. Administrative reversals select the original award event and a reason; they cannot choose an arbitrary owner or amount. They require existing finance/admin authorization.

A partial payment refund does not establish which merchandise, delivery or tax was refunded. Use conservative qualifying-value bounds; when these straddle the threshold, open an admin review and pause new credit spending for the account. Keep its ledger balance/history and already-held checkout reservations intact. The checkout and partner hub explain the hold; cash checkout remains available. Recorded return evidence resolves the review or revokes the award. Closing a generic review item alone cannot override the underlying financial evidence.

The hourly clearing walk processes one pending source event per transaction with a fixed cutoff and scheduled continuation. It traverses settled history instead of repeatedly taking the first 100 rows. Order-line and return-history limits are 100 each; incomplete histories require review. Award lookup per order is bounded and multiple awards on one order require reconciliation. Invalid or inconsistent payment amounts are rejected; older cumulative refund notifications cannot decrease confirmed refunds. The credit feature flag still gates new issuance and clearing. No payment, payout, supplier order, program activation or production financial migration is part of this release.

Regression acceptance includes fully/partially refunded pending and cleared awards, duplicate/reordered refund notifications, source-bound manual reversals, spent-credit offsets, missing accepted terms/lines, original-policy preservation, cancelled orders, disabled clearing, visible review holds, and traversal past 100 settled awards. Local synthetic verification does not establish the restricted external financial lifecycle.


Partial supplier cancellations also reconcile awards immediately while other lines remain payable/shippable. Cancelled-line original amounts still reconcile to original order totals, but their merchandise contributes zero to the award threshold. Opening or resolving a credit review invalidates both accepted and in-flight checkout estimates; a fresh total is required without clearing the customer's address. Regression tests cover pending and already-cleared partial cancellations, repeated cancellation requests, and the credit-to-cash review flow without invoking payment.

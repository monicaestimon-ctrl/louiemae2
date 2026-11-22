# 06. Release checklist: what is live, and what turns each v2 feature on

The initial Phase G+H implementation is merged, but that is not end-to-end operational acceptance. Use the dated production evidence and current feature flags to establish what is actually active. The remaining catalog, delivery, authenticated-journey and financial gates below must be checked against current production records.

After a successful main build, CI deploys Convex, adds missing configuration records, runs the additive identity backfill and samples ledger parity. That CI step calls `ledgerParity` once, checks at most 25 beneficiaries, returns a continuation cursor and is allowed to fail without failing the job. Before cutover, follow every cursor page, verify all results and resolve failures; a green CI job is not complete parity evidence. Ledger and credit cutovers are separate controlled operations; CI does not automatically perform them.

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

### Bed-frame category correction after PR349

The classification rule changes proposals; it does not rewrite existing metadata. After deployment, inspect the three reviewed Salisbury Queen Platform Bed Frame records:

- `qn7cxz4r71qr54kb601hab0mpx8htg58`
- `qn7cphnwgkphrk2yk2x65nrtr98hvs4p`
- `qn74xgkxhqqazcgngj5snmsa658hvknn`

Confirm their current names/categories still describe complete beds and their proposals are `furniture`. Through the authenticated category admin workflow (`catCategories.commit`), apply `furniture` to those exact product IDs with a recorded review reason. Read back all three `catProductMeta` records and confirm `commissionCategory: furniture` and removal of `CATEGORY_REVIEW`; retain every other hold. Preserve historical commission category/rate/amount and do not publish or activate checkout as part of reclassification. If identity, proposal or metadata changed, stop that record for review.

This rollout is pending until the authenticated write and production readback are recorded. A successful code deployment or a corrected proposal alone does not complete it. The production audit is retained under `outputs/production-access-audit-20261122/category-review` outside the repository.

## Step 3. Flags, in order

| # | Flag(s) | Requires |
| --- | --- | --- |
| 1 | `CATALOG_PUBLICATION_V2_ENABLED` | Gate 1 |
| 2 | `DELIVERY_AUTOMATION_ENABLED`, then `RETAIL_ZUO_CHECKOUT_ENABLED` | Gates 1–4. Stripe webhook must be subscribed to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. |
| 3 | `CREATOR_ENROLLMENT_V2_ENABLED`, `ATTRIBUTION_V2_ENABLED` | Gates 2–3. Terms published (D-14). |
| 4 | `HOLM_TRADE_ONLY_ENABLED`, `TRADE_CHECKOUT_V2_ENABLED` | Gates 2–3. BC1 and BC9 approved by the owner. |
| 5 | `COMMISSION_ACCRUAL_V2_ENABLED`, then `RETAIL_LINK_GENERATION_V2_ENABLED` | Gates 2–5. Links stay off until accrual is on. |
| 6 | In a quiet window: run `npx convex run v2Migrations:runBackfills '{"commit":true,"only":["credit"]}'`, then immediately set `CREDIT_V2_ENABLED` | Gates 2–5, D-05 |
| 7 | Cutover: set `PAYOUT_EXECUTION_ENABLED=true` **and** `PARTNER_PAYOUTS_ENABLED=false` in the same change. The hourly `sync-legacy-ledger` job then mirrors every legacy commission into the v2 ledger and keeps later changes in step; check `v2Migrations:ledgerParity` | Gate 5, D-09, D-10. Stripe webhook must also be subscribed to `charge.dispute.closed` and `transfer.reversed`, and the Connect endpoint to `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated`. |
| — | `EDI_ZUO_ENABLED` | Stays off. It needs a real transport and onboarding first (D-11). |

After each step:

- Watch **Health & alerts** for 24 hours.
- Verify the real customer journey read-only.
- Record the result in [evidence-log.md](evidence-log.md).

To roll back, turn the flag off. Paid orders, tracking and obligations keep working (OPS01).

## Step 4. Remaining access and owner decisions

- Use the already-downloaded private Zuo package and dated evidence first. Ask for a missing source only when it cannot be verified from those files or authorized connected sources.
- Resolve only outstanding decisions in Step 1; do not repeat approvals already provided.
- Restore Zoho and authenticated production-browser access when available; these acceptance checks are deferred, not completed.
- Authorize any Stripe test or live payment, transfer or payout check. The agent build makes none, and those scenarios are recorded as BLOCKED in the evidence log.
- Production environment changes are within the standing rollout authorization once their readiness gates pass. Do not activate financial execution or unsupported checkout paths merely to remove a visible blocker.
- Name an owner for each runbook (05 §4).

### Atomic delivery policy release

The decision register can release 1–20 selected delivery proposals in one transaction. The approver reviews their displayed values and enters a release note. Select only one latest version per kind/key; scheduled future proposals must use the existing individual approval path. A changed, rejected, stale, or expired carrier record causes the entire release to fail without partial approval or audit events. Each successful approval records the authenticated actor and a common effective timestamp.

This action does not activate feature flags, approve catalog evidence, qualify tax setup, change supplier rights, or grant payout permissions. Only delivery rules, ladder, carrier rates, controls, monitoring, and estimate policy are eligible. Renew dated freight evidence before approving an expired model. The same expiration check also applies to individual carrier approval.

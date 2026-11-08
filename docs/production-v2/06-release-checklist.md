# 06. Release checklist: what is live, and what turns each v2 feature on

As of the Phase G+H merge, all of the v2 code is merged to `main` and deployed to production by CI (`deploy-convex`). After each deploy, CI also:

- seeds the configuration registry (adding missing records only),
- runs the identity, ledger and credit backfills (idempotent, adds rows only), and
- prints the ledger parity check.

**Every v2 customer and money path is still switched off.** Turning each one on is an owner action, done in the order below and only after the matching gate in [05 §2](05-release-decisions-runbooks.md) is signed. None of these steps needs a code change.

All approvals happen in **Admin → Commerce v2 → Operations & decisions**. All flags are set in the **Convex dashboard → Settings → Environment variables** for the production deployment.

## Step 1. Decisions to approve (decision register)

Each item below is a seeded `proposed` record, unless it says to propose one first. Approve it only once the owner named in 05 §1 has agreed.

| Decision | Record(s) to approve | Unblocks |
| --- | --- | --- |
| D-16 freshness and estimate validity | `freshnessPolicy/freshness-default`, `estimatePolicy/estimate-policy` | Sellability checks, estimates |
| D-03 delivery processing and freight | `deliveryLadder/delivery-ladder`. Then propose and approve `carrierRule/zuo-freight` with real carrier zones, rates and per-state tax rates. The seeded version is empty, so every quote is quote-required until then. | Zuo delivery estimates |
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

1. Under **Catalog & import**, upload `Zuo-Draft-Import.json` and run **Dry run** with "Require the reconciled package counts" ticked. The counts must be 865 / 803 / 306 / 135 / 296 / 66 / 62 / 226 / 639. If the column names differ, add aliases in `lib/zuoImport.ts`, never edit the source file. Then run **Commit**.
2. Pick the pilot cohort: one single item, one multi-piece pack, one décor or lighting item, one Ground shipment and one manually quoted LTL item. For each one:
   1. Verify its images (`catMedia.ingest` and `catMedia.verify`) and record stock (`catStock.recordStock`).
   2. Resolve its holds in the cost and policy queue.
   3. Run pricing (`catPricing.recomputeVariants`).
   4. Advance it through each stage.
3. Turn on `CATALOG_PUBLICATION_V2_ENABLED=true`, then publish the pilot products by name. Publishing takes at most 50 products per call and never works "by count".

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

## Step 4. Things only the owner can do

- Supply the Zuo package files (README §4). They are not in the repository.
- Approve the decisions in Step 1. This build approves none of them.
- Authorize any Stripe test or live payment, transfer or payout check. The agent build makes none, and those scenarios are recorded as BLOCKED in the evidence log.
- Set the production environment variables.
- Name an owner for each runbook (05 §4).

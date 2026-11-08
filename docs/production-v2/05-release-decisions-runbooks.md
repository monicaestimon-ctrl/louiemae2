# 05. Decision register, release gates, flags rollout, monitoring and runbooks

## 1. Decision register

Each unresolved decision blocks only the feature or SKUs it affects. Build the feature anyway with the proposed default as a `proposed` config record, and keep the dependent public promise disabled until the owner approves it in the admin decision register (S35).

| ID | Decision | Proposed disposition (v2 PDF) | Release impact | Owner | Config key | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | Operating floor for the 135 MAP-based candidates | Hold automatic sale until a per-SKU floor is approved. Don't infer 5% or 20%. | Affected SKUs only | Operations + finance | `zuo-map-floor-pending` and per-SKU `catVariantPolicies` | Open |
| D-02 | Zuo policy and rights scope | Record written MAP, trade, coupon, private-label and media evidence | Affected listings or discount mechanisms | Operations | `catSupplierPolicies` (zuo) | Open |
| D-03 | Cost reserves and actual fees | Keep the stated planning reserves. Verify fixed fees, duties and fulfillment, and replace unknowns. | Affected variants and checkout | Finance | `zuo-pricing-assumptions-v1` | Provisional |
| D-04 | Project discount thresholds and basis | §18 proposed: 3% at $10,000, 5% at $25,000, not both | Trade project pricing | Owner | `project-discount-v2` | Open |
| D-05 | Business credit dual reward and review rules | Adopt the §19 defaults and finalize terms | Credit activation | Owner + finance | `business-credit-v2` | Open |
| D-06 | Tier timing and window shape | Adopt §15 as versioned defaults: 00:15 Chicago, the preceding 12 calendar months, crossing earns the pre-purchase tier | Referral activation and public promises | Owner | `tier-policy-v2` | Open |
| D-07 | Tier downgrade | The November 3 owner decision (quarterly, one tier at a time) against v2 recomputation on events and daily. Keep the November 3 rule until the owner decides. | Tier promises | Owner | `tier-policy-v2.downgrade` | Open |
| D-08 | Service and returns promise | Start with validated curbside service and complete the supplier-specific return and damage policy | Checkout activation | Operations | `zuo-95206-curbside-v1`, `returnPolicy` | Open |
| D-09 | Payout schedule | 09:00 Chicago on the 15th, cutoff 23:59:59 Chicago on the 14th. Reconcile with the existing 17:11 UTC run. | Payout execution | Finance | `payout-schedule-v2` | Open |
| D-10 | Tax and payout readiness policy | One policy for manual and automatic routes (W-9 against what Stripe collects) | Payout execution | Finance | `payout-readiness-v1` | Open |
| D-11 | Zuo EDI onboarding | Establish transport, formats, units and workflows before building the production adapter | EDI only (off this release) | Operations | n/a | Deferred |
| D-12 | Delivery for a mixed Zuo and Ashcroft cart | Ashcroft's existing per-item charge plus the Zuo ladder charge, shown as one line with a group breakdown | Mixed-cart checkout | Owner + operations | `deliveryRule` (mixed) | Open |
| D-13 | Referral storage with unknown consent | Legal decides whether first-party attribution storage is allowed with no consent signal | Attribution v2 | Legal | `attribution-v2.consent` | Open |
| D-14 | Operator, privacy, tax and payout terms | Supply the legal business identity, support address, effective dates and jurisdiction and privacy links, with a qualified review | Program terms and public enrollment | Owner + legal | `prgTermsVersions` | Open |
| D-15 | Payment verification and funding | Keep the restrictions. Get the needed permitted verification and a documented funds plan. | All financial functions | Owner + finance | n/a | Open |
| D-16 | Estimate validity and freshness defaults | 30-minute estimates. Stock synced every 24h. Cost and MAP at most 7 days old. | Checkout | Operations | `estimate-policy-v1`, `freshness-default-v1` | Open |
| D-17 | Large manual adjustment threshold | $250 or more needs a second confirmation | Admin ledger | Finance | `ledger-adjustment-threshold` | Open |

## 2. Release gates (v2 PDF §25)

| Gate | Requirement | Evidence |
| --- | --- | --- |
| 1 | Operations and finance sign off source and economics for the chosen pilot: documented rights and MAP, current availability, complete costs and media, approved prices and delivery services | Signed decision rows D-01 to D-03, D-08 and D-16. Parity report. |
| 2 | QA evidence for the relevant flows, including failure, retry and security behaviour | Every relevant 04 row PASSED, or BLOCKED with the reason accepted by the owner |
| 3 | Final public terms, privacy and operator details, and support and returns content | D-14 approved. S37 merged. |
| 4 | Deployment revision, migration backup, monitoring and a rollback rehearsal | S00 snapshot, S39 alerts live, S40 rollback rehearsal recorded |
| 5 | Permitted payment, onboarding and webhook evidence, and funding readiness for every enabled financial function | D-15 resolved. PAY, CRE and LED rows PASSED in an authorized environment. |

## 3. Flag rollout order

The order is: deploy disabled code, migrate additively, dry-run imports, inspect pilot listings, enable the permitted pilot flows, verify the real configuration and read-only customer journeys, then expand only after review.

1. `CATALOG_PUBLICATION_V2_ENABLED`, for the pilot cohort only (gate 1).
2. `DELIVERY_AUTOMATION_ENABLED` and `RETAIL_ZUO_CHECKOUT_ENABLED` (gates 1–4).
3. `CREATOR_ENROLLMENT_V2_ENABLED`, `RETAIL_LINK_GENERATION_V2_ENABLED` and `ATTRIBUTION_V2_ENABLED` (gates 2–3).
4. `HOLM_TRADE_ONLY_ENABLED` and `TRADE_CHECKOUT_V2_ENABLED` (gates 2–3, with BC1 and BC9 approved).
5. `COMMISSION_ACCRUAL_V2_ENABLED` (gates 2–5).
6. `CREDIT_V2_ENABLED` (gates 2–5, D-05).
7. `PAYOUT_EXECUTION_ENABLED` last (gate 5, with D-09 and D-10). Turn off `PARTNER_PAYOUTS_ENABLED` in the same change.

Don't promise commissions or payouts before the matching lifecycle is verified. Where money-moving verification is unauthorized or incomplete, keep that feature disabled and report the specific unmet gate.

## 4. Runbooks (each has a named owner)

Fill in the owner name before gate 4. Each runbook covers: trigger, first response, customer communication, resolution and evidence.

| Runbook | Trigger | Required behaviour | Owner |
| --- | --- | --- | --- |
| Cost or MAP conflict | `COST_CONFLICT` or `MAP_POLICY_REVIEW` hold opened on a live variant | Unpublish the affected variant through S15. Paid orders go on. Review in the S35 cost queue. | _TBD_ |
| Broken image | Media verification fails or a derivative 404s | Listing back to draft. Never a blank published card. | _TBD_ |
| Carrier outage | The live quote adapter fails | Fall back only to a still-valid supported estimate. Otherwise the order is quote-required. | _TBD_ |
| Paid but unavailable item | `ordPaidExceptions` `stock_failed` | Contact the customer and offer a choice. Never substitute or cancel silently. | _TBD_ |
| Damage claim | Customer report | Collect evidence within the supplier claim deadline (S22 policy) | _TBD_ |
| Attribution complaint | Partner disputes a missing credit | Investigate from `prgReferralClicks` and the attribution snapshot (S35). Any correction is a ledger adjustment with a reason. | _TBD_ |
| Disputed order | `charge.dispute.created` | Commission held (S29). Evidence submitted. Restored once if the dispute is won. | _TBD_ |
| Credit reversal | Refund after an award | Reverse unspent credit, or create a visible offset (S31) | _TBD_ |
| Uncertain payout | A transfer attempt is `uncertain` | Reconcile with Stripe before any retry (S30). Never pay twice. | _TBD_ |
| Payment or webhook outage | `sysPaymentEvents` backlog over 15 minutes | Obligations are kept and retried durably. If needed, turn off new checkout and referrals without stopping service for orders already paid. | _TBD_ |

## 5. Definition of done (v2 PDF §25)

Every enabled customer and partner path works on the recorded production revision. Every live variant passes its gates. Prices and ledgers reconcile to the accepted snapshots. Operations can fulfill, refund and resolve exceptions. Monitoring and rollback work. Terms match the behaviour. Evidence is attached. A workbook, a successful build, a deployed page or a configured secret does not on its own meet this definition.

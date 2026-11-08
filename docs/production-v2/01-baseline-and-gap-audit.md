# 01. Current code baseline and required changes

Baseline: this repository at commit `0845358` (branch `claude/sleepy-bell-dzn2pf`, November 8, 2026). The v2 PDF §28 audit was a read-only audit of another worktree (commit `c187a96…`). Its file and line references match this repository closely. Where this repository differs, the difference is noted. This is a source reading, not a check of the deployed commit, live flags, Stripe endpoints or balances.

## 1. Architecture summary

| Layer | Where | Notes |
| --- | --- | --- |
| Retail storefront (Louie Mae) | `App.tsx`, `components/**`, `components/cart`, `components/checkout` | Hash-routed SPA. Creator Hub at `#creators` (`components/CreatorHub.tsx`). |
| Trade site (HOLM) | `trade/app.ts` (~3,900 lines, `htm` + React), `trade/catalog.ts`, `trade/style.css` | Same origin, `/trade`. Admin tabs for partners, pricing and exclusions live here (`api.holmAdmin.*`, `api.holm.adminPricing`). |
| Backend | `convex/*.ts`, schema in `convex/schema.ts` (imports `commerceTables`, `holmTables`, `furnitureTables`) | Convex 1.31.7, `@convex-dev/auth`. Mutations are serializable transactions. |
| Payments | `convex/http.ts` (`/stripe/checkout`, `/stripe/webhook`), `convex/commerceStripe.ts` (invoices), `convex/holmConnect.ts` and `convex/holmPayouts.ts` (Connect transfers) | Stripe SDK `stripe@20`. |
| Pure rules | `lib/holmPartners.ts`, `lib/holmPricing.ts`, `lib/holmDelivery.ts`, `lib/retailLaunch.ts`, `lib/partnerLink.ts`, `lib/commerce.ts`, `lib/pricing.ts` | Unit-tested with Vitest. |
| Jobs | `convex/crons.ts` | UTC schedules only. |
| Tests | Co-located `*.test.ts(x)`, Vitest with jsdom, `convex-test@0.0.38` | CI: lint, type-check, strict Convex tsc, catalog-writer check, tests, build; then deploys Convex on `main`. |

## 2. Module-by-module audit

Each row gives what the code does today and what the v2 PDF requires, with the step that makes the change.

### 2.1 Identity and membership

| File / symbol | Today | Required change | Step |
| --- | --- | --- | --- |
| `convex/holmAccess.ts` `viewer`, `isVerified`, `isPartner`, `isAdmin` | One Convex Auth user. `holmProfiles` holds trade status (`tradeStatus`) and partner status (`partnerStatus: 'active'`) side by side. Admin comes from the CJ admin allowlist. | Keep one login. Add explicit `programMemberships` (creator, trade) with independent states, `organizations` and `organizationMembers` (owner, purchasing member, read-only collaborator), `partnerBeneficiaries` (one payout identity and one tier per beneficiary), and versioned `termsAcceptances`. `viewer()` returns these. Keep the old fields readable. | S05, S24 |
| `convex/holmPartners.ts` `join` (line ~24) | Authenticated checkbox (`acceptTerms`) activates a partner, assigns `refCode` and starts at the base tier. No terms version, no email verification, no abuse checks. | Creator flow: email verified → profile/social/site → terms (versioned) → automated basic abuse checks → `active` or `review`. Trade flow stays separate. Store `termsVersion` and acceptance time. Duplicate enrollment resolves to the existing identity. | S24 |
| `components/CreatorHub.tsx` (~355 lines, join around line 138) | Join UI, links, earnings. | Complete onboarding states, and empty, loading, failed, unavailable and suspended states. | S24, S33 |
| `convex/holm.ts` `applyTrade`, `reviewApplication` | Trade application and review (`approved`, `rejected`, `needs_info`). | Keep. Move status into the trade `programMembership`. Add organization creation on approval and an optional referral-terms activation that is a separate step from approval. | S24 |

### 2.2 Links and attribution

| File / symbol | Today | Required change | Step |
| --- | --- | --- | --- |
| `lib/partnerLink.ts` `pieceShareUrl` (~line 116), `partnerPageUrl` (~line 128) | Builds `/trade#p/<id>?ref=` links for House pieces and `?ref=CODE&ch=` links for any louiemae.com page. Code and visitor id are stored in `localStorage` (`hol:ref`, `hol:visitor`). | Retail links always point at the **published Louie Mae retail variant** through a `retailMappings` row, even when generated inside HOLM. Add opaque link ids (`/r/<linkId>`) that the server resolves. Separate *Copy retail referral link*, *Share trade project* and *Invite a business* actions. With no mapping, the link shows a clear unavailable state. | S26 |
| `convex/holmPartners.ts` `insertClick`, `recordClick` | One click row per visitor per partner per day (the first visit). Code checked against active partners. | One `referralClicks` row per eligible click, with an opaque click id, beneficiary, membership source, consent state, terms and rate version, rate-protection snapshot and exact expiry (`at + 30×24h`). Filter bots and internal self-navigation. Rate-limit per visitor. | S27 |
| `convex/holmPartners.ts` `resolveAttribution` (~line 91) | Last click in 30 days for the code the browser sends. Cross-device through `holmProfiles.refVisitorId`. Self-referral blocked by user id or email. | Resolve the latest eligible click across all partners for the visitor or authenticated identity (not only the code sent), with an exact `expiresAt` boundary. Self-referral checks use identity, organization ownership and risk indicators; a shared address only creates review. Return an attribution snapshot id. | S27 |

### 2.3 Catalog and checkout

| File / symbol | Today | Required change | Step |
| --- | --- | --- | --- |
| `convex/retailLaunch.ts` `storefrontPage`, `catalog` (~line 11) and `createSnapshot` (~line 54) | Retail catalog and checkout reject every provider except Ashcroft. Prices come from `launchPrice()`. Delivery is a per-item allowance from `retailDelivery()` matched by category and name regex. Three SKUs are hard-coded as unavailable. | Generalize to a checkout service that accepts any provider whose supplier-specific readiness, availability and fulfillment rules pass (Zuo added explicitly). An import alone can't make a product orderable. Move Ashcroft's per-item rule into a versioned `deliveryRuleVersions` record (`ashcroft-launch-v1`) without changing amounts. Replace hard-coded SKU holds with `variantHolds`. | S15, S17, S19 |
| `lib/retailLaunch.ts` `launchPrice`, `retailDelivery`, `supplierAvailable` | Ashcroft launch pricing and delivery. | Keep as Ashcroft's approved rule, referenced by version id. Do not apply it to Zuo. | S17 |
| `convex/commerceTables.ts` `provider` union `cj`/`ashcroft`/`owner_managed`; `variant.cost` (a source-currency decimal), `variant.retail` and `variant.commercial` (cents) | Product draft holds variants inline. Listings snapshot the variants. | Add the `zuo` literal (a widening). Add normalized `catVariants`, `cartons`, `costRevisions`, `priceRevisions` and related tables that reference `commerceProducts`. For Zuo, `draft.variants` and listing snapshots are **projections** generated from the normalized tables. | S04, S09 |
| `convex/commerce.ts` `publish`, `unpublish` | Publishes shared listings, gated by the `COMMERCE_PUBLISHING_ENABLED` env var. | Add the publication state machine and server gates (cost, MAP, availability, cartons, media, rights, mapping, margin). Publishing is refused with a typed error when any gate fails. | S15 |
| `convex/http.ts` `/stripe/checkout` | Creates a `retailCheckouts` snapshot, an optional store-credit coupon and a Checkout session with a fixed shipping amount and `automatic_tax`. | Create an idempotent `checkoutIntents` row from a valid full-address estimate. Reserve inventory and credit. Freeze line, delivery and attribution snapshots. The session total must equal the accepted total. | S19 |
| `convex/http.ts` webhook `checkout.session.completed` | Checks signature and totals against the snapshot, creates an `orders` row, sends email, settles credit and creates the commission. | Process through a durable `paymentEvents` inbox (dedupe by event id). Create the parent order, then child supplier orders and allocations. Expired or stock-failed payments go to `paidOrderExceptions`. | S19, S21 |
| `convex/holm.ts` `requestQuote` (~line 486), `priceSelection` | Quote and project flow: approved trade users get trade pricing (`priceMode: 'trade'`), everyone else gets retail pricing (`priceMode: 'retail'`), and retail requests can earn commission. | Restrict HOLM purchasing to approved trade members, behind flag `HOLM_TRADE_ONLY_ENABLED`. Send retail buyers to Louie Mae. Turn off the HOLM retail-quote commission path for new requests and keep historical rows. | S25 |
| `convex/commerceProjects.ts`, `convex/commerceStripe.ts`, `convex/commerceFulfillment.ts` | Versioned commercial quotes, Stripe invoices, verified payment, fulfillment groups per provider. | Reuse for trade quotes. Add immutable accepted quote versions with expiry, delivery service, and MAP and margin checks on trade quote prices. Add Zuo groups to the manual dealer-order queue. | S20, S21 |

### 2.4 Commission, tiers, credit and payouts

| File / symbol | Today | Required change | Step |
| --- | --- | --- | --- |
| `lib/holmPartners.ts` `lineCommissions`, `MARGIN_GUARD_BPS = 4000` | Known-cost commission is capped at 40% of calculated profit. Unknown cost falls back to the base rate for the product type. | For newly enabled flows, remove routine hidden caps and fallbacks. Prequalify each SKU against the full schedule (furniture 18%, décor and lighting 12%, clothing 8%). If it fails, adjust price or allowance, approve a **visible** SKU exception schedule, or disable referral eligibility. Unknown cost means `COST_REVIEW_REQUIRED` and no referral eligibility. Historical earned terms stay as they are. | S28 |
| `lib/holmPartners.ts` `productTypeFor` | Infers furniture, décor or clothing by regex. Lighting maps to **furniture**. | Use an explicit commission category on the product (`furniture`, `decor`, `clothing`, `review_required`). Lighting moves to **décor** prospectively. Historical snapshots stay unchanged. | S08 |
| `convex/holmPartners.ts` `reconcile` (~line 472) and `storefrontCommission` (~line 636) | Retail commission is recorded per Stripe session. Retail-priced House projects also reconcile commission hourly. Tier is taken at payment time through `partnerTierAt`. | Freeze cost, eligibility and rate inputs with the accepted paid order (`orderSnapshots`, `attributionSnapshots`). Remove the future HOLM retail-quote commission path. Use the higher of the protected rate and the current rate. | S27–S29 |
| `convex/holmPartners.ts` `storefrontReversal` (~line 719), `applyPaymentState` | Refund and dispute reversal, early-event storage (`holmPaymentStates`), and adjustments after payout. | Keep the logic. Re-express it as append-only `commissionEvents` against immutable line snapshots, using cumulative-cent reconciliation per line. Add new credit rules. | S29 |
| `convex/holmPartners.ts` `updateTiers`, `updatePartnerTier`; `convex/crons.ts` `update-partner-tiers` (07:17 UTC daily) | Upgrades nightly. Downgrades once a quarter, one tier at a time. Admin override. | Recompute on qualifying paid, refund and dispute events, and daily at 00:15 America/Chicago (handling daily-saving time). Use the 12 preceding calendar months of UTC payment timestamps with explicit bounds. The purchase that crosses a tier earns the pre-purchase tier. Use a concurrency lock. Downgrade behaviour is decision **D-07**. | S28 |
| `convex/holmConnect.ts`, `convex/holmPayouts.ts` | Express onboarding, `PARTNER_PAYOUTS_ENABLED` flag, monthly claim with lease, idempotent transfer (`holm-payout:<payoutId>`), reconciliation of uncertain transfers by listing Stripe transfers. | Keep these safeguards. Add `payoutRuns`, `transferAttempts`, reservation per payable cent, a funding check, the cutoff and transfer versus bank-payout states. Do not replace the safeguards without a migration. | S30 |
| `convex/crons.ts` `partner-payouts` | Monthly on the 15th at 17:11 UTC. | 09:00 America/Chicago on the 15th, cutoff 23:59:59 America/Chicago on the 14th (daylight-saving aware). Proposed: decision **D-09**. | S30 |
| `convex/holmPartners.ts` `adminRecordPayout` (~line 444) | The manual payout record requires an approved W-9. The automatic transfer path checks Stripe readiness but not that W-9 gate. | Finance defines one tax and readiness policy (`payoutReadinessPolicy` config) and both routes enforce it. | S30 |
| `convex/http.ts` and payout handlers | A completed transfer is labelled **paid**. `payout.paid`, `payout.failed` and `transfer.reversed` are not handled. | Separate `transferred` (the Stripe transfer exists) from bank payout status (observed from connected-account `payout.*` events). Handle `transfer.reversed`. Reconcile provider events. | S30 |
| `convex/holmCredit.ts` | Ledger with `earned`, `reserved`, `used`, `released` and `restored` kinds. Atomic reservation through a ref. The hourly job settles stale holds. Referral award is in `holmPartners.reconcile` (verified business, paid order of $500 or more, no 30-day wait, no anti-double-reward). | Credit states pending award → available → reserved → redeemed → reversed → reinstated. Award 30 days after a qualifying payment and validation. Define a "new" business. One order can't earn both the award and a retail commission for the same beneficiary. Record liability and funding reserve. | S31 |
| `lib/holmPricing.ts` `HOLM_RULES` | Trade price is 25% off everything, held to a 25% margin floor. Project tiers add 3% at $10,000 and 5% at $25,000. | Use an explicit trade-discount schedule per supplier and SKU. Zuo gets 10% (or an approved 5% exception) and no project stacking. The general 25% is never applied to Zuo silently. | S32 |
| `lib/holmDelivery.ts` `DELIVERY_TIERS`, `FREIGHT_BY_PREFIX` | House flat delivery per order by subtotal, plus a freight allowance per Ashcroft prefix. | Keep for existing House and Ashcroft quotes (versioned). Zuo uses the v2 ladder engine. | S17 |

### 2.5 Ops and security

| Area | Today | Required change | Step |
| --- | --- | --- | --- |
| Feature gates | Env vars `COMMERCE_PUBLISHING_ENABLED`, `COMMERCE_INVOICES_ENABLED`, `PARTNER_PAYOUTS_ENABLED`, `CJ_AUTO_*`, `BACKGROUND_MONITORING_ENABLED` | One `lib/flags.ts` registry covering the nine flags the v2 PDF names (02 §5), all read on the server and defaulting to off. | S02 |
| Webhooks | Signature verified, with a separate Connect secret. `shouldAllowUnsignedStripeWebhook` exists for local development. | Add a persistent event inbox with dedupe on `event.id`. Process out-of-order events. Monitor backlog. Make sure unsigned mode can never be enabled in production. | S19, S38 |
| Admin | Allowlist `CJ_ADMIN_EMAILS` / `ADMIN_EMAILS` | Add privileged-action confirmation for payout-beneficiary changes and large manual adjustments, and audit every privileged read and write. | S38 |

## 3. Behaviour changes against the November 3 program (need owner sign-off before switching)

| # | Behaviour today (Nov 3 spec, built) | v2 rule | Switch mechanism |
| --- | --- | --- | --- |
| BC1 | Retail-priced HOLM quotes earn commission | No HOLM retail-quote commission. Retail buyers go to Louie Mae. | `HOLM_TRADE_ONLY_ENABLED` (S25) |
| BC2 | Hidden 40% profit cap, and the base rate when cost is unknown | Prequalified SKUs, visible exception schedules, cost hold | `COMMISSION_ACCRUAL_V2_ENABLED` (S28/S29) |
| BC3 | Lighting counts as furniture | Lighting counts as décor, going forward only | Category migration commit (S08) |
| BC4 | Tier moves down quarterly, one step at a time | Recompute on events and daily (decision D-07) | Config `tierPolicy` version |
| BC5 | Payouts on the 15th at 17:11 UTC, no cutoff | 09:00 Chicago on the 15th, cutoff 23:59:59 Chicago on the 14th (D-09) | Config `payoutSchedule` version |
| BC6 | $100 credit right after verification and a $500 order | Pending 30 days, then available. No double reward. | `CREDIT_V2_ENABLED` (S31) |
| BC7 | A Stripe transfer counts as **paid** | Transfer and bank arrival are separate states | S30 migration (status mapping, no data loss) |
| BC8 | One click recorded per visitor per partner per day | Every eligible click recorded, with an exact 30×24h expiry | `ATTRIBUTION_V2_ENABLED` (S27) |
| BC9 | The trade discount is a flat 25% | Per supplier and SKU schedule, and Zuo gets 10% or 5% | Schedule config (S32) |

## 4. Tests that exist and must keep passing

`lib/holmPartners.test.ts`, `lib/holmPricing.test.ts`, `lib/holmDelivery.test.ts`, `lib/partnerLink.test.ts`, `lib/retailLaunch.test.ts`, `lib/stripeWebhook.test.ts`, `convex/holmCommission.test.ts`, `convex/holmCredit.test.ts`, `convex/holmPayouts.test.ts`, `convex/holmTiers.test.ts`, `convex/holmStorefrontCommission.test.ts`, `convex/commerceStripe.test.ts`, `convex/commerceWorkflow.test.ts`, `convex/checkoutCatalog.test.ts`, `components/__tests__/CreatorHub.test.tsx`, `trade/partnerCopy.test.ts`. They cover parts of tiers, commissions, credits and payouts. The v2 audit did not run them. S00 runs them and records the result as the baseline.

When v2 changes a rule that a test asserts (for example the 40% guard), do not edit the old test to match. Keep it for the legacy path, which stays active while the flag is off, and add a new test for the v2 path.

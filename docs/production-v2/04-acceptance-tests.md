# 04. Acceptance tests and evidence

Every requirement gets a test ID, an environment, a code or config revision, an expected result, an observed result and an evidence link (recorded in [evidence-log.md](evidence-log.md)). The scenarios below are mandatory. Listing them here does not mean they have been run.

**Environments.** `unit` is Vitest with pure functions. `convex` is Vitest with `convex-test` and mocked Stripe and suppliers. `ui` is Vitest with Testing Library, or Playwright against `vite preview`. `staging` is an isolated Convex deployment plus a preview build, with flags on only there. `prod-ro` covers read-only production checks.

**Restriction (v2 PDF §24).** Local deterministic unit and integration tests and read-only production checks can go ahead. Any Stripe test run beyond the previously permitted `account.updated` verification needs explicit authorization. Don't infer permission for test charges, live payments, transfers, payouts or any other test method. Restricted scenarios that haven't been performed are recorded as **BLOCKED**, never as passed. A permitted webhook 200 proves transport and handler behaviour only, not the whole financial lifecycle.

## 1. Mandatory scenarios

| ID | Scenario | Required result | Step | Env | Test file (to create) |
| --- | --- | --- | --- | --- | --- |
| CAT01 | Reimport the same 865-record batch twice | Stable identities. No duplicate products, media or listings. Exact count reconciliation (865, 803, 306, 135, 296, 66, 62, 226, 639). | S09 | convex | `convex/zuoImport.test.ts` |
| CAT02 | Missing or stale cost, MAP applicability, carton or stock | Correct hold. Direct API and UI both refuse to publish or sell the variant. | S10, S15 | convex + ui | `convex/catFreshness.test.ts`, `convex/catPublication.test.ts` |
| CAT03 | Two-piece pack and multiple cartons | Piece cost and handling, pack price, inventory, cartons and customer quantity all agree. | S11 | unit | `lib/catUnits.test.ts` |
| CAT04 | Lighting migration with an old earned commission | Future category is décor. The old category, rate and earned amount are unchanged. | S08 | convex | `convex/catCategories.test.ts` |
| CAT05 | Discontinued, out of stock, feed omission | Distinct statuses. No inferred availability and no deletion. | S10 | convex | `convex/catFreshness.test.ts` |
| PRI01 | Approved 306 and original price exports | Exact approved pack amounts preserved. The 5% scope is not expanded. | S09, S12 | convex | `convex/catPricing.test.ts` |
| PRI02 | Full Elite commission and trade scenario | Separate contribution calculations. Commission and trade are never applied to the same purchase. | S12, S28 | unit | `lib/economics/scenarios.test.ts` |
| PRI03 | Zuo coupon, project discount or 25% attempt | The server rejects the unauthorized mechanism whatever the client or MAP arithmetic says. | S13, S32 | convex | `convex/catPromotions.test.ts` |
| PRI04 | Zero MAP, fractional piece cents, credits | Zero MAP goes to review. Final pack rounding is correct. Policy and economics are enforced after credits. | S12, S19 | unit + convex | `lib/economics/minRetail.test.ts`, `convex/ordCheckout.test.ts` |
| DEL01 | Required fees of $49.99, $50, $195 and $200 | $49.99, $59.99, $199.99 and quote required, in that order | S17 | unit | `lib/delivery/ladder.test.ts` |
| DEL02 | Mixed-margin, mixed-origin cart | Per-line floors and group-specific costs and subsidies. The actual $10 fee and the allowance are never spent twice. | S17 | unit | `lib/delivery/engine.test.ts` |
| DEL03 | Oversize carton, sofa, AK/HI, remote address | Supported classification or a quote. Never a distance-only or $199.99-cap fallback. | S16, S17 | unit | `lib/shipping/classify.test.ts`, `lib/delivery/engine.test.ts` |
| DEL04 | Quantity, address or service change, or an expired quote | Requote and reconfirm before payment. The paid amount stays immutable. | S18, S19 | convex | `convex/dlvEstimates.test.ts` |
| DEL05 | Freight invoice exceeds the estimate | Internal variance exception. No automatic extra customer charge. | S17, S21 | convex | `convex/ordFulfillment.test.ts` |
| ACC01 | Creator and trade memberships on one identity | Shared tier and payout beneficiary, separate permissions, no second account required | S05, S24 | convex | `convex/prgMemberships.test.ts` |
| ACC02 | Unapproved trade access or a direct endpoint call | Trade pricing and checkout denied without leaking private data | S25 | convex | `convex/holmTradeOnly.test.ts` |
| REF01 | HOLM Copy retail referral link | Correct published Louie Mae variant destination and a tracked retail purchase | S26, S27 | convex + ui | `convex/prgLinks.test.ts` |
| REF02 | Last valid click, direct visit, expired click, self click | Deterministic winning eligible attribution with an exact 30-day boundary | S27 | unit + convex | `lib/attribution.test.ts` |
| REF03 | Rate reduction, rate increase, category change | Valid protected window honored, higher eligible rate applied, earned terms immutable | S27, S29 | convex | `convex/prgAttribution.test.ts` |
| REF04 | Tier crossing, rolling expiry and refund | Pre-purchase and new-tier timing as defined. No retroactive rewrite of earned rates. | S28 | convex | `convex/prgTiers.test.ts` |
| LED01 | Duplicate or out-of-order paid and refund events | Exactly one obligation and correct cumulative reversals | S29 | convex | `convex/ldgCommissions.test.ts` |
| LED02 | Partial refund, dispute won or lost | Correct pending, cleared and paid adjustments and restoration, with no duplication | S29 | convex | `convex/ldgCommissions.test.ts` |
| PAY01 | $49.99, $50, a held balance and monthly concurrency | Carryforward and eligibility correct. One reservation per payable cent. | S30 | convex | `convex/ldgPayouts.test.ts` |
| PAY02 | Timeout, remote success with local failure, retry | Reconcile before retry. No double transfer and no erased obligation. | S30 | convex (mock Stripe) | `convex/ldgPayouts.test.ts` |
| CRE01 | $499.99 against $500 qualifying business order | Correct one-time award after review, with tax and delivery excluded | S31 | convex | `convex/ldgCredits.test.ts` |
| CRE02 | Concurrent redemption, refund, duplicate business | No overspend or duplicate award. Credit and cash refund allocation correct. | S31 | convex | `convex/ldgCredits.test.ts` |
| SEC01 | Client price tampering, webhook forgery, cross-account access | Rejected and logged without leaking secrets or private financial data | S18, S19, S38 | convex | `convex/security.test.ts` |
| UX01 | Mobile, keyboard, empty, error and onboarding flows | Usable, complete journeys and consistent public promises | S33–S37 | ui + manual | `components/**/__tests__/*.test.tsx`, manual record |
| OPS01 | Unpublish or roll back with paid orders outstanding | New sales stop. Orders, tracking and valid obligations keep working. | S15, S40 | convex + staging | `convex/catPublication.test.ts` |
| FUL01 | One paid cart with Zuo and Ashcroft | One customer parent order and payment. Correct supplier child orders. All quantities and financial allocations reconcile exactly once. | S19, S21 | convex | `convex/ordCheckout.test.ts` |
| FUL02 | Enable Zuo EDI for a mixed cart | The Zuo payload holds only its assigned items and permitted shipping data. Ashcroft stays on its own route. | S23 | convex (mock) | `convex/fulfillment/submit.test.ts` |
| FUL03 | Duplicate event, uncertain EDI send, manual fallback | One logical supplier PO. Uncertainty reconciled before resubmission. No duplicate fulfillment. | S23 | convex (mock) | `convex/fulfillment/submit.test.ts` |
| FUL04 | One supplier rejects, partially ships or cancels | Only the affected child lines change. Parent status, tracking and refunds stay accurate. The other supplier's order is preserved. | S21 | convex | `convex/ordFulfillment.test.ts` |
| FUL05 | Mixed order confirmation and partial shipment | Split-shipment disclosure appears before payment, after checkout and in the confirmation email. Notifications identify shipped and outstanding items. No extra charge just for splitting. | S21 | convex + ui | `convex/ordFulfillment.test.ts`, `lib/customerCopy.test.ts` |

## 2. Supporting golden and unit tests

| ID | What it checks | Expected value |
| --- | --- | --- |
| G1 | SKU 111182 pair (02 §8.2) | B = $153.45 per piece. Retail $458.06. Trade $412.26. Retail contribution $22.90. Trade contribution $64.13. |
| G2 | Delivery example: F = $100, S = $25, pd = 3% | q = $77.32. Fee $79.99. About $2.59 remains after delivery processing. |
| G3 | Ladder formula at every tier boundary (n×1000 + 4999 and +1 cent) | Monotonic, with quote required above 19999 |
| G4 | Combined trade and project reductions | 27.25% at $10,000, 28.75% at $25,000, never both |
| G5 | Tier boundaries | Exactly $15,000.00 is Active, $14,999.99 is Base. Same pattern at $50,000 and $100,000. |
| G6 | Attribution expiry | `expiresAt − 1 ms` attributes. `expiresAt` does not. |
| G7 | Payout cutoff | Cleared at 23:59:59.999 on the 14th (Chicago) is included. 00:00 on the 15th is excluded. Test across both DST transitions. |
| G8 | Daily Chicago job | Runs exactly once per local date across DST changes |
| G9 | Money library | 10⁵ random cases match the bigint reference |
| G10 | Append-only enforcement | `scripts/verify-append-only.mjs` finds no patch or delete on ledger and audit tables |
| G11 | Projection parity | Legacy commission and credit sums equal the v2 opening projections for every partner |
| G12 | Existing suites | All pre-existing tests still pass with every v2 flag off |

## 3. Evidence row format

```
| Test ID | Env | Code commit | Config versions | Expected | Observed | Result (PASSED/FAILED/BLOCKED) | Evidence link | Date | By |
```

A row may say PASSED only when the observed result matches the expected one in the named environment. "Compiles", "deployed" or "configured" is not evidence for a behavioural test.

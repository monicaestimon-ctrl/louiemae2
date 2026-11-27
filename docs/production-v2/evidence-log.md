# Evidence log: production build v2

Add one row per acceptance test, golden test, migration parity check or release gate (format in [04](04-acceptance-tests.md) §3). Never delete rows. If a result changes, add a new row. Result values: PASSED, FAILED or BLOCKED (with a reason).

| Test ID | Env | Code commit | Config versions | Expected | Observed | Result | Evidence link | Date | By |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE-01 | local | 0845358 | n/a | Existing checks pass on the starting head | lint 0 errors; type-checks pass; catalog writers pass; 858 tests / 137 files pass; build passes | PASSED | CI-equivalent local run | 2026-11-08 | agent |
| PHASE-B-LOCAL | local | Phase B PR | seed v1 | All checks pass with every v2 flag off (G12) | 889 tests / 141 files pass; append-only check passes | PASSED | Phase B PR checks | 2026-11-08 | agent |
| MIG-DEV-01 | dev | Phase B PR | seed v1 | Seed + dry-run backfill on the dev deployment | Not run: deploying a branch to the dev deployment was not permitted from the agent session | BLOCKED (permission) | n/a | 2026-11-08 | agent |
| MIG-IDENTITY-01 | dev | | n/a | Dry-run counts equal holmProfiles counts | | | | | |
| MIG-LEDGER-01 | dev | | n/a | Legacy commission and credit sums equal v2 opening projections | | | | | |
| CAT01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Dry run required; repeat commit idempotent; no duplicate products, variants or costs (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CAT02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Holds and stale stock block publish and purchase via API (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CAT03 | convex-test / vitest (CI) | main | seed v1 | See 04 | Pieces, packs and cartons agree (lib/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CAT04 | convex-test / vitest (CI) | main | seed v1 | See 04 | Lighting moves to décor; earned commission unchanged (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CAT05 | convex-test / vitest (CI) | main | seed v1 | See 04 | Discontinued, out of stock and unknown kept distinct (lib/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PRI01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Approved pack prices preserved; 5% policy refused outside cohort (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PRI02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Separate retail-commission and trade scenarios (lib/economics/pricing.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PRI03 | convex-test / vitest (CI) | main | seed v1 | See 04 | Zuo coupon/project refused server-side until documented (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PRI04 | convex-test / vitest (CI) | main | seed v1 | See 04 | Zero MAP, rounding and unknown costs held (lib/economics/pricing.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| G1 | convex-test / vitest (CI) | main | seed v1 | See 04 | 111182: 458.06 / 412.26 / 22.90 / 64.13 (lib/money.test.ts, lib/economics/pricing.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| DEL01 | convex-test / vitest (CI) | main | seed v1 | See 04 | 49.99 / 59.99 / 199.99 / quote (lib/delivery/engine.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| DEL02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Per-line caps; $10 fee once per supplier order (lib/delivery/engine.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| DEL03 | convex-test / vitest (CI) | main | seed v1 | See 04 | Oversize/LTL/quote; AK, HI, PO box, unzoned to quote (lib/delivery/engine.test.ts, convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| DEL04 | convex-test / vitest (CI) | main | seed v1 | See 04 | Any change requires re-estimate; PRICE_CHANGED reconfirmation (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| DEL05 | convex-test / vitest (CI) | main | seed v1 | See 04 | Freight variance is internal; customer charged 0 (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| G2 | convex-test / vitest (CI) | main | seed v1 | See 04 | $79.99 worked example (lib/delivery/engine.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| ACC01 | convex-test / vitest (CI) | main | seed v1 | See 04 | One beneficiary, two memberships, no second account (convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| ACC02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Non-trade HOLM quote refused; nothing written (convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| REF01 | convex-test / vitest (CI) | main | seed v1 | See 04 | HOLM variant link resolves to mapped Louie Mae variant (convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| REF02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Last eligible click; exact 30-day boundary; self and bots excluded (lib/programsV2.test.ts, convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| REF03 | convex-test / vitest (CI) | main | seed v1 | See 04 | Protected rate honored after a reduction (convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| REF04 | convex-test / vitest (CI) | main | seed v1 | See 04 | Crossing uses pre-purchase rate; quarterly downgrade (convex/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| LED01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Duplicate/out-of-order refunds reverse once; never over-reverse (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| LED02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Dispute hold/restore/void; offset after payout (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PAY01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Carry-forward under $50; one reservation per cent; concurrent manual payout refused (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| PAY02 | convex-test / vitest (CI) | main | seed v1 | See 04 | Uncertain transfer never resent; reconciled to succeeded; reversal re-opens (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CRE01 | convex-test / vitest (CI) | main | seed v1 | See 04 | $100 after 30 days for $500+; none for $499.99 (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| CRE02 | convex-test / vitest (CI) | main | seed v1 | See 04 | No overspend under concurrency; credit reinstated not cashed (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| SEC01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Auth coverage of every v2 endpoint; admin-only; tampering ignored; live-key webhooks always signed (convex/securityV2.test.ts, convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| UX01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Loading, join, terms, review, suspended, active states; no buyer PII (components/__tests__/ProgramHubV2.test.tsx) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| OPS01 | convex-test / vitest (CI) | main | seed v1 | See 04 | Unpublish leaves paid orders intact (convex/catalogV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| FUL01 | convex-test / vitest (CI) | main | seed v1 | See 04 | One parent, Zuo + Ashcroft children, every piece allocated once (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| FUL02 | convex-test / vitest (CI) | main | seed v1 | See 04 | EDI payload carries only Zuo lines (mock transport) (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| FUL03 | convex-test / vitest (CI) | main | seed v1 | See 04 | Uncertain EDI blocks resubmission and manual fallback until reconciled (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| FUL04 | convex-test / vitest (CI) | main | seed v1 | See 04 | Supplier cancel changes only its lines (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| FUL05 | convex-test / vitest (CI) | main | seed v1 | See 04 | Exact disclosure strings in email and order page (convex/checkoutV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| G5/G6/G8 | convex-test / vitest (CI) | main | seed v1 | See 04 | Tier thresholds, attribution expiry, Chicago DST (lib/programsV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| G7 | convex-test / vitest (CI) | main | seed v1 | See 04 | Cutoff 23:59:59.999 Chicago on the 14th in CDT and CST (convex/ledgerV2.test.ts) | PASSED | CI lint-test-build | 2026-11-08 | agent |
| MIG-PROD-DRYRUN | prod | dd607fc | seed v1 | Backfill dry run after deploy | identity: 1 profile, 0 partners; ledger 0; credit 0 | PASSED | CI deploy-convex job 128638592370 | 2026-11-08 | agent |
| STRIPE-LIVE-* | staging/prod | — | — | Real Checkout, refunds, disputes, transfers, payouts | Not run: needs explicit payment-testing authorization (04 restriction) | BLOCKED (authorization) | — | 2026-11-08 | agent |
| ZUO-DRYRUN-01 | prod | — | — | Real package counts 865/803/306/135/296/66/62/226/639 | Not run: package files not supplied | BLOCKED (input) | — | 2026-11-08 | agent |
| GATE-1 … GATE-5 | prod | — | — | 05 §2 sign-offs | Awaiting owner decisions (06 Step 1) | BLOCKED (owner) | — | 2026-11-08 | agent |

## November 23 continuation evidence

These entries supplement the historical November 8 rows; they do not retroactively change their results.

- PR #355 (`84705a9c29a6547cd8d0af2e7cc91c5346498903`) passed exact-head CI and both CodeRabbit findings were resolved before merge. Backend deployment and exact frontend revision verified. Anonymous HOLM product referral display passed at 390/1440px with no axe violations, overflow or page errors. It accurately reports that referral sharing is not active. Complete public discovery pagination returned 79 products, with trade prices hidden from anonymous users. This is not authenticated trade or payment acceptance.
- The preceding production Lighthouse run 45084597142 on PR354's merge recorded 100/100/100/100 in all 120 measurements across 12 registered public routes and two devices. The full release gate remains incomplete because additional route/persona/interaction coverage is pending. That score evidence belongs to its recorded revision, not every subsequent release.
- The Zuo package has been supplied and 803 records staged; the historical November 8 missing-package block no longer describes current import status. Current per-SKU evidence, economic qualification and publication remain separate gates; staging does not make them purchasable.
- Historical-rate branch `codex/protected-referral-history`: full frozen rerun passed 331 files, 2,165 tests, one optional skip. The initial run had one existing concierge focus assertion race; the assertion now awaits the lazy panel's focus effect and the full rerun passed. Application/backend types, lint, catalog writer/append-only guards and production build passed. Review, merge and deployment evidence for this branch must still be recorded before calling it live.
- After explicit action-time approval, normal existing-account sign-in succeeded and the verified Trade Hub loaded in Chrome. Its legacy Partner Hub still displays a `/trade` referral destination and 40%-of-profit cap; v2 activation and authenticated shopping acceptance remain unfinished. No payments, transfers, supplier orders or production program activation were performed for these checks.
- PR #356 review follow-up: historical exception reconstruction now requests review for an ambiguous same-millisecond replacement; current-rate reads and stored matching-product snapshots retain their behavior. Reversed/empty exception periods also require review. Focused regression suite passed 33 tests, including generic/cross-product/matching-product boundaries and malformed periods.

Operational receipts are retained outside the repository in `outputs/production-access-audit-20261122/`, including `product-referral-live-smoke.json`, `discovery-public-read-receipt.json`, `holm-browser-access.json` and the initial/final protected-rate test logs.

- PR #356 merged as `2f12d54ed16add2798dd9a1097bf4b77b678d5cc` after review findings were fixed and resolved. Exact-head CI 45093727128 passed 331 files / 2,170 tests / one optional skip plus browser checks. Backend deployment and exact frontend revision verified. Read-only production discovery returned 79 products with private trade prices hidden; 390/1440px referral display checks passed without axe violations or overflow. Program flags remain unchanged.
- Native authenticated House management navigation also passed: trade applications, sourcing, partners, pricing and asset readiness were accessible. This proves staff entry, not every admin mutation or authenticated checkout journey.
- Referral selection/account-association branch: frozen local suite passed 333 files, 2,192 tests and one optional skip. App/backend types, lint (zero errors; existing 551 warnings) and both catalog/append-only guards passed. Tests include more than200 visits, exact expiry, explicit scan exhaustion, stable multi-page association of125 visits, account ownership, consent, sign-out cancellation, failure recovery and yielding/resuming large histories. Review, merge, deployment and production acceptance remain separate release evidence.

### November 23 — PR357 release and authenticated access

PR357 merged as `3ece37d26a8bbd6c0ca2c70a794ccf4b8589f706` after exact-head CI45098817723 passed and CodeRabbit reported no actionable application findings. A final test-only correction made the tray fixture keep stable Convex mutation identity and distinguish inactive referral association from quote submission; its complete local browser suite passed. Production backend dry-run and deployment passed, and the frontend build identity matched the merge. Read-only discovery verified all79 currently listed products across three sort modes, complete pagination and private-price hiding. Anonymous product referral checks passed at390/1440 widths with no axe violations or overflow. Program flags were not activated.

The approved normal HOLM sign-in succeeded. Verified trade status, Trade Hub and House management were accessible in the signed-in browser. This resolves the earlier sign-in/staff-access dependency; it does not prove authenticated checkout, payout readiness, current Zoho access or full end-to-end release. The legacy Trade Hub still needs the v2 cutover and its related readiness work.


### 2026-11-27 ? Zuo content-only browsing

Re-read the November 3?4 supplier onboarding correspondence (forwarded Gmail message `1a1acab4310306ba`). The chairman reviewed Louie Mae's website and offered lifestyle imagery; the ecommerce manager supplied product/image workbooks to set up the line and keep the store current. This supports ordinary product promotion using the supplied imagery, not a blanket private-label/trademark grant or a waiver of MAP. The saved MAP policy's online-advertising terms remain applicable.

The production media audit found 724 visually verified variants. Their original source records still explicitly reserve publication-rights review. A named-product planning publication must record the reviewed website-use evidence, retain the existing sales holds, require canonical identity and approved MAP-compliant retail prices, and use verified public image renditions. No fulfillment cost snapshot or checkout authorization is created. A later price/MAP or image change removes the affected variant from browsing until reviewed again.

Production activation and named-product publication must follow passing CI and deployment. HOLM publication and sales qualification remain separate follow-up work.

### November 27 - qualified Zuo retail/HOLM publication and live checkout

See [supplier reconciliation and remaining acceptance work](supplier-reconciliation-20261127.md#november-27-production-qualification-and-checkout-activation) for this release milestone. Current sources: 744 Zuo variant refreshes and the independent 424-row Ashcroft feed. Production readback verified 102 qualified Zuo products on retail and HOLM. Existing approved prices were retained and unverified trade prices stayed hidden.

Retail pilot evidence: ten-ZIP estimates; full-address live FedEx and Stripe Tax totals; exact-total unpaid live Checkout creation; explicit session expiration delivered through the real webhook; over-stock rejection; Alaska quote fallback; and real product-page/cart totals matching at $560.79 for the Texas sample. No payment or supplier order was made. Verified-member HOLM checkout, Ashcroft v2 qualification and the remaining program/paid-lifecycle/stable-release acceptance work are still incomplete. Private receipt paths are listed in the reconciliation document.

Local verification for this documentation milestone: 350 test files passed, 2,458 tests passed and one skipped (direct Vitest run, thread pool, two workers). Application/backend types, catalog-write guard, build and client-secret guard passed. Lint passed with zero errors and 552 warnings after excluding untracked temporary audit scripts. Earlier wrapped test runs did not produce completion evidence and are not counted as passing. No application source changed in this milestone.

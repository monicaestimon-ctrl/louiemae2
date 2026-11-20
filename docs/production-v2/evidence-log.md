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

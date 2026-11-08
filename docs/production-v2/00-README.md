# Louie Mae production build v2: agent handoff package

Source: *Louie Mae commerce and partner production specification*, version 2.0, November 7, 2026 (the "v2 PDF"). This package turns that specification into an ordered build plan that an engineering agent can work through one step at a time against **this repository**. It covers every section of the PDF (1–28). See the traceability matrix in section 7 below.

This package is a build plan. It does not say production is ready, and it does not authorize any money movement. A release is complete only when the gates in [05-release-decisions-runbooks.md](05-release-decisions-runbooks.md) are met and the evidence is recorded in [evidence-log.md](evidence-log.md).

## 1. Files in this package

| File | Purpose | When the agent reads it |
| --- | --- | --- |
| `00-README.md` (this file) | Rules for working, invariants, step order, traceability | Before every step |
| [01-baseline-and-gap-audit.md](01-baseline-and-gap-audit.md) | What the code does today, file by file, and what each part must become | Before touching a module |
| [02-domain-model-and-config.md](02-domain-model-and-config.md) | Entities, Convex tables, validators, config registry, flags, error codes, formulas | Whenever a step adds a table, constant or formula |
| [03-implementation-steps.md](03-implementation-steps.md) | Steps S00–S40, each with scope, files, contracts, algorithms, tests and exit criteria | The working document |
| [04-acceptance-tests.md](04-acceptance-tests.md) | The 30 mandatory scenarios (CAT01 … FUL05), plus the supporting unit tests, mapped to steps and test files | When writing tests and before closing a step |
| [05-release-decisions-runbooks.md](05-release-decisions-runbooks.md) | Decision register, release gates 1–5, flags rollout, monitoring and alerts, runbooks, definition of done | Before enabling anything; when a step is blocked |
| [evidence-log.md](evidence-log.md) | One row per acceptance test or gate: environment, revision, expected and observed results, link | After each step |

## 2. Rules every agent follows

1. **One phase = one PR.** Work through the phases (0+B, C, D, E, F, G+H) in order; inside a phase, build the steps in order. Each PR title starts with the phase and its step IDs, for example `Phase C (S08–S15): catalog and economics`.
2. **Read before editing.** Before each step, re-read the files listed under *Touches* in that step and check them against [01-baseline-and-gap-audit.md](01-baseline-and-gap-audit.md). Line numbers drift, so search by function name.
3. **Schema changes are additive only.** `main` deploys Convex automatically (`.github/workflows/ci.yml`, job `deploy-convex`). Never remove a table, field, index or union literal that existing rows or code use. New fields are `v.optional(...)`. Widening a union is allowed. Narrowing one isn't. Backfills run as separate, resumable, paginated internal mutations with a dry-run mode.
4. **New behaviour ships disabled.** Every new customer-facing or money path is behind a server-owned flag (see 02 §5) that defaults to off. Existing production behaviour keeps working until its replacement is verified and the owner signs off on the switch.
5. **No real money, no test charges.** Do not make live payments, transfers or payouts, or Stripe test-mode charges, transfers, payouts or Connect account actions, and do not use any other payment-testing method. The only Stripe check already permitted is verifying `account.updated` handling. Everything else uses mocks, fixtures and `convex-test`. If a scenario needs a restricted check, record it as **BLOCKED (authorization)** in the evidence log. It is never **PASSED**.
6. **Never send supplier orders.** No step sends a Zuo, Ashcroft or EDI order. Fulfillment work builds manual task queues and a disabled adapter with a mock transport.
7. **Use only the data you were given.** If a required input is missing (a Zuo package file, a MAP value, a carton dimension, a rights document), the affected SKU or feature goes on hold with a reason code. Never put in a placeholder value to get a gate to pass.
8. **Proposed defaults are configuration, not approvals.** Values marked `PROPOSED` in 02 §6 are built as versioned config records with `status: 'proposed'`. Server code refuses to turn on a public promise that depends on a config record still in `proposed` status (error `POLICY_NOT_APPROVED`). The owner approves a record through the admin decision register (S35). Code changes are not needed to approve one.
9. **Money is integer cents. Rates are integer basis points.** Never use floating-point arithmetic on money (see 02 §7). Source inputs with more precision are stored as decimal strings with an explicit scale.
10. **Historical records are immutable.** Do not rewrite earned commissions, paid orders, invoices, source identifiers or tier history. Corrections are new events with a reason.
11. **Server is the authority.** Prices, rates, discounts, beneficiaries, eligibility and totals come from the server. Ignore any value the client sends for these, and log it as tampering (SEC01).
12. **Checks before every push:** `npm run lint`, `npm run type-check`, `npx tsc -p convex/tsconfig.json`, `npm run verify:catalog-writers`, `npm run test:run`, `npm run build`. All must pass. Record the test count in the evidence log.
13. **Close a step only when its exit criteria are met.** Update the step's status line in 03 (`Status: done in PR #…`) and add the evidence rows.

## 3. Invariants (must hold after every step)

- I1. Louie Mae (`louiemae.com` storefront, `App.tsx`) is the only retail channel. House of Louie Mae (`/trade`, `trade/app.ts`) is the authenticated trade purchasing channel.
- I2. Both channels use the same canonical products, variants and partner identities, with separate channel prices and permissions.
- I3. A variant whose cost, MAP, availability, cartons, media, rights or mapping isn't complete can't be published, bought or used for a new referral link. This is enforced in the server mutation, not only in the UI, and covers the API, bulk import and background jobs.
- I4. One sale earns at most one retail-referral reward. A trade purchase never earns retail commission. One order can't earn both the $100 business credit and a retail commission for the same beneficiary.
- I5. Every money-creating event has a stable idempotency key, checked and inserted in the same Convex mutation (Convex mutations are serializable transactions).
- I6. Public queries return only whitelisted fields. Supplier cost, margin and customer PII never reach creators, unapproved trade users or anonymous visitors.
- I7. Ashcroft and existing House-managed products keep their approved supplier-specific fees and delivery rules. Zuo assumptions are never applied to them automatically.
- I8. Paid orders, earned commissions and credits stay usable through any unpublish, rollback or flag change.

## 4. Inputs the agent must obtain (not in the repository)

| Input | Named in the v2 PDF | Used by | If missing |
| --- | --- | --- | --- |
| `outputs/zuo-reconciled-20261106/` package | §3 | S09–S12 | Build adapter and tests on fixtures. Real import is blocked. |
| `Zuo-Reconciled-Pricing-and-Delivery.xlsx` | §3 | S09 parity report | Parity check blocked |
| `Zuo-Internal-Product-Records.json` (canonical audit) | §3, §22 | S09 | Real import blocked |
| `Zuo-Draft-Import.json` and `.csv` | §3 | S09 | Real import blocked |
| Reconciliation-Summary, Reconciliation-Details, policy-evidence, Dealer-Observations, Data-Verification, Workbook-Verification | §27 | S09, S10, S12 | Evidence review blocked |
| Zuo written policy: MAP, trade, coupon, private-label, media rights | §5, §8, §26 | S13, S14, S15 | Affected listings or mechanisms stay held |
| Supplier-specific return and damage policies | §13, §26 | S22 | Checkout activation blocked |
| Operator legal identity, support address, privacy and tax details | §26 | S37 | Program terms and public enrollment blocked |
| Payment verification authorization and funding plan | §24, §26 | S29–S31 release | Financial flags stay off |

Put the files you receive under `data/zuo/2026-11-06/` and keep that path in `.gitignore` if it holds supplier cost data. Store only checksums and the parity report in the repository.

## 5. Step order and dependencies

The work packages are A to H, as named in the PDF (§23). Build B before any transactional service. C supplies prices, categories and mappings to D and E. F depends on immutable paid-order and attribution snapshots. G must reflect final behaviour. H can't be replaced by a successful build.

| Step | Title | Package | Depends on | Can run in parallel with |
| --- | --- | --- | --- | --- |
| S00 | Handoff setup and baseline | A/H | none | none |
| S01 | Money, rates and rounding library | B | S00 | S02, S03 |
| S02 | Flags, error codes, versioned config registry | B | S00 | S01, S03 |
| S03 | Idempotency keys and audit events | B | S00 | S01, S02 |
| S04 | Catalog and supplier schema | B | S01–S03 | S05, S06, S07 |
| S05 | Identity, organization and membership schema with backfill | B | S01–S03 | S04, S06, S07 |
| S06 | Referral, ledger, credit and payout schema with opening snapshot | B | S01–S03 | S04, S05, S07 |
| S07 | Cart, estimate, quote, order, fulfillment schema | B | S01–S03 | S04–S06 |
| S08 | Explicit commission categories and lighting migration | C | S04 | S09 |
| S09 | Zuo import adapter, dry run and commit | C | S04 | S08 |
| S10 | Source observations, freshness and availability | C | S09 | S11 |
| S11 | Cartons, packs and physical units | C | S09 | S10 |
| S12 | Pricing engine, margin policies and scenario economics | C | S10, S11 | S14 |
| S13 | MAP, promotions and market review | C | S12 | S14 |
| S14 | Names, slugs, redirects and media pipeline | C | S09 | S12, S13 |
| S15 | Publication state machine and server gates | C | S12–S14 | none |
| S16 | Shipment classification | D | S11 | S15 |
| S17 | Delivery and cart economics engine | D | S12, S16 | none |
| S18 | Estimate service and storefront UI | D | S17 | S20 |
| S19 | Checkout service (mixed supplier, reservations, verified payment) | D | S18, S06 | none |
| S20 | Versioned manual quotes | D | S17 | S18 |
| S21 | Parent and child orders, manual dealer queues, shipments | D | S19 | S22 |
| S22 | Returns, refunds and goodwill | D | S21 | S23 |
| S23 | EDI adapter interface (disabled) | D | S21 | S22 |
| S24 | Creator and trade memberships, versioned terms | E | S05 | S08–S23 |
| S25 | Cross-site identity, trade-only HOLM, retire HOLM retail commission | E | S24 | S26 |
| S26 | Retail mappings and link builder | E | S15, S24 | S25 |
| S27 | Attribution v2 and rate protection | E | S26, S06 | none |
| S28 | Commission schedules, tier computation and SKU prequalification | E | S27, S12 | none |
| S29 | Commission ledger v2 | F | S19, S28 | S31 |
| S30 | Payout runs v2 | F | S29 | S31 |
| S31 | Business referral credit v2 | F | S19, S06 | S29, S30 |
| S32 | Trade and project benefits v2 | E/F | S12, S25 | S29–S31 |
| S33 | Creator Hub v2 | G | S26–S31 | S34 |
| S34 | Trade Hub v2 | G | S20, S25–S32 | S33 |
| S35 | Admin consoles and decision register UI | G | S08–S32 | S33, S34 |
| S36 | Durable notifications | G | S21, S29–S31 | S37 |
| S37 | Accessibility, copy, terms and privacy | G | S33–S36 | none |
| S38 | Security hardening and data retention | H | all functional steps | S39 |
| S39 | Monitoring, alerts and runbooks | H | all functional steps | S38 |
| S40 | Staging validation, pilot cohort and controlled release | H | S00–S39 | none |

## 6. How a step is written in 03

Each step has the same headings:

- **Goal.** One paragraph.
- **PDF sections.** The v2 sections this step implements.
- **Touches.** Existing files to change, and new files to create.
- **Schema.** Tables, fields and indexes (full validators are in 02).
- **Contracts.** Convex functions with their arguments, return shape, authorization and failure codes.
- **Algorithm.** Exact rules and formulas, where needed.
- **UI.** Screens and states, where needed.
- **Tests.** Unit and integration tests, and acceptance IDs from 04.
- **Exit criteria.** Checkable conditions.
- **Blocked by.** Decision IDs from 05 or inputs from section 4 above. Build everything that isn't blocked, and keep the blocked part disabled.

## 7. Traceability: v2 PDF section → steps

| PDF § | Topic | Steps |
| --- | --- | --- |
| 1 | Authority and scope | README §2–3; S00; S08 (Ashcroft audit) |
| 2 | Gaps from the overview | Covered by S12, S13, S17, S19, S24, S27–S31, S40 (one row each) |
| 3 | Catalog baseline and limitations | S09, S10 (named SKUs), S12 (cohorts) |
| 4 | Canonical product and supplier data | S01, S04, S09, S10, S11 |
| 5 | Categories, names and media | S08, S14 |
| 6 | Cost completeness and availability gates | S10, S15 |
| 7 | Product pricing policies | S12 |
| 8 | MAP, promotions and competitive review | S13 |
| 9 | Delivery configuration and customer experience | S17, S18 |
| 10 | Shipment classification and cost model | S16, S17 |
| 11 | Delivery allowance and cart economics | S17 |
| 12 | Quote and checkout contracts | S18, S19, S20 |
| 13 | Fulfillment, support and returns | S21, S22, S23 |
| 14 | One identity and two memberships | S05, S24, S25 |
| 15 | Commission schedule and tier computation | S28 |
| 16 | Retail links, attribution and rate protection | S26, S27 |
| 17 | Commission ledger and payout lifecycle | S29, S30 |
| 18 | Trade and project benefits | S32 |
| 19 | Business referral store credit | S31 |
| 20 | Portal and administration requirements | S33–S36 |
| 21 | Data model, services and security | S02–S07, S38 |
| 22 | Import and migration plan | S05, S06, S08, S09, S40 |
| 23 | Work packages and dependencies | README §5 |
| 24 | Acceptance tests and evidence | 04, evidence-log |
| 25 | Production release and operating controls | S39, S40, 05 |
| 26 | Decision register and public terms | 05 §1, S37 |
| 27 | Evidence and references | README §4, 01 |
| 28 | Current code audit | 01 |

## 8. Relationship to existing specifications

- `docs/louiemae-commerce-master-build-spec.md`, `docs/commerce-implementation-status.md`, `docs/ashcroft-admin-build-spec.md` and `docs/house-commercial-three-provider-workflow.md` still govern CJ, Ashcroft and owner-managed workflows. This package adds Zuo explicitly and keeps their fulfillment boundaries. Where they conflict with the v2 PDF on the approved 306-product 5% pricing exception, the reconciliation or the rules here, v2 wins.
- `docs/HOLM_PARTNER_PROGRAM_SPEC.md` (November 3, 2026) is the program already built. v2 changes some of its rules: HOLM retail-quote commission, the hidden 40% margin cap, unknown-cost fallback, tier timing, the payout schedule and the credit state model. Each change is listed in 01 §3, and where an owner decision from November 3 conflicts with a v2 *proposed* default, the change is in the decision register (05 §1). Until the owner decides, the November 3 decision stays in force.
- The November 5 delivery PDF is historical wherever v2 supersedes it.

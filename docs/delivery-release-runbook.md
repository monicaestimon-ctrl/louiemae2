# Delivery release and operating runbook

This is the deployment sequence, not evidence that deployment or policy approval occurred. Read the full specification and implementation ledger first.

## 1. Review and catalog preservation

Publish a ready-for-review PR against current main. Run lint, general and strict Convex type checking, tests, catalog-writer/append-only/repository-secret/client-secret guards and build. Allow automatic CodeRabbit review and resolve material findings.

Keep the approved 803-product manifest private. Replay using `ZUO_PARITY_MANIFEST`; do not commit supplier cost documents or operational credential scripts. Preserve exact cents, packs, images, names, identifiers and holds. Passing import parity never publishes a product.

## 2. Additive deployment

Use current-main CI for backend deployment. Never push a stale local Convex schema. Record commit, CI and frontend/backend deployment IDs. Retain existing indexes/tables and histories. New optional fields permit old intents/orders; unknown expenses must not be backfilled to zero.

Keep delivery/Zuo checkout disabled until scoped routes are approved. `TRADE_CALCULATOR_V2_ENABLED` enables the approved-basket calculator; it does not authorize checkout or manufacture project settings. Keep EDI and payout cutover flags unchanged.

## 3. Staff and policy configuration

Configure backend `DELIVERY_ADMIN_ROLES` as a JSON email-to-role-array map for existing canonical admins. Supported roles: owner, support, operations, finance, approver, engineering. With a map installed, omitted emails have no delivery permissions. Support gets safe status; operations works quotes; finance handles diagnostics/tax/invoices; approver approves settings and sends payable quotes. Test allowed and denied actions.

Propose and approve evidence-backed versions in Decisions & flags: delivery ladder; pricing/margin policies; supplier fee scope; estimate freshness; mixed-supplier rule; carrier rate/service/origin/ZIP3 scope and ZIP5 exclusions; tax category/shipping codes; exemption process; project tiers with explicit `eligible_trade_merchandise` basis. Highest qualifying project tier only, eligible lines only. Zuo remains nonstacking absent documented permission.

Seeds are proposals. Do not approve fixtures. Future versions must preserve the current policy until activation.

## 4. Product and rate readiness

Each purchasable variant requires current cost/MAP, pack/piece/carton basis, individual carton measurements, supplier method/origin, availability, approved price and commission economics. Product dimensions are not carton dimensions. Keep incomplete records, but block sale/new referrals.

95206 is the Zuo reference origin, not a universal default; confirm the active warehouse. The downloaded policy's $10 per order is separate from Louie Mae's $10 per-piece allocation. Its historical $315 LTL example described one standard pallet up to 350 lb including pallet, with stated curbside/residential/liftgate scope. It does not mean every item/lane costs $315.

Prior public sofa/carrier tests assumed pallet dimensions/weight and unverified class. They are not Zuo-account nationwide rates. Initial automatic LTL requires verified one-carton-per-pallet geometry/tare/class. Consolidation, unusual sizes, truckload and unsupported services remain reviewed quotes until a validated model is added.

## 5. Shadow and deployed browser verification

Admin preview compares approved/proposed settings without payable estimates. Export readiness and inspect Ground/LTL, multi-pack, mixed supplier, large/abnormal, California/regional/New York/AK/HI scenarios. Record source/policy versions, freight, allowance and contribution.

Verify deployed PDP/cart/full-address flows, approved trade login and savings, changed totals, quote fallback/recovery/notifications, exact-version acceptance, disclosures, keyboard, screen reader and mobile. Confirm no private prices/costs leak. Current browser evidence uses mocks, not live Convex. This checklist does not authorize real payment or alternative payment testing.

Configure perimeter request limits using the host's trusted identity. Browser IP/visitor strings are not trustworthy identities. Separate expected quote-only requests from errors. Carrier error/p95/quote SLA alert thresholds require operating approval and monitoring configuration.

## 6. Scoped pilot

Approve only documented SKU/origin/service/destination coverage; activate global flags only alongside scoped controls. Unsupported inputs produce an actual quote request, not free delivery or a capped payable total. $199.99 is the top automatic Zuo ladder tier, not a universal mixed-supplier maximum. Approved Ashcroft charges may add under the mixed rule.

Final payable totals require fresh full-address tax and all-line server revalidation. Cart changes invalidate estimates. Manual quotes need confirmed freight/fixed costs/tax evidence/service/address and MAP/margin validation. Acceptance alone neither charges nor reserves stock.

## 7. Paid orders and fulfillment

Verified payment creates one parent and supplier/origin/service children. Send each supplier only its lines. Zuo is manual until EDI onboarding and uncertain-send recovery are independently verified. Never automatically resend uncertain transmissions.

Disclose separate shipments before payment and in confirmation/status. Track quantities per shipment; one delivered child cannot deliver the parent. Freeze paid price/address/service. Post-payment service/address changes require reviewed process, not silent recharge.

Resolve mismatched/late payments in paid exceptions. Preserve uncertain holds until reconciliation. Stripe retries reuse identical frozen parameters.

## 8. Actual costs, refunds and tax

Record invoices against supplier children with stable references/evidence; separate supplier fees from freight. Corrections are explained credit/additional records; conflicting duplicates fail. Overruns are internal variance.

Finance records every actual expense, explicit confirmed zeros, refund allocation, advertising and recoveries. Final freight needs an invoice/confirmed-zero invoice for each child. New evidence makes old final statements provisional. Do not deduct allowance twice. Below-floor reviews use frozen merchandise-weighted floors proportionately adjusted for refunds; examine line-specific return economics separately.

Sale-tax reporting retries durably, then opens review. Signed refund events record cumulative confirmed cash; they neither infer tax nor refund again. Finance completes the reviewed provider reversal separately, then records provider reference, cumulative cash/tax and evidence. Use frozen merchandise/shipping tax allocations. Completed evidence closes matching reviews without erasing history.

## 9. Expansion and rollback

Review the first 20 completed shipments per pilot grouping, then weekly until stable. Use actual samples and service outcomes before each versioned expansion; never claim nationwide accuracy from a small sample.

Rollback disables new automatic estimates/checkout only for affected scope. Keep paid fulfillment, quote access, invoices, refunds, tax reporting and audit history running. Do not delete records or restore a destructive old schema; use a corrective current-main deployment.

Release record must include deployment IDs, policy versions, SKU/rate evidence, deployed browser and permitted payment evidence, monitoring, named queue owners and rollback rehearsal. Unverified scope stays quote-only and its gaps remain explicit.


## 10. Delivery records and retention

| Record | Access / retention behavior |
| --- | --- |
| Guest estimate/quote/order capabilities | Only digests on the server; scoped access expires after 90 days. Expiration is not deletion of financial records. |
| Operational estimate observations | No full address, contact, capability or prices. Seven-day default; an effective approved monitoring policy may set 1–90 days. Hourly cleanup catches up in bounded 500-row transactions, up to 50,000 per invocation. Monitor unusual backlogs. |
| Browser checkout-return token | Tab-scoped sessionStorage with a 90-day logical expiration; removed when read after expiry. Browser session/storage clearing also removes access. No new token is placed in a checkout-return URL. |
| Quote contacts, addresses, notes and notification envelopes | Restricted server records. Do not delete by guessing a legal retention period or while a quote, failed/uncertain notification, payment, claim or dispute needs them. Owner must record the approved closure/retention/deletion schedule before broad rollout. |
| Paid orders, invoices, accepted terms, refunds, taxes, commissions and audit | Preserve immutable financial history and legal holds. No automatic deletion is introduced by delivery observation cleanup. Owner/accountant/legal records requirements govern any later archival/erasure workflow. |

Before production expansion, record the owner-approved contact-data retention schedule, storage-provider encryption/access assurances, backup/erasure procedure, legal-hold treatment and responsible operator. Keep those gates open when evidence is missing. A request to erase data requires an authenticated identity check, a review of all linked projects/notifications/orders and a recorded decision; it must not erase payment or partner obligations.

Unexpected delivery failures use a random support reference. Never paste full addresses, guest links, supplier costs or raw provider payloads into public issue trackers or analytics. Customer errors contain stable codes and safe wording; detailed investigations remain inside authorized systems.


## 11. Signed delivery gateway configuration and verification

The browser uses `/api/delivery` on its own retail/trade origin for estimate and quote intake. Only the server creates a proof. Set a fresh 64-character hexadecimal `DELIVERY_REQUEST_SECRET` as a sensitive Vercel Production environment variable and the matching Convex environment variable, using stdin rather than command arguments or committed files. Keep `VITE_CONVEX_URL` pointed at the intended backend. The secret must never have a `VITE_` prefix. Roll both servers together for rotation; in-flight proofs expire after 60 seconds and temporarily fail safely on mismatch.

Use a separate Convex deployment and distinct secret for Preview. An unconfigured preview intentionally refuses gateway requests; do not connect it to production to make a test pass. Local end-to-end tests should use fixtures or an explicitly isolated trusted-server adapter; localhost cannot manufacture production's Vercel request header.

After both deployments, while delivery is still disabled, a bounded same-origin estimate request with fixture identifiers must return `FEATURE_DISABLED`, demonstrating trusted-context verification without provider calls. A direct unsigned Convex estimate must return `FORBIDDEN`; invalid/oversized payloads must not reach pricing. Use no real quote contact details, payments or notification sends for these checks. Once operational readiness is approved, verify ordinary estimates, authenticated trade access and exact quote retry in the authorized environment.

The request limit is a workload/spend control, not a carrier rate or customer-delivery price. HTTP 429 returns Retry-After 60 seconds; a quote bucket may take up to 12 minutes to replenish one token, so another attempt can remain limited. Counts survive invalid products, rejected membership and failed calculations. The daily IP pseudonym means an IP budget resets on UTC day rollover; account/email/global budgets continue independently. NAT/shared networks may share a limit; a support-assisted quote is the recovery route.

Configuration evidence, 2026-11-08: matching server-only gateway secrets were set via stdin in Convex `diligent-jay-261` and Vercel production project `prj_Qijd8TQq62BbwCyUjLj1nzbBtAUk`. No secret was written to the repository or copied to Preview. Delivery activation flags were unchanged. PR 250 merged as `7460da1`; main CI 42533991178 and Vercel production succeeded. Production checks on 2026-11-08 returned HTTP 409/FEATURE_DISABLED through the signed gateway, FORBIDDEN from the unsigned direct action, and HTTP 400/INVALID_INPUT for an invalid gateway operation. No provider work, payment or message was invoked.


## 12. Delivery staff access

`CJ_ADMIN_EMAILS` (or its existing `ADMIN_EMAILS` fallback) remains the first staff allowlist. `DELIVERY_ADMIN_ROLES`, when set, is a JSON object mapping canonical email addresses to arrays containing only `owner`, `support`, `operations`, `finance`, `approver`, or `engineering`. Every intended owner must be explicitly included when installing this map. A missing variable preserves existing owners; an empty string, malformed map or omitted account never silently grants owner rights. Normalize addresses and avoid duplicate case variants. Test a proposed map with fixtures and retain authorized deployment-console recovery before installing it.

| Role | Delivery access | Restricted access |
| --- | --- | --- |
| Support | Paginated request status; customer-safe estimate totals/service | No cost, finance, policy approval, general admin or payout access |
| Operations | Support plus quote drafting, shipment/dealer handoff and rate proposals; supplier PO amounts needed for handoff | No catalog economics, actual expense accounting or publication |
| Finance | Operations plus costs, reconciliation, return calculations and financial health | No price/policy publication, goodwill or refund-state approval |
| Approver | Finance plus policy/price publication, sending quotes, goodwill and manual return authorization/refund recording | No implicit general-site, marketing, catalog-import or payout administration |
| Engineering | Integration configuration presence and feature states; external deployment tooling remains separately authorized | No implicit customer, support, finance or general-site access |
| Owner | Existing complete site administration and all delivery roles | Existing financial-testing and approval restrictions still apply |

Role arrays can combine independent responsibilities. Changes revoke access at the next server call; existing financial snapshots and audit history are preserved. The `/admin` page routes limited staff to scoped commerce screens, while owners retain the existing full admin experience. Staff who lose all roles receive no workspace. The browser does not decide authorization.

No named staff assignments were changed during this implementation. Before adding staff, an owner must record the actual account, role, business need and access-review owner. Do not treat the role table as permission to create employees, invite users, send messages or change payout access.

Pre-deployment check, 2026-11-08: production has no explicit `DELIVERY_ADMIN_ROLES` variable. Existing allowlisted site owners therefore retain their access. No role-map value or account email was logged, and no role assignment was changed.

Deployment evidence: PR 251 merged as `759c049`; main CI 42535490647, Convex deploy/seed and Vercel production succeeded. The unauthenticated production session query returned `{owner:false, delivery:false}`. This read-only check did not create accounts or modify staff permissions.

## 13. Protected catalog migration

The 803-product staging packet is not evidence of 803 purchasable products. Preserve its approved sellable-pack prices, media, exclusions and unresolved source holds. Internal draft migration and publication are separate operations.

1. Retain the original source files and SHA-256 references outside the public repository. Normalize once with stable observation metadata. A local file modification date is not supplier verification.
2. Begin a dry run with the exact files, importer revision, declared normalized record count and rejected-row report. Every accepted identity must be unique. Identical chunk retries are permitted; changed retries fail.
3. Stage at most 25 records per transaction. Finish checks the declared count even when the historical full 865-row cohort check is disabled. A partial dry run cannot qualify a commit.
4. Review the completed dry-run report. Commit binds to that completed run and verifies each full normalized row, including observation metadata and hold reasons, by SHA-256 before writing. Changed source metadata, importer revision, counts or rows require a new dry run.
5. Existing staged prices and pack quantities must match exactly. Import cannot clear a staged exclusion; explicit price/exclusion review occurs in its separate workflow. A newly added recognized hold is applied even when product facts and prices are otherwise unchanged.
6. Finish the commit and compare all expected records. Chunk transactions are atomic individually, not across the entire packet: an interrupted/failed run may have written some internal drafts. Keep them held; resume the same running batch with identical chunks, or review and start a new dry run. Do not interpret an incomplete run as publication approval.
7. Legacy unfinished batches lack this binding and must be replaced by a fresh dry run. A legacy completed commit with a reused source key requires a new migration key; it is not silently certified by the newer importer.
8. Independently validate current variant costs/MAP, shipping cartons and method, rights, inventory, approved operating policies and live checkout gates before publishing. A successful migration never clears these gates.

Local evidence: all 803 actual staged rows passed the fixture replay for prices, images, names, pack quantities and exclusions. No production migration or sale activation was performed by this safeguard phase. The real source packet remains outside git.

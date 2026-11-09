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

Deployment evidence: PR 252 merged as `01f89dd`; main CI 42536623497, Convex deploy/seed and Vercel production succeeded. Full CI and focused import tests passed. Automatic CodeRabbit review was skipped by repository eligibility; there were no review comments.

## 14. Itemized freight and historical reconciliation

Use the delivery console's itemized invoice form for all new freight expenses. The old `ordFulfillment.recordFreightActual` API now refuses writes instead of creating totals absent from the contribution ledger. Historical rows remain intact and visible beside each supplier order's invoices.

- Enter base freight, fuel, accessorials, supplier fees and credits separately. Every field starts blank; enter `0` only when confirmed. Identify the supplier child order and, when applicable, its shipment. For a carrier invoice spanning orders, enter only this child's documented allocation; do not repeat the entire carrier invoice on every child. This workflow does not automatically allocate a carrier billing statement.
- An identical carrier/reference retry is idempotent within the supplier order. Changed amounts, shipment, evidence or explanation fail. Existing invoices are immutable; corrections require documented adjustment/credit entries. A positive aggregate freight variance opens the internal review queue and never changes the frozen customer charge.
- Any legacy freight row without a review prevents a final actual-cost statement. An approver must match its freight total to itemized invoices from that same supplier child (supplier fees excluded), or explain with evidence why the historical record is duplicate or invalid. Unknown costs must first be verified and itemized, not dismissed to clear a gate.
- Reviews are append-only. Identical retries return the existing review; a correction appends another review. The latest review controls reconciliation, and changes invalidate a previously final cost statement. Original historical amounts and review history remain preserved.
- Canonical invoices alone supply freight expense to contribution. Matched legacy totals are not added again. After resolving every legacy entry and confirming all expenses, record a new final cost statement. Every supplier child still needs an itemized invoice or an explicitly confirmed zero invoice.

Fixture verification covers conflicting invoice retries, unchanged paid totals, retired legacy writes, final-cost blocking, approver-only review, idempotent review, review corrections, absence of double counting, explicit zero entry and internal freight-variance alerts. No production invoices, payments, refunds or customer messages were created for testing.

Deployment evidence: PR 253 merged as `adc1139`; main CI 42537859079, Convex deploy/seed and Vercel production succeeded. There were no review comments; automatic CodeRabbit review was skipped by repository eligibility.

## 15. Stored 803-product catalog conversion

Deployment-admin-only functions in `zuoImport` migrate the stored draft packet through the same protected dry-run/commit implementation as the owner import screen. They are internal Convex functions, not browser/customer endpoints. They record the actor as `deployment-admin:staged-catalog-v1` rather than impersonating an owner account. They cannot publish products, approve policies, clear exclusions or turn on checkout.

Before executing: wait for both production deployments, retain the original private packet and obtain a fresh `stagedSnapshot` for every selected SKU. Keep that backup outside git. Verify the 803 requested SKUs, original packet identity, prices, costs, names, images, exclusions and draft status. Snapshot/stage calls are limited to 20 unique SKUs. A product that has advanced beyond imported draft or has a published listing requires its separate review workflow.

1. Call `beginStagedMigration` with `mode: dry_run`, the exact run ID and manifest SHA-256, `expectedRecords: 803`, and the frozen timestamp of the source observation. It must not be a future timestamp or a fabricated new supplier-verification date.
2. Call `stageStoredMigration` with the returned batch ID and each SKU chunk. The server reads stored product evidence and performs conversion; the caller cannot submit replacement product values through this API.
3. Call `finishStagedMigration`. Review the returned counts and the batch report. Rejected, missing or mismatched identities must be investigated before commit. Expected cohorts are 306 / 135 / 296 / 66 for this 803-row scope, not the separate historical 865-row package.
4. Begin `mode: commit` with identical inputs, then repeat the same chunks and finish. A row's full source evidence and exclusion reasons are hashed into its source reference. Changes between review and commit fail. Exact chunk retries work even after catalog variant IDs replace the old draft IDs. Retain the running batch ID for interruption recovery.
5. Take fresh snapshots, verify every requested row and its canonical cost, price and carton records, and retain a private parity report. Confirm that no listings were created and that manual publication holds remain. Record production batch IDs and counts in the operational evidence packet, not supplier costs in public PRs.

Conversion rules:

- Approved retail/trade prices stay per sellable pack. Original names, descriptions, images, permissions, reference media and raw source evidence remain preserved. Original exclusions are retained even when stock later recovers.
- Only a current supplier row with matching pack and rounded pack cost, no source blockers, and the packet's fresh-candidate designation corroborates wholesale. Keep the supplier's exact per-piece decimal in that case. Other wholesale values remain the unverified approved-packet snapshot with stale/conflict holds. Corroboration of wholesale does not verify duties, inbound charges, supplier fees, freight, rights or commissions; missing expenses remain null.
- Use current supplier cartons only when the current pack matches. Normalize the three physical sides longest-first for carrier length/width/height, preserving the original axis order in source evidence. Missing/nonpositive dimensions or weights remain a carton hold. Never reuse an older carton merely because the current supplier row is absent.
- Preserve the current supplier shipping method. A Ground-to-LTL change is recognized even when dimensions are identical. Shipping-method changes, net-weight changes, sub-cent wholesale changes and new verification/source evidence can no longer be silently treated as unchanged imports.
- Do not invent a size allowance class for a parcel from its name. Existing approved allowance values remain in source evidence for the delivery-policy reconciliation; an unapproved class remains UNKNOWN and delivery-held. The 5% cohort stays limited to its approved products; the MAP-based cohort's separate floor hold remains.
- Retain stock-unit-basis, media-rights, mapping, commission and manual publication holds. This conversion is not a new inventory reservation or permission to sell an unavailable/discontinued product.

Rollback: stop further chunks and keep affected products unpublished. Preserve all batch, observation and revision history. Resume an unchanged running batch or perform a reviewed correction from the saved snapshot; do not delete records or overwrite a later owner review. No financial order, payment, notification or supplier order is created by this migration.

Production execution (2026-11-08): PR 254 deployed; the private 803-row before/dry-run/review/commit/after packet contains zero parity issues. Created 803 canonical variants and 835 carton records; 427 wholesale costs corroborated; 226 original exclusions retained; all 803 variants manually held. Approved prices, names and images match. Feature flags remained disabled. This is catalog conversion, not sale activation.

## 16. Cost and MAP evidence authoring

Finance staff use Readiness → Review cost evidence for a specific selling pack. The authenticated backend independently checks the role; support and public clients cannot read or write cost records.

1. Review the current revision and pack quantity. Enter wholesale USD per piece; blank explicitly invalidates it as unknown. Keep source precision (up to six decimals). Additional duties, inbound freight and supplier fees are per selling pack, with distinct unknown, documented-zero and positive-amount states. Do not repeat customer delivery freight or the separate modeled handling allowance.
2. Record an explicit SKU MAP with piece/pack basis, unknown status, or an approver-documented exemption. Zero MAP is not an exemption. Policy-derived MAP remains in the policy-review workflow; do not relabel a multiplier as an explicit SKU minimum.
3. Cite the supplier source and actual observation time, plus a review note explaining zero costs where applicable. Verification starts unchecked. Saving today does not refresh an old source. Unknown wholesale cannot be verified; future timestamps are rejected. A populated cost is not automatically a confirmed cost.
4. Saving appends a revision and source observations, closes the previous revision's effective interval, and retains original cost values. Concurrent edits fail against the expected revision. Exact retries reuse the saved result; changed retries are rejected. The form retains edits when another staff member updates the record and requires an explicit reload.
5. Approved retail/trade prices and financial history are unchanged. A manual hold and review task require requalification and explicit owner release review through the existing hold/publication workflow. No save action publishes, clears another hold, approves a supplier policy, changes a commission already earned, or changes an accepted customer order.
6. Recompute scenarios against approved settings; reconcile MAP and expense completeness, preserved prices, commission schedule, margin, inventory and delivery evidence before owner release. Unavailable/discontinued and original exclusions still require their independent review. Canonical revisions are authoritative; old draft/import snapshots remain historical until the reviewed catalog projection/publication workflow updates them.

Freshness checks reject future/nonfinite observations and unverified inventory. A valid price-list date does not bless an absent/future cost-verification timestamp. Numerically equivalent decimal cost observations are not conflicting solely because of trailing zeros; current genuine conflicts still block. Expired conflict observations no longer invalidate current evidence.

Phase 5d deployment: PR 255 merged as `df7c4e3`; main CI 42544010783 and both production targets succeeded. The unauthenticated cost-detail production request returned an error with no cost data; public v2 rollout flags remained false. No production costs or prices were changed. Estimate validity now uses the selected verified stock observation instead of the newest arbitrary inventory timestamp.

## 17. Warehouse and carton evidence

Operations staff use Delivery → Warehouse and shipping carton evidence. Queries expose shipping facts and source history, not supplier cost or margin records. Approvers additionally manage warehouse evidence.

- Select the exact supplier SKU and selling pack. Enter each carton type's count, packaged length/width/height and gross weight, with explicit inches/mm and pounds/grams. Counts describe one sellable pack and are never multiplied by its piece count during data entry. No assembled dimensions or average dimensions are substituted.
- The server accepts at most 20 carton types / 100 physical cartons per pack and bounded positive source decimals. Version `carton-evidence-v1-ceil-mm-g` converts exactly, conservatively rounds upward to whole millimeters/grams and sorts dimensions longest-first. This may add less than one millimeter/gram; raw input and normalized output remain in an append-only observation. Supplier-required LTL remains LTL. Unknown routing remains unknown.
- Select a documented warehouse belonging to the same supplier, or explicitly leave the origin unknown. Missing/expired warehouse evidence cannot qualify automatic rating. No origin is inferred from a product name or the historical default ZIP.
- Warehouse approval requires the source/address reference, actual observation time, evidence-validity end, verified US ZIP/state, IANA timezone, local dispatch cutoff, active status and documented Ground/LTL dispatch capabilities. The approval form requires staff to verify ZIP/state against the source; it does not claim an address-verification adapter. New approvals apply immediately and expire within a year; disabling an expired warehouse is supported. These operational cutoff fields do not calculate or promise an arrival date.
- Warehouse codes are unique within a supplier. Writes compare the previously read revision timestamp, advanced monotonically even for same-millisecond edits. Changed retries fail; exact retries return their prior record. Warehouse updates retain the same assignment ID but audit complete before/after evidence. Existing estimate fingerprints include the entire warehouse record, so changes invalidate dependent estimates. Estimate validity cannot exceed warehouse evidence validity. Rating checks documented dispatch modes after parcel/LTL classification.
- Shipping updates compare the full current carton/origin fingerprint and use request-bound idempotency. Concurrent changes retain form edits and require explicit reload. Current carton rows are replaced atomically; old facts remain in audit events and source observations. The last 20 shipping observations are visible in the form. A routing change opens METHOD_CHANGED; every shipping evidence update retains all other holds and opens manual delivery/economics requalification. Saving never changes approved prices, package quantities, earned commissions or paid order snapshots.
- Warehouse or carton approval alone is not approval of inventory, carrier rates, supplier fee scope, customer delivery charges, allowances or stock reservation. Those independent gates remain required. No carrier quote, supplier PO, notification or payment is sent by these forms.

Phase 5e deployment: PR 256 merged as `81bcca7`; main CI 42546169564 and both production targets succeeded. The unauthenticated shipping-record query returned an error with no records; public v2 rollout flags remained false. No production warehouse or carton data was edited.

## 18. Warehouse-specific inventory evidence

Operations staff use the stock form inside the selected shipping record. The old binary `recordStock` mutation now rejects new writes: it did not record the source's actual timestamp, warehouse or quantity meaning. Historical observations remain intact.

- Choose the meaning of the source: available for new orders after existing allocations, physical on-hand count, binary status, or unknown. An on-hand count is not silently promoted to available-to-sell inventory. Binary/on-hand evidence requires supplier quantity confirmation before a payable quote; a freight quote does not override this requirement.
- Enter the assigned warehouse's quantity only. Never aggregate California and Florida or count in-transit stock/ETAs. Quantity must be an exact nonnegative whole count (source trailing decimals are retained), at most 1,000,000. Blank is unknown, not zero. Binary status has no count.
- State the quantity basis explicitly. Piece counts are floored into complete selling packs; pack counts are not multiplied again. The explicitly limited “piece or pack” ambiguity is equivalent only for a one-piece selling pack. Unknown units or a multi-piece ambiguity remain held. Counts below the minimum order size are not purchasable.
- Cite the source and actual observation time. Verification starts unchecked. The optional supplier expiry is stronger than the approved freshness policy; blank expiry never extends that policy. Future source timestamps, earlier replacement observations and fractional quantities are rejected. Unknown, stale or unverified revisions cannot fall back silently to an older positive observation.
- The append-only stock revision freezes the warehouse fingerprint and pieces per pack. A warehouse edit, reassignment or pack change invalidates its eligibility until rechecked. Concurrent form changes fail against revision, pack, warehouse ID and complete warehouse fingerprint; edits stay visible until explicit reload. Exact retries return the same revision, changed retries fail.
- Saving never changes approved prices or removes original exclusions. It opens a manual release hold. Reinstating a discontinued variant requires an approver and verified source; original exclusion holds remain. Support/public clients cannot read or edit these records. Current projections may change; historical stock revisions, source observations and audit events remain retained.
- The estimator enforces the current per-cart warehouse quantity and source validity. Available-to-sell counts are distinct from supplier reservations. **Do not activate checkout until the next reservation-capacity phase atomically subtracts competing internal holds and reconciles supplier allocations.** Existing reservation rows alone are not proof that the supplier reserved physical inventory. No production stock approvals, orders, payments or messages are created by this evidence phase.

Source audit: the saved Nov 8 packet contains 577 non-excluded products: 514 with positive California on-hand counts (363 single-piece / 151 multi-piece), 59 without an inventory match and 4 without on-hand stock at either origin. These are historical source counts, not a current sale-eligibility assertion. The downloaded access instructions describe daily/hourly feed options but do not establish piece/pack basis or allocation semantics. Credentials and source files remain outside git; no feed enrollment or supplier outreach was performed.


Phase 5f deployment: PR 257 merged as `e5f789b`; main CI 42548986173 and both production targets succeeded. All eight public rollout flags remained false. No stock evidence was approved in production. CodeRabbit skipped automatic review under its repository eligibility rule; no review comments were present.

## 19. Internal inventory capacity and supplier reconciliation

- Every new Zuo checkout recomputes the verified warehouse quantity and subtracts other unexpired internal holds plus unreconciled paid commitments in the same serializable mutation that creates its own hold. Concurrent checkout attempts conflict and retry against the changed capacity. Exact checkout retries reuse the existing intent and never deduct twice. Expired unpaid holds no longer consume capacity; failed/expired sessions release them. This does not reserve stock at the supplier.
- New holds freeze warehouse, stock revision, selling-pack size and creation time. Unknown legacy origin/pack obligations fail closed instead of being silently ignored. Different known warehouses are independent. Pack changes while commitments remain require review. The read limit is 500 active holds and 500 consumed commitments per variant; overflow requires reconciliation and never truncates deductions.
- A new feed or stock revision does not automatically reset paid commitments. Estimates also respect available capacity, but remain nonbinding; checkout rechecks it. Existing approved Ashcroft behavior is preserved, rather than inventing a warehouse count for that separate route.
- Verified payment rechecks the live internal hold, current warehouse evidence, source freshness/quantity and competing commitments. A shortage, changed origin or stale evidence creates a `stock_failed` paid-order exception without another charge. Paid exception commitments remain consumed even after their original expiry. Payment evidence and accepted totals remain retained; no automatic supplier order is sent for the exception.
- Operations can inspect up to 50 pending paid allocations for a selected SKU under Warehouse and shipping carton evidence. More become visible as those are reconciled. Approvers can attest that a newer verified warehouse available-to-sell count includes a specific paid allocation. The server requires the same warehouse/pack basis, a newer revision observed after payment, recorded supplier handoff before that observation, supplier acknowledgement and a complete matching allocation. Queued, uncertain, cancelled or unresolved paid-exception obligations cannot use this normal reconciliation action.
- Every reconciliation requires a source reference, explicit confirmation and review note. It binds to the current stock revision, appends before/after audit evidence, and stores the reconciliation revision on the reservation. Exact retries are idempotent; changed payloads or concurrent changes fail. Staff notes remain visible after a stale-source rejection. Historical order/payment/commission records are untouched.
- Fixture tests do not send payments, supplier orders or emails. No production holds, stock approvals, reconciliation actions or rollout switches are changed in this phase. Paid-exception resolution, supplier contracts/current source inputs and full permitted production verification remain separate release gates.


Phase 5g deployment: PR 258 merged as `f03dcb9`; main CI 42550612655 and both production targets succeeded. All eight rollout flags remained false. CodeRabbit skipped automatic review under repository eligibility; no actionable comments were present. No production stock/reservation/reconciliation records were changed by the deployment verification.

## 20. Verified paid-exception refund recovery

- The old note-only `resolvePaidException` mutation refuses new resolution writes. Historical resolutions remain intact. Finance staff open Dealer orders → Paid orders needing resolution, select the exception and run **Verify existing payment and refunds**. This is a read-only Stripe operation; it never creates, captures, cancels or refunds a payment, sends a supplier order, or contacts a customer.
- Verification authenticates staff before provider access, consumes a persistent per-staff budget (10 burst, 2/minute), and uses two bounded provider reads with four-second timeouts and no automatic SDK retries. The session, checkout metadata, PaymentIntent, latest charge, currency, amounts and live/test mode must agree with the stored exception. Refunds must belong to that payment/charge; more than 100 refund records require investigation rather than a truncated total.
- Append-only verification records keep provider references, verified amounts, successful/pending refunds, dispute/capture state, mode, reviewer and a five-minute validity period. No card details or provider customer/contact payload is retained. Provider failures produce a safe reconciliation error and leave the exception open. Every new verification is independently auditable.
- An approver may record a full completed refund only using the latest unexpired verification, a captured USD payment without an active dispute, successful refunds exactly equal to the payment, and no pending refund amount. Partial, failed, pending or disputed outcomes remain open. A payment with an existing order must use that order's return/fulfillment reconciliation.
- Record the customer agreement and supplier cancellation or verified no-handoff evidence, and explicitly confirm no supplier fulfillment remains outstanding. Resolution releases only this checkout's stock commitments and unredeemed reserved credit, records `refunded` on the intent, and appends the proof and decision to the audit trail. It does not change accepted prices, fabricate a supplier cancellation, issue cash or create an order. Changed retries and concurrent/stale proof are rejected; exact retries remain harmless.
- An authorized receipt now distinguishes a verified refund from an unpaid/failed checkout. It states that bank display may take longer and preserves the customer's cart. Guest/account access checks remain unchanged. No new confirmation email is sent by this administrative record action.
- Platform checkout ingestion rejects a different Stripe mode and connected-account payment events before storing platform payment work. Existing legacy payment paths are not silently migrated. All provider verification tests use fixtures; no real test payments, refunds, transfers, payouts or provider verification calls were made.
- Original-order fulfillment recovery, legacy exceptions without verifiable references, refund-failure follow-up, operational ownership and permitted end-to-end production verification remain open release work. Do not turn on checkout merely because refund recording is available.

Provider semantics: [Stripe refund statuses and refund events](https://docs.stripe.com/refunds) distinguish pending/failed outcomes; [the Refund object](https://docs.stripe.com/api/refunds/object) supplies status and payment/charge references. Recording a refund request is not proof of a successful refund.


Phase 5h deployment: PR 259 merged as `e719061`; main CI 42552408442 and both production targets succeeded. An unauthenticated exception-queue query returned no data; all eight rollout flags remained false. CodeRabbit skipped automatic review under repository eligibility; no review comments were present. No provider payment verification or financial action was performed against production.

## 21. Original paid-order fulfillment recovery

- New checkout snapshots freeze supplier SKU and warehouse identity. Recovery rejects changes to those identities. Order lines preserve the accepted SKU and pack basis for manual queues and future EDI payloads, even after catalog edits. Older intents without a frozen SKU record the canonical SKU at order creation with an explicit provenance marker; this is not historical checkout evidence. Existing older order lines retain their compatibility fallback and require source review before supplier handoff.

- Finance first verifies the existing payment using the read-only path in section 20. An approver can review original fulfillment only for a captured, undisputed, unrefunded USD payment with no pending refund, matching the original session and exact accepted cash total. The latest proof must still be valid. Missing email/address/service terms, changed references or an existing order for the intent/payment require investigation instead of a duplicate order.
- The recovery form displays the frozen products, selling-pack and piece quantities, delivery destination/service, applied credit and cash total. None is editable. For every original line, record the supplier availability evidence, its actual observation time and available selling packs. Confirm the customer's agreement to original fulfillment, that the original service can be provided at the company's expense, and that no supplier handoff already occurred. Previously submitted or substituted orders use a separate investigation; this action must not be used to place them again.
- Every confirmation follows the supplier's approved freshness limits. SKU/product/supplier, pack size and availability must still match. Zuo also needs current verified warehouse available-to-sell evidence, the original origin and capacity after other checkouts/paid allocations. Ashcroft retains its existing listing availability gate plus the explicit fresh manual supplier confirmation. A stock source or form fingerprint change requires another review, never silent reinterpreting of the original basket.
- Current cost or freight changes remain the company's responsibility under the approver's explicit confirmation. Recovery does not reprice, substitute, change delivery charges, publish a product, clear catalog holds, or reduce a recorded referral rate. Normal sale eligibility remains separate from honoring an already-paid accepted order.
- If expiry released store credit, recovery re-reserves the exact accepted amount under a separate audited reference. Insufficient available credit fails atomically; it cannot quietly remove the credit or charge the customer again. Already redeemed credit without a corresponding order requires investigation. The old credit events are retained.
- One shared verified-order finalizer creates the order, original lines, supplier partitions, credit redemption, frozen attribution accrual, quote conversion and tax-reporting job. The recorded paid time is the exception's original verified-payment observation time, not the later recovery time. Supplier children remain queued for manual handoff; this action sends no supplier PO and creates no payment. Normal customer confirmation is queued through the existing notification safeguards after transaction commit.
- Existing valid attribution snapshots retain their recorded category/rate/basis during recovery even if new commission accrual is paused. Payout execution remains independently disabled unless approved. No attribution is invented, no new eligibility is granted and trade-priced orders still earn no purchase commission. Tests explicitly cover recovery during an accrual pause and trade exclusion.
- Recovery reconstructs missing internal holds only against verified current original fulfillment facts. It retains old reservation/credit state in the audit event, rejects excess or already-reconciled commitments and blocks a changed known warehouse. Exact retries return the same order; changed retries and concurrent source changes fail. Original financial snapshots, prices, accepted terms and audit history stay preserved.
- UI edits remain visible when payment or order inputs change; staff must explicitly reload before submitting. No fixture test sends a payment, refund, supplier order or real notification. Provider refund-failure follow-up, missing-reference legacy exceptions and operational verification remain open release work.

Phase 5i deployment: PR 260 merged as `4e037c2`; main CI 42555220598 and both production targets succeeded. All eight rollout flags remained false; an unauthenticated exception-queue query returned no data. CodeRabbit skipped automatic review under repository eligibility; no review comments were present. No payment, refund, supplier handoff or notification was sent for verification.

## 22. Refund status changes after an exception resolution

- The signed platform webhook accepts `refund.created`, `refund.updated`, `refund.failed` and the legacy `charge.refund.updated` event. It stores only refund/payment/charge identifiers, status, event time and the payload hash. Refund metadata and customer bank/card details are excluded. The durable event ID prevents duplicate application; mode and connected-account mismatches are ignored. Platform refund and dispute reversal routes enforce the same payment scope.
- Each refund event increments the affected exception's payment-state version in the transaction acknowledging it. An older verification cannot authorize refund closure or original-order recovery. A provider read begun before that event cannot save a proof afterward without restarting. Staff notes remain visible while the UI disables the stale proof. Payment verifications remain append-only.
- New verifications record which refund IDs were successful, not merely which IDs appeared in the history. If a refund supporting a completed-refund resolution fails or is canceled, the exception reopens and the private receipt returns to review-required. Prior resolution/proof remain in history. A delayed failure for a different refund already excluded by a newer successful verification does not reopen that newer resolution. Legacy proofs without status-specific IDs require a matching ID and event time after verification; staff must investigate ambiguous older evidence.
- Failure creates an operational review item. It does not issue another refund, charge a customer, place an order, restore a cancelled supplier handoff, consume released stock, or take back available store credit. A failure on an already-created order queues reconciliation of actual refund, tax, credit and commission records without automatically rewriting the ledger. A new resolution requires current provider verification and the existing explicit approval workflow. Resolve the follow-up review only after documenting the financial reconciliation.
- Configure the production Stripe endpoint to deliver these refund events and retain evidence of its subscriptions and permitted delivery verification before activation. Code deployment does not prove endpoint subscription or a real bank refund. Tests use local signed fixtures with no Stripe network calls or financial transactions. Supplier inputs, missing-reference legacy cases and permitted operational verification remain separate gates.

Provider references: [Stripe refund events and failed refunds](https://docs.stripe.com/refunds), [event definitions](https://docs.stripe.com/api/events/types).

Phase 5j deployment: PR 261 merged as `c5f7d14`; main CI 42556723358 and both production targets succeeded. All eight rollout flags remained false; unauthenticated exception access returned no data. CodeRabbit skipped automatic review under repository eligibility; no review comments were present. No live payment/refund events or notifications were sent for testing.

## 23. Staff shipment workflow and physical-piece progress

- Operations opens **Manage shipments** on the relevant supplier child in Dealer orders. The panel shows the full accepted destination (including unit), service, supplier SKU and exact physical pieces remaining. It records a supplier acknowledgement and optional whole-cent confirmed amount; a higher amount opens the existing discrepancy review. It never orders through a supplier account or sends EDI.
- Manual handoff rejects invalid amounts and cannot replace an EDI handoff. Exact matching handoff/acknowledgement retries are harmless. Acknowledgement cannot reset a shipped/cancelled child to an earlier state. Record shipments only after the supplier handoff exists, using distinct allocations, whole physical-piece quantities and no more than the remaining quantity. Multi-piece selling packs may ship in separate physical shipments.
- Shipment and cancellation commands use actor-bound request keys and complete payload hashes. An exact retry returns the original outcome; changed payloads are rejected. The UI locks an uncertain shipment/cancellation/update payload and offers an exact retry before entering another operation. A typed transactional rejection permits correction. Do not discard an uncertain form and blindly record the same shipment again; inspect the recorded shipment history if the tab was closed.
- Parent order progress counts actual dispatched/delivered pieces, not just allocations whose entire selling pack shipped. The first dispatched piece produces partially shipped; the first delivered piece produces partially delivered. All noncancelled pieces must be delivered before the parent becomes delivered. One supplier's cancellation does not resend or cancel the other supplier's order.
- Entirely unshipped allocations can be marked cancelled only with supplier confirmation evidence. Any allocation with dispatched pieces is rejected from that shortcut and requires reviewed partial cancellation/return handling. Cancellation is not a refund. Its notice identifies the cancelled items; frozen paid totals remain unchanged until the approved refund workflow records the financial outcome.
- Operations can record delay, loss, damage, other delivery exceptions and resolution on a particular shipment. Internal carrier/support evidence stays in the audit record; the separately entered customer-facing update appears on order status. Email notification is unchecked by default and queues through the existing outbox only when explicitly selected. The update names only the affected shipment's items and gives a support action. Resolving an issue preserves its history and customer-facing resolution text. It does not create a replacement, refund or extra charge.
- Delivery confirmation is specific to one shipment and cannot clear an open incident silently. Resolve the incident with evidence first. Repeated delivery confirmation preserves the original delivered time. Customer tracking displays each shipment's actual item quantities; shipment notifications say all remaining items have shipped without claiming they have been delivered.
- Tests use fixture orders and queued notification records only. No supplier order, live customer email, shipment booking, refund or payment was sent. Actual carrier confirmations, return-policy evidence, production permissions and the permitted operating pilot remain required before launch.


## 24. Accepted commissions and delivery rollback

Ordinary verified payments and approved original-order recovery both honor an attribution snapshot already frozen on the intent. A pause of new commission accrual does not cancel that accepted obligation. Do not delete snapshots or switch a v2 order to legacy accrual during rollback. New referral links and payout execution have their own switches; retaining a pending ledger obligation does not transfer money.

Verification: fixture payment after attribution/accrual switches are disabled must record the frozen rate once, on merchandise after discounts/credit only. Repeat the event under a new provider event ID and confirm no duplicate obligation. Trade purchases and missing/ineligible snapshots must remain commission-free. Production confirmation uses existing authorized transaction evidence; do not create a real test payment or payout.

Dealer evidence observation (November 8, 2026 America/Chicago): an existing Zuo session showed the account signed in, but its dashboard returned a MalCare firewall block. This is not evidence of current account rates, private-label permission, inventory basis or supplier approval. Continue only from accessible verified documents/account evidence; do not bypass the block.


## 25. Pricing qualification before publication

Recompute after any cost, policy or price change. A populated wholesale cost alone is insufficient: duties, inbound freight and supplier fees must each be known or explicitly confirmed zero. Failed economics opens PRICING_UNVERIFIED and the shared sellability gate independently checks expense completeness. Do not manually clear a hold as a substitute for correcting its evidence.

The internal scenarios now include `trade_approved` using the actual approved pack price, separately from hypothetical 5%/10% comparisons. Its minimum is `max(base pack cost / (1 - processing - returns - overhead - required margin), pack MAP)`, rounded up once. Retail referral commission is excluded from a trade purchase. This is an internal economic floor, not permission for a new public discount, coupon, project stack or price change; those mechanisms and approval controls remain separate.

Publication rechecks current economics even if stored holds were removed. Approving only a trade price cannot qualify an underpriced retail item. Zuo referral enablement requires current evidence and retail qualification; existing paid attribution is never changed by requalification. Price revision records retain the effective margin and rounding policy versions rather than a hardcoded version 1.

## 26. Operations workspace accessibility

Check the delivery, decisions and dealer-order views in both owner and scoped staff shells. At 320px and desktop widths, headings, selected options, placeholders and entered values must remain readable; controls must fit their cards. Tab through section navigation and forms to verify visible focus, then check a touch viewport for usable control targets. Long internal evidence and JSON may scroll within their own containers without widening the page. Do not submit operational mutations merely to test presentation.

## 27. Supplier fulfillment cost and recipient integrity

The supplier unit cost in a pack-based PO is the exact source piece cost multiplied by the accepted pieces per pack, rounded half-up once to cents. It is not a rounded piece cost multiplied afterward. Publication and import projections use the same conversion. Pricing calculations retain their exact rational inputs and their own final retail rounding rules.

Use the immutable order-line cost revision and accepted pack/SKU snapshot for a paid order, even after a current catalog cost changes or disappears. The EDI draft uses the accepted recipient name, phone and address; it excludes internal access metadata from the generic ship-to object. A missing legacy recipient name or state requires reviewed correction, not an invented name. Production EDI still requires approved supplier mappings/service fields, onboarding and transport verification; this cost fix neither enables EDI nor submits an order.

## 28. Legacy refund timing

Provider event timestamps have whole-second precision. For legacy proofs without a successful refund-ID set, a matching failure in the same second as verification is uncertain and reopens reconciliation. Do not dismiss it solely because the proof contains later milliseconds. Newer proofs retain explicit successful IDs; a refund already excluded by that authoritative read does not reopen its replacement resolution. Preserve all historical proof and ledger records and verify the current provider state before any reviewed corrective action.

## 29. Internal pricing/source export version 2

Use **Delivery & freight → Export all internal pricing/source records** for a paginated finance-only JSON export. `recordVersion: 2` preserves approved prices and adds expense completeness, source/effective-date references, margin policy/version, price validity, commission qualification reserve and current economic results. A failed calculation returns `economics.status: review_required` and its reason; it never fabricates a margin from unknown costs. Computed merchandise contribution is not destination-specific delivery profitability or permission to publish.

`images`, `sourceImages`, `publishedImages` and `imageSource` distinguish staged supplier references from currently published retail media. A source image does not clear MEDIA_RIGHTS or MEDIA_MISSING. The $10 handling allocation is per physical piece; actual supplier-order fees remain a separate delivery-rule input. Retain the downloaded file privately with its export timestamp and re-export after evidence changes. Verify all expected unique variant IDs rather than only the first visible page.

## 30. SKU-specific media review

Verify a supplier photograph against the exact SKU, pack ID and color shown in the canonical variant record. A hero image is not approval for all sibling variants. Record a separate association for each different role, variant or rights basis even when the bytes are identical. A product-level photo can qualify only its recorded SKU/pack/color; retargeting requires a separate association. Assembly instructions and swatches cannot satisfy the product-photo requirement.

Rejecting an already verified photo reopens the matching media hold for reviewed replacement. It does not alter a paid order's snapshot. Publication also checks the actual media association, so clearing a hold alone cannot publish a variant with unreviewed photography. Media rights remain a separate requirement; ingest, stored bytes and a source URL do not grant a license or prove private-label permission.

## 31. Preparing previously uploaded supplier photographs

In **Catalog & import → Supplier image preparation and review**, open a SKU and choose **Prepare uploaded source image**. This uses the source already attached to that exact staged SKU/pack, validates its SHA-256 and generates web copies. No stored upload means an explicit source-review error; the action does not guess a URL. Preparing is safe to retry and never clears publication holds or approves the image.

Inspect the photograph against the SKU, pack and color, write accurate alt text, and explicitly confirm the visual check before saving. Source provenance is not a license: MEDIA_RIGHTS and other cost, inventory, MAP and delivery checks remain separate. Do not approve an image solely because preparation succeeded. Private originals are not used in new public snapshots; prepare web derivatives first. Preserve paid snapshots and original source evidence.

The Node runtime installs the locked Sharp dependency via `convex.json`. Verify a real staged preparation after deployment before bulk processing. If attachment returns an uncertain failure, retry; do not delete outputs that could already be referenced. Any cleanup of uncertain orphan files requires checking current references first.

The media workspace also supports **Prepare all included stored sources**. It walks every page sequentially, skips excluded/discontinued records, reports per-SKU errors and supports stopping after the current image. Retrying verifies source bytes and reuses an already prepared association. It never calls visual approval or publication in the batch loop.

## 32. Current storefront eligibility verification

After deploying the current-eligibility phase, verify an eligible Zuo listing appears only when its rollout flag, current cost/stock evidence and approved effective price pass. A newly held variant, expired evidence or price that differs from the published snapshot must disappear from new retail list/detail results. With multiple variants, eligible siblings remain. Cart/checkout still revalidate; an already open browser card is not an inventory reservation. Never change a paid order snapshot to repair the current catalog.


## 33. HOLM catalog and project connection

Verify all published-listing pages load, including eligible entries after position 300. For Zuo, confirm disabled trade checkout hides entries; current evidence and price parity are required even for published records. Guest/unapproved viewers must not receive trade prices.

Check a saved unavailable product and a changed saved default variant: submission blocks and offers removal, never a replacement. Check required pack increments, repeated items in different rooms, and exact product/variant/pack transfer. Canonical-only projects enter guarded trade checkout; mixed-provider projects retain every line in a quote request. A quote request is not a payable quote or a confirmed freight charge. Do not enable supplier publication until evidence and media review pass. Do not perform real test payments or transmit supplier orders without authorization.

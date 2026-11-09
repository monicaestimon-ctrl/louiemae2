# Delivery completion goal: phase register

Started 2026-11-08 after PR 243 deployed as `c573e61`. This register tracks remaining work, not a claim of complete implementation. The controlling requirements are the 22-section end-to-end specification. Each phase requires code review, tests, PR, actionable-feedback resolution, merge and deployment before the next implementation phase.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Complete quote states, safe expiry/revision/payment conversion, owner decline/cancellation, retry UI and request limits (§12–13, SEC02, PAY01). | Merged PR 244 (`d2b67c3`); main CI 42523335583 passed, including Convex deploy/seed; Vercel production succeeded. Automatic CodeRabbit review skipped by repository eligibility; no review comments were present. |
| 2 | Accurate service labels/terms and destination/access handling across PDP, cart, quotes and paid snapshots (§5–10, §14). | Merged PR 245 (`3cc9de5`); main CI 42525621860 and Convex deployment/seed succeeded; Vercel production succeeded. 42 focused tests plus full CI passed. No review comments; automatic CodeRabbit skipped repository eligibility. |
| 3 | Durable monitoring, latency/error/quote separation, quote SLA and cost-floor alerts, operational readiness and evidence (§16, §20). | Merged PR 246 (`0002c5b`); main CI 42527280305, Convex deploy/seed and Vercel production succeeded. 41 focused tests plus full CI passed; no review comments; CodeRabbit skipped repository eligibility. |
| 4 | Security/perimeter, privacy/retention, notification recovery and production staff configuration (§11, §17). | 4a merged PR 247 (`3fcd034`); main CI 42528927375, Convex deploy/seed and Vercel production succeeded. 4b merged PR 248 (`fc74252`); main CI 42530326365, Convex deploy/seed and Vercel production succeeded. Read-only invalid-reference probe returned unavailable. 4c merged PR 249 (`78b122f`); main CI 42531821318, Convex deploy/seed and Vercel production succeeded. 4d merged PR 250 (`7460da1`); main CI 42533991178, Convex deploy/seed and Vercel production succeeded. Signed production probe returned FEATURE_DISABLED, direct unsigned action FORBIDDEN, invalid body INVALID_INPUT. 4e merged PR 251 (`759c049`); main CI 42535490647, Convex deploy/seed and Vercel production succeeded. Unauthenticated session probe returned no staff access. |
| 5 | Pricing/carrier/tax/SKU evidence reconciliation and approved scoped policies (§2–9, §21 D1–D3). | 5a merged PR 252 (`01f89dd`); main CI 42536623497, Convex deploy/seed and Vercel production succeeded. 5b merged PR 253 (`adc1139`); main CI 42537859079, Convex deploy/seed and Vercel production succeeded. 5c stored-catalog migration in implementation. Actual 803-row fixture replay passed; this does not activate products. Existing downloaded documents identified; do not substitute public freight examples for actual account rates. |
| 6 | Complete deployed retail/trade/quote/fulfillment accessibility and integration verification (§18–19, §21 D4–D7). | Fixture evidence exists; full production journeys still unverified. Existing financial-testing restrictions apply. |
| 7 | Approved pilot activation, real invoice calibration, rollback rehearsal and expansion (§21 D8, §22). | Requires verified operational inputs and actual shipment evidence; cannot be completed by code or synthetic transactions alone. |

Audit each subsection as phases progress. Features not covered by a passing test or recorded operational evidence remain open. No blanket “all implemented” status is permitted because a PR merged or deployment succeeded.

## Phase 1 review notes

- Five-token request bucket previously refilled at 3,600 tokens/minute. Corrected to five/hour, with independent email/account and global budgets; exact idempotent retries remain allowed.
- Quote drafts now move their request into ready-for-review and bind the current version. Closed/paid requests cannot receive new versions; an active payment cannot be invalidated by staff revision.
- Expiry uses an indexed bounded cron; accepted quote terms stay immutable. Read paths also derive expiry immediately. Legacy rows without indexed expiry still get correct read-time state; later evidence migrations can populate their optional expiry field.
- Customers can cancel/decline only their own unaccepted request. Accepted requests require reviewed staff handling. Duplicate closure is harmless; old versions cannot be accepted.
- Verified payment links the request to its order exactly once, including a valid frozen payment completing after quote expiry. No redirect changes paid state.
- Admin can retry attaching a sent version when the first send/attach sequence was interrupted. Offline acceptance rechecks request state and current economics.
- Future phases must not silently approve rates, publish held catalog records or perform restricted financial testing.


## Phase 2 review notes

- Automatic delivery needs approved `serviceLevel` / `delivery-curbside` terms for its actual parcel, freight or supplier mode. The seed is proposed, not active. No carrier contract or service approval is inferred from a priced SKU.
- Full-address checkout captures recipient, residential/commercial location, requested service, stairs, restricted access and commercial loading dock. Special service/access routes to a quote. Commercial/dock answers do not discount the conservative freight estimate.
- ZIP-only estimates remain nonbinding. A changed recipient/access choice invalidates the full-address estimate. Quote handoff preserves address, suite, phone, email and access; retries retain contact inputs and use the same idempotency key for an identical request.
- Staff quote editor preloads those details and requires explicit service/access confirmation before saving. Payable manual quotes require recipient/access data. Existing draft records remain readable but incomplete ones cannot become payable.
- Service labels/details are customer-safe approved text, stored with estimates, payment intents and orders. Confirmation includes frozen terms and delivery destination. Existing historical orders remain unchanged.
- Ashcroft has no presumed `per_item` service terms: its v2 automatic flow remains quote-only until documented/approved. The legacy Ashcroft price/delivery path is unchanged. No supplier rates, pricing floors or catalog holds are approved by this phase.
- Exact street/ZIP deliverability and production carrier-service evidence remain operational verification work; the input form is not an address-verification service.


## Phase 3 review notes

- Storefront PDP, trade calculator and checkout use the observed action. One observation is persisted in a separate transaction per request, including failed estimate transactions; internal tax iterations do not inflate request counts. The existing direct mutation remains for old clients, is explicitly excluded from request telemetry and should not be used by new surfaces.
- Expected quote traffic, policy/authorization blocks, missing tax readiness and operational errors have distinct counters. Matrix and matrix-with-tax timings are separate. No live freight-carrier adapter or estimate cache is claimed.
- The rolling 15-minute report shows nearest-rank p95, sample counts, latest sample time, error rates, reason-code counts and supplier/origin/zone/mode/service breakdowns. Multi-supplier scopes overlap. Sample and breakdown caps are explicit.
- Alert thresholds are versioned proposed settings, require approval and respect the existing `BACKGROUND_MONITORING_ENABLED` switch. Staff follow-up uses elapsed hours since the last request update; customer-information waiting states pause staff SLA. Cost-floor review items feed the same alert path.
- Observation retention defaults to seven days, configurable 1–90 days through reviewed policy. Hourly cleanup removes at most 500 old operational rows. It never changes invoices, orders or audit history. Observation records contain no addresses, contact details, guest capabilities or prices.
- Tax calculation is capped at three iterations, with per-request timeout bounded by the remaining eight-second provider-work budget and SDK network retries disabled. Unconfirmed tax returns a quote path, never a guessed payable total. Actual request latency also includes backend transaction time; the target is measured, not guaranteed.
- Production alert activation, named owners and real lane/invoice evidence remain deployment-readiness tasks. This phase does not approve supplier rates, send test notifications or execute payments.

- Follow-through review found Stripe’s hosted shipping label still used the old curbside label. Checkout intent responses now supply the frozen approved service label to the hosted session too; old intents use neutral wording. No payment was created to test this.


## Phase 4a: notification delivery and recovery

- The old outbox treated a helper returning without a send as success. New queue entries require a provider acceptance ID; this does not prove inbox delivery. Legacy send records without receipts remain unverified and are never blindly replayed.
- A versioned outbox freezes recipient, sender, reply-to, subject and text on its first attempt. An internal sender uses a fixed HTTPS endpoint, rejects redirects, aborts after ten seconds and bounds response size. It records only fixed, customer-safe error descriptions.
- Claims expire after two minutes. Attempt and generation fences reject late worker results. Recovery is bounded; up to five attempts use exponential delay with jitter and the same provider idempotency key/payload.
- Automatic retries stop before 23 hours, inside [Resend’s documented 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys). Provider contract: [send email response](https://resend.com/docs/api-reference/emails/send-email). No production messages were sent for testing.
- Authorized staff can paginate queues, record an existing provider receipt, stop retries, or explicitly requeue a message only after confirming provider records show it was not accepted. Every decision requires evidence and an audit entry. Known accepted messages cannot be resent through this control. Marketing messages cannot bypass their separate consent workflow.
- Remaining 4b findings: order status currently relies on order number/email; checkout success currently claims confirmation/email success without verifying payment; guest access expiration, error privacy, request-context limits and retention need review. These are not marked complete by this phase.


## Phase 4b: verified checkout return and private order access

- The success route no longer treats a URL visit as payment. A read-only subscription waits for the verified-payment intent and saved order, distinguishes pending/review/expired/failed, and never creates a charge or changes payment state.
- Customer details require the purchasing account or a scoped guest capability. Guest-email recovery requires a stored verified email on the signed-in account; merely knowing an email/order number does not grant access. An account-owned order remains restricted to its owner.
- Guest order access lasts 90 days from intent creation. New intents freeze the capability digest so later quote preparation cannot invalidate the accepted order's access. Estimate guest reads also expire after 90 days. Historical records remain readable under their existing estimate scope, with the new expiration control.
- Checkout stores its guest capability in tab-scoped sessionStorage, never a new URL or localStorage entry. Quote payments do not clear the retail cart. Confirmed normal checkout only clears the matching original cart once; newly added/changed items remain. If browser storage is unavailable, payment still works and account/support recovery is offered.
- The verified receipt displays actual order reference, accepted service, total paid, shipment groups, tracking and split disclosure. Provider acceptance is distinguished from queued/unverified email and is not represented as inbox delivery. Tracking links accept HTTPS only.
- Legacy Ashcroft checkout returns only recorded payment state and generic split disclosure from its high-entropy session reference. It does not expose items, addresses, contacts, totals or tracking without account/capability authorization. No legacy email receipt is invented.
- New schema fields/indexes are additive; financial snapshots/history are preserved. Tests use fixtures only; no payment or notification was sent.
- Remaining phase 4 work: trusted perimeter rate limits, safe public errors, bounded inputs, retention continuation, role audit and operational configuration evidence.


## Phase 4c: error privacy, input limits and operational retention

- Customer-facing estimate, quote, trade-calculator, order-status and receipt APIs remove internal error detail/custom provider text at the server boundary. Stable business codes remain actionable. Unexpected failures return a generic message and a random reference; logs contain only that reference, and estimate telemetry records it without customer input.
- Request bounds cover total UTF-8 payload, IDs, address/contact fields, visitor hints, service, pack quantities and line count before hashing/provider work. Automatic estimates retain the 30-line limit; manual requests support 100 complete lines. Nothing is silently truncated.
- Checkout reads JSON with a 64 KiB streamed-byte limit, independent of Content-Length, and a five-second overall body-read deadline. Internal checkout validation applies the same field limits. Session-creation logs no longer include raw provider error text.
- Observation cleanup continues in 500-row transactions, at most 100 batches per hourly invocation (50,000 observations). Each batch rereads the effective retention policy; increasing retention protects newly out-of-scope rows. This is bounded catch-up, not a guaranteed physical deletion deadline.
- Financial orders, invoices, accepted terms, commissions and audit history are not deleted. Contact/quote data retention and deletion require the owner's approved records schedule, recorded in the release runbook; the operational cleanup is not a blanket customer-data erasure process.
- Trusted-host request limits and the full staff-permission audit remain separate upcoming work. No supplier policy, rate, catalog hold or financial-testing restriction is changed here.


## Phase 4d: trusted request gateway and durable limits

- PDP, retail checkout and trade calculator estimates, plus manual quote intake, use the same-origin `/api/delivery` server endpoint. It validates origin, JSON and 64 KiB payload size, forwards account authentication, and uses only Vercel's trusted client-IP header. It has no client-IP fallback and fails closed without server configuration.
- The server binds operation and canonical input to a 60-second HMAC proof with a random single-use nonce. Convex verifies proof freshness/signature before permitting work. The old public estimate and quote-creation mutations are now internal-only; direct unsigned actions fail closed. Existing clients must refresh after deployment.
- Rate-limit consumption commits independently before business calculation. Changed baskets, ZIPs and visitor strings do not reset a trusted IP's budget. Estimates allow a 30-request burst and 30/minute refill per IP/account, with a 2,000 burst / 60-per-minute global budget. New quotes allow five/hour per IP/account/email and 100/hour globally. Exact quote retries use separate bounded recovery limits and do not create another quote or acknowledgement.
- No raw client IP is stored. IP keys rotate daily; request buckets expire after seven inactive days and accepted nonce records after two minutes. A bounded minute cron deletes up to 500 expired rows per table. Global budget refusal avoids creating unbounded new principal buckets. These tables contain no financial records.
- Backend calls have a 15-second gateway deadline, browser calls 20 seconds, and no automatic retry of uncertain quote creation. The quote form retains its existing exact-request retry key. Stable safe errors distinguish rate limits from temporary failure; provider messages/authentication headers/secrets are never returned or logged.
- The server-only `DELIVERY_REQUEST_SECRET` must match between the Vercel production project and production Convex. Preview must use its own backend and secret; production credentials are never copied to Preview. Deployment of this protection does not activate delivery, alter costs/prices, send test notifications or execute payments.

- Preview invocation caught an ESM import dependency that a successful build did not exercise. The canonical JSON helper is now a standalone shared module, preserving existing hash serialization while avoiding the pricing-import dependency chain in the server gateway. A transitive runtime-import regression check supplements the deployed endpoint probe.


## Phase 4e: staff permissions and scoped administration

- The shared admin guard now treats an explicit delivery role map as authoritative for legacy/general-admin access too. Only `owner` retains those broad rights; support, operations, finance, approver and engineering must use explicitly role-checked delivery APIs. Allowlisting alone cannot bypass the role map.
- Missing role configuration preserves existing site owners. Empty/malformed maps, unknown roles, duplicate canonical email keys and omitted accounts fail closed. No production accounts or role assignments are changed by this phase. An own-account session query returns navigation booleans only and never authorizes a mutation on the client.
- The site provider no longer subscribes every signed-in customer/staff member to private blog/catalog data or owner bootstrap mutations. Limited staff enter the scoped commerce console without mounting newsletter, inventory or general-admin hooks.
- Support has paginated customer-safe quote status and an explicit customer-total estimate projection; no internal costs, source hashes, account IDs or guest capabilities. Engineering has configuration-presence/feature-state booleans without customer records or credentials. A configured provider is explicitly not proof of connectivity.
- Operations can manage quote/shipment handoffs and their supplier PO amounts/evidence. Catalog economics, actual freight accounting, return calculations and financial health require finance. Price/policy publication, goodwill and return authorization/refund recording require approver. Finance/approver inherit operational access; engineering does not inherit support access. Broader catalog import, marketing and partner/payout administration remains owner-only.
- Console navigation, approval controls and financial exception reads follow those server permissions. Role changes select an allowed screen immediately; hidden tabs are never the security boundary. Fixtures cover direct calls to older endpoints, malformed maps, scoped UI, owner continuity and signed-in catalog isolation.

# Delivery completion goal: phase register

Started 2026-11-08 after PR 243 deployed as `c573e61`. This register tracks remaining work, not a claim of complete implementation. The controlling requirements are the 22-section end-to-end specification. Each phase requires code review, tests, PR, actionable-feedback resolution, merge and deployment before the next implementation phase.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Complete quote states, safe expiry/revision/payment conversion, owner decline/cancellation, retry UI and request limits (§12–13, SEC02, PAY01). | Merged PR 244 (`d2b67c3`); main CI 42523335583 passed, including Convex deploy/seed; Vercel production succeeded. Automatic CodeRabbit review skipped by repository eligibility; no review comments were present. |
| 2 | Accurate service labels/terms and destination/access handling across PDP, cart, quotes and paid snapshots (§5–10, §14). | Merged PR 245 (`3cc9de5`); main CI 42525621860 and Convex deployment/seed succeeded; Vercel production succeeded. 42 focused tests plus full CI passed. No review comments; automatic CodeRabbit skipped repository eligibility. |
| 3 | Durable monitoring, latency/error/quote separation, quote SLA and cost-floor alerts, operational readiness and evidence (§16, §20). | Merged PR 246 (`0002c5b`); main CI 42527280305, Convex deploy/seed and Vercel production succeeded. 41 focused tests plus full CI passed; no review comments; CodeRabbit skipped repository eligibility. |
| 4 | Security/perimeter, privacy/retention, notification recovery and production staff configuration (§11, §17). | 4a merged PR 247 (`3fcd034`); main CI 42528927375, Convex deploy/seed and Vercel production succeeded. 4b merged PR 248 (`fc74252`); main CI 42530326365, Convex deploy/seed and Vercel production succeeded. Read-only invalid-reference probe returned unavailable. 4c public error privacy, input bounds and retention cleanup in implementation. Perimeter/staff configuration remains queued. |
| 5 | Pricing/carrier/tax/SKU evidence reconciliation and approved scoped policies (§2–9, §21 D1–D3). | Existing downloaded documents identified; do not substitute public freight examples for actual account rates. |
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

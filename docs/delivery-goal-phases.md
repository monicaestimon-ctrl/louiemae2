# Delivery completion goal: phase register

Started 2026-11-08 after PR 243 deployed as `c573e61`. This register tracks remaining work, not a claim of complete implementation. The controlling requirements are the 22-section end-to-end specification. Each phase requires code review, tests, PR, actionable-feedback resolution, merge and deployment before the next implementation phase.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Complete quote states, safe expiry/revision/payment conversion, owner decline/cancellation, retry UI and request limits (§12–13, SEC02, PAY01). | Merged PR 244 (`d2b67c3`); main CI 42523335583 passed, including Convex deploy/seed; Vercel production succeeded. Automatic CodeRabbit review skipped by repository eligibility; no review comments were present. |
| 2 | Accurate service labels/terms and destination/access handling across PDP, cart, quotes and paid snapshots (§5–10, §14). | Merged PR 245 (`3cc9de5`); main CI 42525621860 and Convex deployment/seed succeeded; Vercel production succeeded. 42 focused tests plus full CI passed. No review comments; automatic CodeRabbit skipped repository eligibility. |
| 3 | Durable monitoring, latency/error/quote separation, quote SLA and cost-floor alerts, operational readiness and evidence (§16, §20). | In implementation: durable per-request observations, bounded tax work, scoped dashboard, approved alert policy and quote follow-up targets. |
| 4 | Security/perimeter, privacy/retention, notification recovery and production staff configuration (§11, §17). | Audit queued; host/account evidence required for activation. |
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

# Field-performance monitoring foundation

Historical phase record for PR #332. See [the integration and release runbook](field-performance-integration.md) for the subsequent frontend/HTTP/admin connections and activation gates.

This phase is dormant infrastructure. It does not install web-vitals, expose an ingestion HTTP route, add a consent screen, or enable production collection. Those connections and their end-to-end verification remain a subsequent phase. `FIELD_QUALITY_ENABLED` defaults off; no environment setting is changed here.

## Data and consent boundary

The payload allows only a version, random per-navigation token, deployed commit, allowlisted public route template, coarse device class, and up to three LCP/CLS/INP measurements. No URLs, query strings, hashes, account identifiers, customer data, ZIP codes, referral tokens or library metric IDs are accepted. Hash-based screens are excluded from public route classification. Host-provider access logs are outside this application payload contract; this is not a promise that infrastructure never records connection metadata.

The browser visit accumulator is memory-only. Updates replace a metric by revision; new metric IDs require a new visit, including back/forward-cache restoration. Revocation clears the visit permanently. It must be connected to the explicit performance preference, never inferred from referral consent. Transport requires permission at send time, omits credentials and referrers, aborts on revocation, suppresses duplicate batches, and limits attempts to ten per transport instance, and aborts stalled delivery after five seconds. It performs no automatic retries. It permits only an HTTPS Convex site `/quality` endpoint without credentials, query or fragment. This helper is not called by current storefront code.

The request parser rejects extra fields and malformed data, caps actual streamed bytes at 2,048, and cancels oversized, malformed or stalled bodies. The total body-read deadline is five seconds; an untrusted Content-Length cannot bypass actual byte checks. The future HTTP route must also enforce origin, method, response/CORS policy and the collection kill switch before invoking internal ingestion.

## Storage and reporting

Only internal ingestion can write measurements. It is gated by `FIELD_QUALITY_ENABLED=true` and rejects invalid batches. One record per random navigation token retains immutable route/device/release and initial receipt time. Higher revisions replace observations; duplicates or out-of-order deliveries never add statistical samples. Client timestamps are not accepted. Budgets limit validated requests to 5,000 and newly stored visits to 1,000 per UTC day. These are small-site safeguards, not a claim of complete platform-level denial-of-service protection. Budget exhaustion means missing observations. Summaries check the bounded 28-day budget history, expose affected-day counts, and replace an otherwise healthy result with `collection-limited` when the collection budget was reached.

A summary requires engineering/owner authorization. It reads one selected route/device/release over 28 days and at most 5,001 records, computes results from at most 5,000, and explicitly reports truncation. It returns aggregate counts and values, never navigation tokens or individual samples. Exact nearest-rank p75 targets are LCP <=2,500ms, INP <=200ms and CLS <=0.1. Fewer than 50 observations is insufficient data; missing INP is not zero. Truncated data cannot be labeled within target. These are field targets, separate from the Lighthouse score contract.

An hourly purge removes up to 500 expired visit records and 50 old budget rows per run. It uses initial receipt time, so late updates do not extend retention. Cleanup remains active when collection is switched off and touches only the new quality tables. The proposed daily insertion cap is below the purge's daily capacity.

## Validation and remaining rollout

Forty-nine focused tests cover payload privacy, route exclusions, byte/time limits, cancellation, duplicate/reordered metrics, immutable visit identity, consent revocation, transport behavior, server disablement and budgets, staff authorization, missing metrics, bounded summaries and retention. Run strict backend and application types, generated bindings, lint, build and CI before merging.

Before activation: implement and verify the explicit shared preference UI; a lazy collector with document/bfcache identity and SPA-navigation rules; the HTTP boundary; authorized reporting and admin alert presentation; monitoring ownership and response process; and production verification. Do not silently repurpose existing email alerts or send test messages. No source-cost, pricing, inventory, ledger, checkout, payout or supplier dispatch authority changes in this phase.

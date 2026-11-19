# Field-performance integration and release runbook

## Scope and activation state

This phase connects the dormant foundation from PR #332 to both storefront entries, a separate opt-in preference, the production HTTP boundary, and an engineering/owner report in Commerce v2 Admin. The code does not enable collection by itself. `FIELD_QUALITY_ENABLED` remains absent/off until frontend, backend, authorization and public-boundary checks pass on the same deployed release. No prices, inventory, customer accounts, commissions, checkout eligibility or supplier dispatch rules change.

The prior foundation document describes its historical phase. This document describes the integration. A passing fixture is not a production verification or a completed Lighthouse specification.

## Visitor journey

- Default is off. Retail Privacy Policy links to the support privacy preferences; HOLM exposes preferences in the account and links its footer to privacy information.
- The preference uses `lm:performance-consent:v1`, separate from referral permission. It is browser/origin scoped, not account synced. Grant requires successful storage; errors are visible. Withdrawal stops the current document even when persistent storage fails, and warns that the saved choice may return on a later visit.
- Grant starts on the next document load. No pre-consent buffered observations are submitted. Withdrawal permanently stops the current visit; no automatic re-enrollment occurs.
- Entry code checks saved permission and private-link exclusion before loading the optional bootstrap. The bootstrap validates one full build commit marker and the configured Convex endpoint. A bounded configuration request must explicitly return enabled before the bounded web-vitals import.
- The actual web-vitals 6.2.3 observer reports LCP, CLS and INP. Missing INP is unmeasured, never zero. There is no synthetic interaction added to customer pages.
- Hash/path/query navigation or a private/noindex overlay stops the document measurement. Soft-navigation observations are excluded. Real back/forward-cache restores rotate visit identity before library listeners run; callbacks from an earlier visit are ignored. A restore missed during module loading stops collection. At most twenty restores are observed per document.
- UI loading failure does not remove the storefront. Preferences have an accessible modal, keyboard dismissal, bounded height and internal scrolling.

## Request and storage boundary

GET `/quality/config` returns only the collection boolean. POST `/quality` accepts approved apex/www origins; cookie and authorization headers are rejected. OPTIONS permits Content-Type without credentialed CORS. Responses are no-store. Unknown origins receive no permissive CORS response.

The existing five-second, 2,048-byte parser and exact schema are used by the real router. Transport omits credentials and referrer, limits attempts, cancels on withdrawal, and does not retry automatically. Only coarse public route template, mobile/desktop, full browser-reported release, random memory-only visit token and numeric metric revisions reach application storage. Raw URL, ZIP, referral parameters, account ID, library entry objects and metric IDs do not. Hosting access logs may contain connection metadata; the application does not promise otherwise.

Internal ingestion remains gated and bounded to 5,000 validated requests and 1,000 new visits per UTC day. The endpoint is anonymous, and client measurements/release labels are not authenticated proof of deployment identity. Origin checks and daily budgets are not comprehensive abuse prevention. If abuse or unexplained budget exhaustion occurs, disable collection and investigate before increasing limits.

The 28-day report excludes expired observations immediately. Hourly bounded cleanup may lag; summaries alert only when the oldest expired receipt is at least one full purge interval overdue. The one-hour grace and cron share a constant; expired data is still excluded immediately. Switching collection off does not stop cleanup.

## Staff reporting and response

Commerce v2 Admin adds Field performance only for engineering/owner roles. Backend authorization is independent of UI visibility. Real-role tests reject anonymous, customer, support, operations, finance and approver callers. Summaries return aggregates only.

Filters are public route template, device and full lowercase release commit. Invalid release input does not query. Loading, unavailable and retry states must not show a cached healthy report for another segment. Reports show per-metric sample count, exact p75, target and assessment, plus collection switch, daily limits, truncation and cleanup warnings. At least fifty observations per metric are necessary to assess the target; this is distinct from laboratory Lighthouse scores.

Engineering owns triage. Above-target results produce an in-app alert: verify deployment identity separately, compare the affected route/device with retained laboratory reports, inspect asset/network/error evidence, then correct or roll back. Daily-limit, unavailable-report and cleanup alerts require operational investigation. This phase does not send email or claim external alert delivery. Scheduled synthetic monitoring and external alert delivery remain separate acceptance items in the master spec.

## Rendering corrections

The ready journal article no longer animates its readable body after server HTML becomes visible. An initial matching document preserves focus; later SPA article navigation focuses the heading, including a return to the original article. Error and loading states retain their existing behavior.

Custom-page rendering is requested only for a custom page or configured homepage sections. Homepage additions have a local loading/error boundary; ordinary home content remains usable on failure. The default retail graph excludes the custom renderer except the Story route, which explicitly uses it. This maintains the existing 150 KiB gzip initial-JavaScript budget without raising it. Optional field bootstrap remains outside every default public route graph.

## Validation and deployment sequence

1. Run payload, preference, controller, HTTP, real-role, retention, report and journal/home tests; strict frontend/backend types; lint and generated bindings.
2. Build and verify client-secret checks and existing deferred/retail bundle budgets. Retain the bundle report; observer code must not enter the default startup graph.
3. Run `npm run test:field:browser`: isolated Chrome uses actual entry/bootstrap/web-vitals/config/transport, actual HTTP handlers, an isolated Convex database, and the actual authorized summary. A local proxy maps the fixture origin; production CORS is separately tested. Cover unknown consent, next-load opt-in, withdrawal, real bfcache restoration, private URLs and disabled gate, omitted credentials/referrer, sparse-data reporting and anonymous rejection. Run journal browser regression and visual review at desktop/mobile/short landscape.
4. Open ready PR, inspect current-head review findings and all CI gates. Merge only after actionable findings are resolved. Verify Vercel exact commit and required Convex main deployment separately.
5. With collection off, verify GET config false, disallowed-origin rejection, anonymous summary rejection, preference links and loaded public content. Do not publish customer products or run financial transactions as a telemetry test.
6. After the complete integration is verified, enable `FIELD_QUALITY_ENABLED=true`, then verify config and the browser-to-server flow using an isolated browser context with explicit test consent. Before the application starts, the verification harness must replace its build-commit meta value with the reserved forty-zero `FIELD_SYNTHETIC_RELEASE`; verify the actual deployment commit separately from the original response and build-info first. Abort the test if the override or outgoing reserved release cannot be proved. Never submit a test observation under the real release hash. The server queries exact release segments, so synthetic observations cannot raise a real segment from 49 to 50 samples. Staff reports explicitly label the reserved segment as synthetic; retain its test evidence separately. Synthetic requests still consume shared daily safety budgets, which may conservatively limit collection; do not raise budgets for testing. Verify an authorized aggregate without exposing raw identifiers. If production staff access is unavailable, leave activation pending and report that limitation.
7. Record the deployment, backend run, verification artifacts, switch state and rollback identifiers. Run the full fixed-release laboratory matrix, retaining failed runs. Scores are not established by bundle sizes or telemetry tests.

## Rollback and remaining acceptance

Disable `FIELD_QUALITY_ENABLED` first to stop new ingestion. Existing clients receive disabled responses; no retry loop occurs. Retention continues. Roll back only to a compatible frontend; do not delete customer or quality records as a shortcut. The public config carries no secret and may remain available while disabled.

The latest retained pre-integration production audit has 120 healthy runs, all Accessibility/Best Practices/SEO scores 100, and 23 of 24 performance groups accepted. Journal mobile was 99/99/100/100/99 and remains a failure until the new deployed release is measured. Full-spec completion also requires remaining HOLM progressive catalog work, complete private/commerce route coverage, manual assistive-technology review, verified production monitoring delivery and separately current supplier/checkout qualification. No full-spec completion is claimed here.

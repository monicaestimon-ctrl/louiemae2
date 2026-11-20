# Security remediation evidence

November 16, 2026: the public metadata redirect handler previously interpolated an unvalidated path query into HTML attributes and a script destination. Restrict it to source-owned routes and bounded safe collection slugs. Invalid types, markup, prototype keys and unknown non-collection paths return a static, non-indexable, non-cacheable 404 without reflecting input. Preserve custom collection destinations and sanitized referral parameters.

This correction does not complete server-rendered product HTML, collection-existence validation, site-wide missing-route statuses, or the full security phase.

## Dependency compatibility

Remove the unused github-cli npm package and its exclusively owned dependency chain. The installed gh command is separate. Patch the existing authentication generation to @convex-dev/auth 0.0.98 and @auth/core 0.41.3; this is not the breaking v2 migration. Patch Resend to 6.12.3, Vite to 6.4.6 and Vitest/coverage to 4.1.12. Refresh compatible transitive dependencies within declared ranges, without forced major upgrades or overrides.

The local npm audit falls from 43 findings (8 critical) to 14 (0 critical, 10 high, 4 moderate). Remaining findings include the Vercel development tooling chain and need separate compatibility/reachability triage. This is not a clean-audit claim.

## Regression evidence

- Full suite: 222 files passed, 1,336 tests passed and one skipped.
- The in-memory authentication fixture exercises actual password sign-up, wrong-password rejection, sign-in with the same identity, refresh, authenticated access, session deletion on sign-out and rejection of subsequent refresh. It creates no production account and sends no email. It does not establish immediate invalidation of an already-issued JWT or verify live OAuth.
- Metadata/referral coverage rejects unsafe input and preserves valid destinations.
- Application and strict backend type checks, production build and client-secret checks passed. Lint has zero errors and 554 existing warnings. Catalog-writer and append-only checks passed.
- A sandbox run could not bind a local HTTP fixture; the unrestricted local rerun passed. Browser fixtures and CI provide additional evidence before release.

The dark HOLM delivery-calculator disclosure also uses the existing dark-section button style. The previous outlined style produced nearly identical hover foreground/background colors in a production computed-style check despite an automated axe scan reporting no violation.

Release requires successful CI, current review resolution, deployment verification and a read-only production smoke check. Authentication fixtures do not authorize real payment or payout tests.

## Response-header baseline

The production header audit found HSTS already supplied by Vercel. Add global MIME-sniffing protection, strict-origin referrer handling, same-origin framing restrictions and denial of unused camera/microphone/geolocation APIs. The initial CSP limits objects, base URLs and embedding parents; it does not constrain scripts, styles, images, connections, child frames or payment redirects. Photo file uploads remain separate from camera-stream API access. Existing hashed-asset cache rules remain unchanged.

The local HTTP/browser fixture applies the exact configured headers. It verifies inline script execution, denial of the three unused permissions, rejection of an external base URL, successful same-origin framing and Chrome's blocked-document result for a cross-origin parent. It sends no business commands. Actual deployment headers and the complete auth/Stripe compatibility journeys still require release verification. This baseline is not a complete restrictive script/network CSP; that needs an explicit source inventory and report-only rollout before enforcement.

Reference semantics: [CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [base-uri](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/base-uri), and [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy).

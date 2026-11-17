# Security remediation evidence

November 16, 2026: the public metadata redirect handler previously interpolated the unvalidated `path` query into HTML attributes and a script destination. Restrict it to source-owned routes and bounded safe collection slugs. Invalid types, markup, prototype keys and unknown non-collection paths return a static, non-indexable, non-cacheable 404 without reflecting input. Preserve custom collection destinations and sanitized referral parameters.

This is an input-boundary correction. It does not complete server-rendered product HTML, collection-existence validation, the site-wide missing-route status, or the full security phase.

Remove the unused `github-cli` npm package and its exclusively owned dependency chain. Repository source referenced it only in package manifests. The installed `gh` command is separate. A clean lockfile install reports 41 audit findings (6 critical, 21 high, 13 moderate, 1 low), down from 43 (8 critical). Remaining authentication and tooling advisories need compatibility and reachability review; no blanket forced upgrade was applied.

Validation: 29 metadata/referral tests, application type check, targeted lint, clean dependency install without lifecycle scripts, production build and existing secret checks. CI must repeat its full suite before merge.

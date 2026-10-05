# Convex cost reduction release evidence

## Scope

The approved plan covers subscription scope, lightweight paginated product reads,
incremental health/sourcing summaries, CJ scheduling, webhook retention, Nexx
preview jobs, and regression/operational guidance. No phase is considered complete
solely because a narrower test passes.

## Phase 0 baseline

- Repository: `monicaestimon-ctrl/louiemae2`; default branch: `main`.
- Remote baseline: `ce92fc33643d231e50c97015b92433096009779d` (PR 127).
- GitHub CI for this commit succeeded, including the production Convex deploy job.
- Original local checkout is older and has extensive unrelated uncommitted work.
  Implementation uses an isolated managed worktree based on remote main.
- Louie Mae production deployment identified in the account: `diligent-jay-261`.
- Nexx repository identified: `monicafernii97-cmd/nexx-app`; its original checkout
  also has uncommitted work and must be preserved.
- Baseline September usage and invoice evidence are in the approved plan. Runtime
  measurements and production availability still need revalidation before claiming
  an improvement in live costs.

## PR 1: scope authenticated catalog subscriptions

Private catalog demand is registered by mounted admin
consumers rather than enabled for every authenticated visitor. Server authorization
and endpoint contracts remain unchanged. Public browsing uses the public catalog.
Multiple consumers and React StrictMode cleanup are covered by focused tests.

Local validation: 73 test files / 487 tests passed, frontend and strict Convex
type checks passed, lint passed with warnings, production build and client-secret
verification passed. Tests cover subscription lifecycle, multiple consumers,
StrictMode, public browsing after login, and unauthenticated requests.

Released: PR 128 merged at `b6eef27071041f4a419aaa567d92c8ecd0dde0b9`.
GitHub run `37259184405` passed all checks and deployed to
`https://diligent-jay-261.convex.cloud`. Vercel production deployment
`dpl_A5JPVHuwsWcgehXVsco5UbSdfJoX` is Ready and aliased to
`https://www.louiemae.com`; its build used the production Convex URL.
The clean release checkout contains only that exact merged commit.

Post-release: homepage HTTP 200; the backend query still returns Server Error,
and admin remains unavailable. Before release, development explicitly reported
that free-plan limits disabled deployments. Successful code deployment does not
prove restored service. Real admin-flow and cost verification remain blocked by
backend availability. No payment or billing configuration changes were made.

Frontend rollback: Vercel deployment `dpl_6kxLhMs8rn8MzgjEYy88eWvGoGCb`.
Backend prior source: `ce92fc33643d231e50c97015b92433096009779d`.

## PR 2A: isolated catalog foundation (released)

Additive catalog and migration tables, explicit projection allowlists, atomic
maintenance builders, and operator-driven backfill/integrity checks. No current
application writer or reader used the prototype builders in this release. No production migration
has run, and completing a backfill does not enable readers.

Focused tests exercise create/update/hide/delete, transaction rollback, supplier
field exclusion, no-op writes, 535-product resumable migration, retry cursor
protection, concurrent changes, drift detection, and orphan detection. The pinned
Convex runtime remains 1.31.7; helpers and convex-test use compatible versions.

Remaining PR 2 work: integrate and test every product writer, finish bounded
response contracts, add paginated readers, migrate and verify data, fetch
authoritative records before editing, then cut over clients. Summary size and
actual read/write overhead must be measured before adoption. All later phases
remain pending; the foundation is not a completed cost optimization.

PR 129 merged at `2df902e4ef22ed5e20e7d1bba0dad9c974327c14`;
GitHub run `37260445340` passed and deployed the additive backend foundation.

## Webhook payload retention (released; historical compaction pending)

PR 130 merged at `10488b76fbd744ae2080e305aef7a30547d3564d`;
GitHub run `37261443650` passed and deployed. Successful processing removes
recoverable payload content while retaining webhook identity and deduplication.
Failed and unresolved events retain recovery data. Historical maintenance has
bounded dry-run previews and exact-ID rechecks; no historical compaction has run.
The previously observed storage volume has therefore not been reported as removed.

## PR 2B: transactional product-writer integration

The version-2 projection avoids duplicated public fields and bounds description
excerpts. All 50 identified typed product-writing entry points maintain summaries
atomically. CI now checks builder coverage through helper calls. Real database
regressions cover inventory, sourcing, publication, source recovery, image caching,
pricing, revision conflicts and rollback. Existing readers remain unchanged.
See `CATALOG_READ_MODEL_ROLLOUT.md` for writer inventory and activation gates.

Local validation: 77 test files / 511 tests passed, frontend and strict Convex
type checks passed, and lint passed with 520 warnings and zero errors. The
listing-review tests now use a real transactional test database and verify that
rejected variant evidence rolls back product, summary and audit changes.

Released as PR 131 at `3c45efb0d91f9615326313e17cf49291bc979db1`.
GitHub run `37264249871` passed all checks and deployed the production backend.
The production build and client-secret verification also passed locally. This
release does not enable summary readers or execute a backfill.

## Nexx preview canaries (PR 293; deployment blocked)

`monicafernii97-cmd/nexx-app` PR 293 disables upload canaries by default outside
the known production deployment and adds explicit, expiring preview opt-in,
bounded execution and monotonic progress. Local validation passed 1,662 tests,
type checks, lint, operational monitor tests and the production build. GitHub CI
also passed. Vercel preview `dpl_8P4GQ5z27eWi7m8gfRvjWyYtciDT` failed because
Convex refused preview creation while the team is Disabled. No Nexx production
release or older-preview reconfiguration has been claimed.

CodeRabbit skipped automatic reviews on these repositories under its current
repository eligibility settings. Its successful status is not an actual code
review. No manual review request was posted.

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

## PR 2A: isolated catalog foundation (in progress)

Additive catalog and migration tables, explicit projection allowlists, atomic
maintenance builders, and operator-driven backfill/integrity checks. No current
application writer or reader uses the prototype builders. No production migration
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

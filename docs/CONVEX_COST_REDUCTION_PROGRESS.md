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

## PR 2C: gated paginated readers (released, inactive)

PR 132 merged at `7ca382a4ae886699117f595a332fb39e814b84cd`.
GitHub run `37265177281` passed and deployed the production backend. Local
validation passed 79 files / 517 tests, both type checks, writer coverage,
lint (519 warnings, zero errors), build and client-secret verification.
Readiness requires backfill completion, both persisted integrity passes and
explicit activation. Neither backfill nor activation has run in production.
Tests cover more than 500 visible products and continuation through empty
filtered pages. Runtime budget/split behavior still needs live verification.

After deployment, the read-only production `catalogReadiness:status` probe
returned Server Error (request `faa436b2be9f401a`). HTTP 200 wrapped that backend
error and is not evidence that service was restored.

## PR 2D: authoritative editor loading (released)

The editor fetches `products.getAdmin` before opening and preserves full source
details and the latest revision. It handles deleted/unavailable records and
ignores late responses after cancel, navigation, sign-out, unmount or a newer
selection. Local validation passed 520 tests before integration with PR 132;
15 combined reader/editor tests and the frontend type check passed after rebase.
Live authenticated verification remains blocked by backend availability.

PR 133 merged at `cc723b5d30702a16fe2e6b251399ec74c361bbaf`.
Combined GitHub CI and backend deployment succeeded in run `37265450146`.
The exact clean merge commit was deployed to Vercel production as
`dpl_EWyonxMC9ZNpTGZcQgPfz8rmsWBM`, Ready and aliased to `www.louiemae.com`,
with the existing `diligent-jay-261` production URL. Build and client-secret
verification passed; homepage HEAD returned HTTP 200. A transient upload TLS
failure was resolved by retry. Browser verification could not reconnect to the
Chrome debugger; authenticated product editing remains unverified live.
Frontend rollback remains available to `dpl_A5JPVHuwsWcgehXVsco5UbSdfJoX`.

## Remaining work

Frontend pagination adoption, selected variant details, remaining dashboard summaries,
CJ workload measurement and targeted improvements, reviewed historical payload
compaction, production flow checks and
representative cost measurements are still outstanding. Current CJ code already
has token caching, refresh leases, due-job leases and bounded dispatch; changes
must preserve those controls and be justified by workload evidence.

## Product health summaries (PR 134; backend released, inactive)

PR 134 merged at `f91399e8858f0a37b345ff8055802ce41b241f8e`.
GitHub run `37266711510` passed and deployed the production backend. Local
validation passed 81 files / 532 tests, both type checks, writer coverage,
lint, build and client-secret verification. Health rules are shared with the
legacy endpoint. New readers use compact issue rows and exact maintained totals;
epoch rebuilds handle concurrent edits, drift, orphan rows and verification
restarts. The five-minute age check reads at most 50 due summary rows and does
not reload full products. No production health rebuild or activation has run;
frontend adoption and live measurements remain outstanding.

An authenticated CLI call to `catalogReadiness:status` after these releases
failed with request `a76d700244041beb` and explicitly reported exceeded free-plan
limits and disabled deployments. The restriction therefore affects operator
function execution too, not only the public client. Code deployment success
does not authorize claiming a completed migration or healthy live backend.

## Nexx preview canaries (PR 293; released, live execution checks pending)

`monicafernii97-cmd/nexx-app` PR 293 disables upload canaries by default outside
the known production deployment and adds explicit, expiring preview opt-in,
bounded execution and monotonic progress. Local validation passed 1,662 tests,
type checks, lint, operational monitor tests and the production build. GitHub CI
also passed. Vercel preview `dpl_8P4GQ5z27eWi7m8gfRvjWyYtciDT` failed because
Convex refused preview creation while the team is Disabled. GitHub reported no
required checks bypassed; all code checks passed and the known environmental
failure was distinguished from them before normal merge.

PR 293 merged at `56292b9dbb4d8a292ef0007977d6bb53dd530f53`.
Post-merge CI `37266522502` succeeded. Vercel production deployment
`dpl_DUbudg2upojtcZu1kQowLnVzvB4g` is Ready, aliased to `nexproof.io` and
`www.nexproof.io`; its logs confirm deployment to the existing production
Convex project `blessed-rabbit-457`. Public homepage HEAD returned HTTP 200.

The official management API inventory identified production `blessed-rabbit-457`,
development `avid-bobcat-637`, and preview `laudable-mammoth-750` (`preview/main`).
The latter two had no `CHAT_UPLOAD_CANARY_ENABLED` variable. It was set to `false`
on those two nonproduction deployments, and readback confirmed both values.
The production setting was not changed. Older code may still register the two
cron invocations even when their handlers exit early; no zero-invocation or
measured-savings claim has been made. The preview's recorded expiration is
`1791212391150` milliseconds since epoch. No deployment or customer data was
deleted. Rollback of this configuration is to remove only this newly added flag
on the same nonproduction targets, subject to a deliberate monitoring decision.
Live upload, cleanup, canary execution and idle-call measurements remain gated
on restored service.

CodeRabbit skipped automatic reviews on these repositories under its current
repository eligibility settings. Its successful status is not an actual code
review. No manual review request was posted.

## Sourcing state counts (PR 135; backend released, inactive)

PR 135 merged at `a68e76f5729d2be6035006cdd94fabec7effd8e3`.
PR CI `37267838039` and production CI/deploy `37267967952` succeeded.
The combined head has 82 test files / 537 tests. Strict types, 51-entry writer
coverage, lint, build and client-secret verification passed. All typed sourcing
job writers maintain exact state counters; state-preserving updates avoid the
counter entirely. A bounded epoch rebuild and source verification gate activation.
The existing dashboard changes only its state-count reads when enabled, and its
toggle restores the original capped reads on rollback. Real dispatcher tests
verify invalid/uncorrelated work still does not dispatch.

No production sourcing rebuild or activation has run. Recent full-product joins,
webhook sampling and legacy migration counts still need their own reductions.
See `SOURCING_COUNTS_ROLLOUT.md` for activation, rollback and contention checks.

## Batch description detail prerequisite

Batch generation now fetches each selected product through the authenticated
detail endpoint before building supplier evidence. It rechecks admin-edited
protection, skips deleted records, retains the source revision in each preview,
and passes that revision to the existing save conflict check. Leaving the product
tab or signing out stops subsequent requests and discards late completions; an
already running provider request cannot be canceled by this client-side guard.
Completed previews survive later failures, and later completions preserve user
edits and dismissals. This prepares batch generation for compact catalog rows;
it does not itself enable paginated catalog readers or claim measured savings.

Local validation passed 83 files / 546 tests, including nine new batch hook tests.
PR 136 merged at `92e9c4c98759e63fc4188a6283f99d54ba5aef58`. PR CI
`37268452990` and production CI/backend deploy `37268636144` passed.
The exact clean merge commit was deployed to Vercel production as
`dpl_CQuxctj99rwjR98xQzJy7GLuuo5D` and verified Ready with the `www.louiemae.com`
alias and existing `diligent-jay-261` URL. The build and client-secret check
passed; the public homepage returned HTTP 200. Authenticated generation and
save verification remain pending Convex service restoration. Frontend rollback
is available to `dpl_EWyonxMC9ZNpTGZcQgPfz8rmsWBM`.

## Webhook status summaries (PR 138; backend released, inactive)

PR 138 merged at `0725fb6f3a7378181f5295a1c6590d4fe521454b`. PR CI
`37270739224` and production CI/deploy `37270979319` passed. Validation included
84 files / 549 tests, both type checks, 58-entry writer coverage, lint, build
and client-secret verification. Compact metadata preserves the latest-100
sample, source ordering, status and oldest valid processing claim without
copying payloads or claim tokens. Claim/retry/completion writes maintain it
transactionally; unchanged payload-only projections do not rewrite summaries.

No webhook backfill or activation has run. The historical passes still read
source records and their retained payloads; budget these one-time reads and
coordinate separately authorized retention work before migration. See
`WEBHOOK_SUMMARY_ROLLOUT.md`. A later public production readiness probe still
returned Server Error (`a463e5924ca7b598`); the most recent authenticated
diagnosis remains the free-plan-disabled team.

## Health frontend (PR 137; reviewed/tested, held before rollout)

PR 137 is open at `9ff1d58b26cd3f0f65065a29a8808d40db8963f4`. CI
`37269408720` passed 85 files / 556 tests and the other quality checks. The
prepared dashboard uses exact health totals and paginated compact issues,
retains manual reconciliation, and never equates an empty partial page with a
clear inventory. Keep this PR unmerged and undeployed until the production
health rebuild, verification and activation complete. Update against current
main and rerun combined CI before its eventual merge. CodeRabbit skipped review
under the repository eligibility rule; no manual review request was posted.

## Queue and public detail releases (PRs 139–142)

- PR 139: full admin variant detail and shared legacy mapping rules, merged
  `bfd9704a2dd2cd43b0ec72e18dbc16097b226f4b`; production CI/deploy `37272685369` passed.
- PR 140: compact catalog v3 variant queue, merged
  `25bca7407f52760bcc51339f3668fa30ff99f4c8`; PR CI `37273442952` (554 tests) and
  production CI/deploy `37273839522` passed. Source backfill/verification/activation
  remain pending. The new queue preserves complete variant search and ordering.
- PR 141: prepared queue frontend, held open at
  `e5404eeffc533cdc73170d93fe3c6e92e04837c7`; CI `37275448407` passed (560 tests).
  It skips the full queue subscription, preserves selected-product drafts and
  revisions, continues past empty filtered pages and opens off-page editor IDs.
  Rebase and rerun combined CI before release, after catalog activation.
- PR 142: full public detail prerequisite, merged
  `8f67a6d715a01d53367b6fb24f1d3e0efe900440`; PR CI `37274955150` (558 tests) and
  production CI/deploy `37275179481` passed. The frontend from this exact commit
  is live as `dpl_3gLRr2GZQegNNvRW5sm5bwpcJxQ9`, verified Ready on louiemae.com,
  www.louiemae.com and louiemae2.vercel.app. Homepage HEAD returned 200.
  Rollback frontend: `dpl_CQuxctj99rwjR98xQzJy7GLuuo5D` (PR 136).

These test totals apply to separate branches; PRs 137 and 141 are not included
in deployed main. CodeRabbit skipped actual reviews under its repository rule;
manual reviews and CI were completed. Neither homepage availability nor a
successful deployment establishes authenticated production workflow parity.
The disabled Convex service still blocks that verification, migrations and
meaningful workload measurements. See `STOREFRONT_DETAIL_ROLLOUT.md` and
`VARIANT_QUEUE_ROLLOUT.md` for remaining gates.

## Operations and sourcing readers (PRs 143–145)

PR 143 merged at `7e67ebf6283176c6982a6e369825e6b6cd9fe617`; PR CI
`37276935892` (559 tests) and production CI/deploy `37277203842` passed.
Health version 2 adds exact migration counts. Operations uses these only after
explicit health verification/activation, and compact job displays only after
catalog verification/activation. No migration or activation has run.

PR 144 merged at `a462db87403af8195629fe8cb79e87854ff72cce`; PR CI
`37277674851` (560 tests) and production CI/deploy `37278203855` passed.
Pending/rejected readers use a sourcing/creation index; recent approvals use
an indexed inclusive cutoff, newest first. All readers are bounded and private.

PR 145 is held open at `6561832a074c9c9e9bd5c3892728a28724f426cb`; CI
`37278747812` passed (563 tests). Its prepared frontend removes the three legacy
list subscriptions, exposes continuation and window refresh, and distinguishes
partial/loading/unverified lists from exhausted empty queues. Merge only after
catalog activation, rebasing with other dashboard releases and rerunning CI.

## Catalog subscription scope (PR 146)

PR 146 merged at `38db52539d2d848e72994d4ca3560e113be45f02`; PR CI
`37279756631` (562 tests) and production CI/deploy `37280027277` passed.
Frontend `dpl_81sjJPfhr3kDvZ5gK8e6ECUfAhUG` is Ready on the production aliases;
homepage HEAD returned 200. Rollback frontend is PR 142's deployment above.
Public context catalog demand now belongs to its consuming pages; private demand
is paused during full-product editing and absent from import/CJ settings.
The editor opens requested IDs directly, including products outside legacy lists.

Production readiness probe `de5cd34746f7fb1f` still returned Server Error.
The last authenticated diagnosis remains disabled team service; no migration,
activation, authenticated workflow verification or production savings measurement
has been completed. Catalog v4 preparation adds the filter/preview contracts in
`CATALOG_READ_MODEL_ROLLOUT.md`; it does not itself switch client readers.

## Catalog v4 backend and held arrivals frontend (PRs 147–148)

PR 147 merged at `1ea3b45a62fc666019943fea5ca3861baf3bac71`; PR CI
`37282834887` (566 tests) and production CI/deploy `37283269340` succeeded.
It adds complete admin search, category matching, price/featured ordering and
dated/legacy arrival contracts. No catalog backfill or activation has run.
The frontend remains PR 146's deployment; this release changes backend contracts.

PR 148 is held open at `ae30686af14d6131b9e905a655645df06353e617`;
CI `37283622583` passed (569 tests). Its arrivals previews replace the full
storefront subscription while continuing short pages and preserving the dated
and legacy rules. Hold until current-version catalog activation and rerun CI
after rebasing at release. See `ARRIVALS_PREVIEW_ROLLOUT.md` on that branch.

PR 149 is held open at `dacfdf0a7f8d4edaf2eb0bac4a37770e5e70d6d8`;
CI `37284427183` passed (572 tests). It replaces inventory-tab private list
demand with paginated summaries, explicit loaded counts and complete detail
actions. Its production gate is current-version catalog verification/activation.
Dashboard and content-editor list demand remain separate follow-up work.

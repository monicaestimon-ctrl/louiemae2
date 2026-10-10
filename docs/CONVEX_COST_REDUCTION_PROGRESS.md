# Convex cost reduction release evidence

## Scope

The approved plan covers subscription scope, lightweight paginated product reads,
incremental health/sourcing summaries, CJ scheduling, webhook retention, Nexx
preview jobs, and regression/operational guidance. No phase is considered complete
solely because a narrower test passes.

## Current status — October 9, 2026, through PR 174

The complete original plan remains open. This section supersedes the historical
release entries below. Completed migrations must not be repeated.

### Released and verified

- LouieMae production is `diligent-jay-261`; development is `kindred-squid-489`.
  Catalog v5, health v3, sourcing counters, and webhook summaries were verified
  and enabled. Paginated readers, scoped subscriptions, indexed CJ lookups,
  authoritative checkout, homepage cart, and concurrent edit handling are live.
- PR 170 preserves Unicode supplier properties. The authorized production Quick
  URL import saved one hidden barstool with 10 variants and 6 images and submitted
  exactly one CJ sourcing request. CJ accepted it; supplier approval remains pending.
- PR 171 pages due tracking orders through an index and counts provider failures.
- PR 172 is live on the frontend and backend. Manual inventory refresh returned
  25/25 successful updates with zero errors after 334.84 seconds, removing the
  observed nested-action timeout. This does not promise unlimited action runtime.
- PR 173 added backend batch lifecycle regression coverage. Main CI 38014675708
  deployed its backend; that release kept the PR 172 frontend because PR 173
  changed tests and documentation only. That release passed 693 tests.
- Retiring the verified webhook recovery history index reduced provider database
  estimates from 20,480,274,879 to 15,443,420,687 bytes in production (24.59%) and
  from 2,631,954,064 to 1,983,777,086 bytes in development (24.63%). These are
  whole-database estimates, not isolated index measurements or invoice savings.
  Historical record counts remained unchanged; no historical events were deleted.
- Monitoring remains paused in verified environments. LouieMae retains seven
  essential operational crons. Nexx production and inspected previews are paused;
  development `avid-bobcat-637` still returned authorization 404 on October 10 at
  01:53 UTC. Its schedules remain an unresolved access-dependent gate.
- Automatic CodeRabbit review was skipped under repository eligibility rules.
  Direct diff review and CI are evidence; a skipped status is not a completed review.

### Released: atomic batch completion (PR 174)

Product creation now completes its batch items and releases temporary payloads
inside the same transaction. A failed completion rolls back product and summary
writes. The frontend no longer needs a second completion request. Valid older
clients can still call `markImported` afterward; that operation is idempotent.

Local verification passed 697 tests in 115 files, frontend and backend types,
58 catalog-writer guards, lint (zero errors, 504 warnings), and the production
build/client-secret scan. A disposable development import fetched the actual
supplier item, saved 10 variants and 6 images, immediately completed its item and
job, released the payload, and returned the same product ID on retry. The hidden
fixture was removed and the 22-product baseline restored; no CJ request was sent.
PR 174 merged as `df5fbf3a64e69660a71740b92ba1bbf1a5e0dd7f`. Main CI
38015895717 deployed the backend before frontend promotion. Vercel deployment
`dpl_8mWNdJCZQP8kMdA8tpreTDb8P78o` was verified Ready on www.louiemae.com
with that exact commit. Authenticated production import rendering passed with no
browser errors and retained 57 imported/3 ready batch items. No additional
production import was submitted; production batch-button acceptance remains open.

### Active-session cost finding

A one-off production sample from 01:45 to 02:15 UTC on October 10 recorded
233,559,593 read bytes from `products:list`, 97.67% of 239,130,371 total read bytes.
An older open inventory tab still loaded the full-catalog UI and its old asset
`Admin-CQ-AG1KV.js`. After confirming it contained only an empty inventory search
field, no editor/save controls and no dialog, it was refreshed to the current
`Admin-DZxMJhDG.js` release. The restored import batch remained available.

The subsequent 66-second production window recorded three successful natural
inventory updates, zero `products:list` calls, 257,694 read bytes and 92,324 write
bytes across all observed functions. The unequal windows are not a normalized
before/after billing comparison, and concurrent traffic is included. Another old
tab could not be inspected and was left untouched. Do not reload an editing tab
until its unsaved work is preserved. Deployment alone does not update code already
running in an open browser tab.

### Original phase completion audit

| Phase | Implemented/released evidence | Remaining exit gate |
| --- | --- | --- |
| 0: baseline | Deployment mapping, rollback references, bounded measurements | Nexx development access; historical webhook allocation by deployment |
| 1A: subscription scope | Scoped admin/editor reads; production Quick URL import passed | Atomic completion released; production batch-button acceptance remains unverified |
| 1B: catalog | Verified summaries, pagination, selected details, cart and concurrent-edit checks | Equivalent total maintenance-cost comparison and representative activity |
| 1C: health/sourcing | Verified counters; measured health reads 84.76% lower | Write overhead/contention and normal active-session workload |
| 2A: CJ work | Bounded scheduling/retries, indexed lookups, paged tracking, 25/25 manual inventory acceptance | Supplier approval/mapping and downstream tracking/fulfillment acceptance |
| 2B: retention | Payload growth bounded; recovery queue; index retirement with ~24.6% database estimate reduction | Replay horizon, recovery/backup review, exact approved historical cleanup scope |
| 3: Nexx | Production/previews released and monitoring paused; upload/chat assurance passed | Access and pause development schedules; verify idle activity without restarting monitoring |
| 4: regression/runbook | Release tests, rollback guidance and audit evidence | Remaining acceptance gates and actual billing-window trend |

### Remaining sequence and boundaries

1. Obtain the separately requested scope for production batch-button acceptance.
   The atomic completion release is verified live; existing ready items are not test fixtures.
2. Verify the already-submitted CJ request when its status changes; do not submit
   another supplier request or place an order/payment as part of routine checks.
3. Obtain access to the existing Nexx development deployment and pause its
   monitoring while preserving operational cleanup. Do not create a replacement.
4. Establish a provider replay horizon and recovery requirements before preparing
   exact historical cleanup scope for approval. Retain event deduplication identities
   until that review is complete. A retry count alone does not establish replay age.
5. Compare equivalent workloads including writes and one-off usage observations.
   Keep monitoring paused. Measured query/storage reductions do not prove a total bill.
6. Close the plan only when all remaining gates have adequate evidence.

Local evidence under the original workspace's `tmp/` includes
`convex-completion-audit-current-2026-10-09.json`,
`approved-import-sourcing-2026-10-09.json`,
`manual-inventory-production-2026-10-09.json`,
`batch-completion-release-2026-10-09.json`,
`atomic-batch-development-2026-10-09.json`, and
`index-retirement-storage-savings-2026-10-09.json`.
These are audit artifacts, not application startup dependencies.

## Historical release evidence

The entries below describe their recording time. In particular, references to a
signed-out admin, disabled Nexx production, and held frontend releases are not
current blockers. Consult the current audit above before any operational action.

## Production rollout verified October 9, 2026 UTC

PR 156 merged at `26710f6a96585b787cc6360b715aa2a140016c3f`; main run
`37875817115` deployed successfully to `diligent-jay-261`. The post-deployment
single-product refresh succeeded; a scheduled batch subsequently updated all
25 selected products with zero errors. Inventory scheduling metadata was
backfilled for 145 approved products in batches of 25. A complete verification
pass found zero approved products still missing `cjInventoryNextCheckAt`.

Read-only production measurements used the existing allowlisted operator identity
and Convex execution usage statistics. They do not prove browser authentication:

- Health: the old audit and all 23 new issue pages returned the same 621 total
  products and 571 issue IDs/problem lists. The old audit read 8,516,488 bytes;
  new status plus all issue pages read 1,297,987 bytes (84.76% less). No query
  cache hits or database writes occurred in that comparison. This establishes
  the health-read result, not total workload/invoice savings or write overhead.
- Catalog: the legacy response and paginated reader reached identical sets of
  500 IDs. Initial uncached reads were 8,662,744 bytes for the legacy list and
  99,365 bytes for the first 25-row page. Full-list comparisons must account for
  partial byte-budget pages and cache hits; do not extrapolate the initial-page
  reduction to reading the entire catalog.
- One legacy embedded JPEG was moved byte-for-byte into the same deployment's
  file storage. SHA-256 equality was verified before replacing its image URL
  with a revision-guarded update. All seven images remain; its catalog response
  row shrank from 724,906 to 3,213 JSON bytes. Original image data is retained in
  a local rollback artifact, with no storage/source deletion.
- The current sourcing dashboard read 39,486 bytes with untruncated counts.
  A subsequent available log window showed 32 inventory snapshot mutations,
  43 sourcing dispatches and 43 completed legacy-backfill checks, with zero
  errors or transaction retries. Completed backfill checks read/wrote zero
  database bytes. The window includes operator activity and is not a controlled
  before/after workload.

Machine-readable evidence and the image rollback artifact are in the original
workspace's `tmp/convex-*-2026-10-09.json` files. These exclude credentials;
the rollback artifact retains the original public product image bytes.

CJ recovery follow-up: the newest inventory failure at 02:18:15 UTC reported
provider code `1600014` (API access disabled). The owner unfroze the integration.
A bounded production refresh then checked and updated one product with zero
errors in 29,838 ms, confirming restored inventory API access. This does not
verify order submission or fulfillment permissions.

The follow-up safeguard stops automated inventory batches on that explicit
account-level error after the first failed provider request. It preserves the
incomplete product's prior stock and freshness timestamp, records the actual
checked/deferred counts, and keeps the normal cron retry for automatic recovery.
Earlier completed products remain committed; ordinary per-product errors and
manual refresh behavior retain their existing semantics. Five targeted tests
cover VID/SKU/PID failures, partial-product preservation, recovery, and unchanged
ordinary/manual error handling.

Follow-up validation: 627 tests in 102 files passed; application and strict
Convex type checks passed; lint had zero errors and 507 existing warnings;
production build and client-secret verification passed.

This entry supersedes the historical blocked/held statuses below. PR 154 merged
all six held frontend changes at `c9bc8ac63fe3d87eba3c711f98a3de95926f0557`.
PR CI `37872498592` and main CI/backend deployment `37872707431` passed.
Validation: 622 tests in 101 files, both type checks, lint (zero errors,
507 warnings), 58 covered writers, build and client-secret verification.

The owner transferred LouieMae to `monica-estimon`; production remains
`diligent-jay-261`. Existing Starter billing settings have a $30 warning and $35
disable threshold; neither was changed. Deployment database I/O warnings were
added at 1 GB daily and 5 GB monthly, without a deployment disable threshold.
These conservative initial alerts require calibration to measured normal usage.

All four production read-model gates were verified and enabled:

- Catalog v5: 621 products; 1,242 bidirectional checks; no mismatches.
- Health v3: 621 products and independent totals; revision 623, after a live
  update required reverification before activation.
- Sourcing counts v1: 603 jobs; exact totals at revision 603.
- Webhook summaries v1: recent scope; 300 checks for the exact latest-100
  dashboard window. Production has 23,209,840 historical events; no full-history
  duplication or historical deletion was performed.

Vercel `dpl_BFkKcHtdrfyERgdsJRELFo43ag1t` was built without custom domain
assignment, checked, and promoted. Both `www.louiemae.com` and `louiemae.com`
independently resolved to this Ready deployment. The prior rollback deployment
is `dpl_81sjJPfhr3kDvZ5gK8e6ECUfAhUG`.

Read-only operator checks reached all 621 admin products across 25 pages, with
unique IDs and authoritative detail. They used the existing allowlisted admin
through Convex's identity-debug API; they do not prove browser login or editing.
Operations counts were untruncated; the webhook sample contained 100 processed
events. Public catalog checks reached 29 visible products across two pages in
each sort mode, with unique IDs, ascending-price ordering and full detail.
Anonymous admin access returned an error without records. The landing page
rendered; the furniture empty state matched zero published furniture products.

The final deployment dashboard showed 12.39K monthly calls and 0.19 GB database
I/O. These include migrations and unrelated activity, not an isolated benchmark.

Remaining verification and operations work:

- Authenticated browser editing/import/CJ flows and provider-safe checkout;
  the admin browser is signed out and the user login request is pending.
- Equivalent-workload savings, worker/queue freshness and longer scheduled-job
  measurements. The 80% target has not been established in production.
- Historical retention: the bounded expiry preview found no eligible rows.
  Five oldest sampled events had no payload/expiry; three sampled August events
  retained payloads with future expiry. This ten-record sample is not a complete
  age/size allocation. No old records were deleted or cleanup schedule enabled.
- Nexx production `blessed-rabbit-457` still explicitly reports free-plan
  disablement (request `bbba51ae3b0d52b1`). LouieMae's transfer did not restore it;
  live upload/cleanup and idle-usage checks remain pending service restoration.

## Historical phase 0 baseline

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

## Exact dashboard counters and job history (PRs 150–151)

PR 150 merged at `4ae150ca9e752fbc137f824ff5278d8be08bc47a`; PR CI
`37285259143` (567 tests) and production CI/deploy `37285649903` passed.
Health version 3 maintains exact inventory connection-state and Next Launch
counts. A fresh current-version rebuild/verification/activation remains required.

PR 151 merged at `35f708ab9350336834b1736776b41e0fca1585df`; PR CI
`37286282336` (570 tests) and production CI/deploy `37286872778` passed.
Complete job history is paginated with bounded compact product lookups and no
attempt hydration; operations metrics can omit the duplicate legacy job sample.

PR 149 was subsequently rebased and extended at
`b0d9238fb73e608b1a8a4d79fa88bd179664c655`; CI `37287011553` passed
(578 tests). It now removes nonempty-dashboard full-list demand too, with exact
health counters and guarded empty-catalog bootstrap. Hold until both catalog
and health version 3 activation. Content-editor demand still remains.

The latest production readiness probe returned Server Error with request ID
`0b39c67c9a8962b0`. No migration/activation or live workflow/cost verification
has run. Frontend production remains PR 146's deployment.

PR 145 was subsequently extended with complete job-history pagination at
`42791694211874106611e311698bd46882931d9b`; CI `37287750467` passed
(574 tests). It remains held until current catalog activation, with combined
dashboard checks required when merging the other held frontend changes.

## Combined reader release prepared

The held frontend changes from PRs 137, 141, 145, 148, 149 and 153 are assembled
on branch `codex/convex-reader-release` over deployed backend PR 152. Shared CJ
Settings conflicts were resolved to use paginated sourcing plus exact maintained
health counts; integration fixtures now exercise the combined contracts.

Local verification: 619 tests in 101 files, frontend type check, full lint with
zero errors (507 warnings), transactional writer guard covering 58 entry points,
and production build/client-secret scan. PR 148 CI `37290838765` and PR 153 CI
`37291953007` passed. No frontend cutover or production data activation occurred.

The latest readiness probe failed with request ID `e18aecd224a43561`. Production
Convex function restoration is still required for migrations, activation, live
workflow verification and equivalent-workload cost measurements. See
`CONVEX_READER_RELEASE.md` for the combined release gates and rollback sequence.

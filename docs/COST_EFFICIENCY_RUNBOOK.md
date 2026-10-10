# Louie Mae Cost-Efficiency Runbook

This runbook keeps useful storefront, AI, import, inventory, and fulfillment
features intact while preventing accidental spend and cross-environment data
access.

## Current operating state — October 9, 2026

See [the completion audit](CONVEX_COST_REDUCTION_PROGRESS.md#current-status--october-9-2026-after-pr-162)
for release identifiers, migration verification, measured savings, and unresolved
gates. The original plan is not complete merely because the release is live.

Production is `diligent-jay-261`; isolated development is `kindred-squid-489`.
Both have verified catalog/health/sourcing/recent-webhook readers enabled.
Public prelaunch mode stays enabled; do not disable it to perform acceptance.
For isolated storefront tests, use a local process override against development
and stop that process after restoring the test cart to its initial state.

### Monitoring pause and operational work

The owner requested all monitoring paused. Leave
`BACKGROUND_MONITORING_ENABLED` unset or false and do not re-enable scheduled
workflows or Codex automations without a new request. The pricing panel shows the
pause; explicit manual refresh remains available. Time-driven health refresh and
pricing monitoring are paused, while transactional summary maintenance continues.

The verified LouieMae production/development scheduler contains only:

| Job | Interval | Purpose |
| --- | --- | --- |
| sync-klaviyo-waitlist | 1 minute | Dispatch persisted signup work |
| reconcile-klaviyo-consent | 15 minutes | Reconcile consent |
| sync-cj-tracking | 4 hours | Update order tracking |
| backfill-cj-sourcing-jobs | 1 minute | Bounded legacy sourcing recovery; completed checks do no database work |
| dispatch-cj-sourcing-jobs | 1 minute | Lease and dispatch due sourcing |
| recover-stale-cj-webhooks | 5 minutes | Recover abandoned processing claims |
| sync-cj-inventory | 30 minutes | Check a bounded set of due inventory records |

Preserve these operational jobs. Changing their intervals merely to reduce call
counts can delay stock, orders, recovery, or signups. The missing Nexx development
pause is tracked separately; do not claim every environment is paused until its
scheduler can be inspected and updated. Nexx production and the two inspected
previews retain twelve cleanup/recovery jobs. Four chat-upload monitoring
workflows are disabled and `nexproof-daily-system-check` is paused.

### Authoritative product and checkout behavior

Catalog lists use compact paginated summaries; selected-product details use the
source product. Homepage recommendations use a six-card furniture preview.
Summary maintenance must stay transactional across edits, imports, publication,
inventory, and sourcing changes. A readiness failure must not trigger a full
catalog fallback. Use bounded integrity/repair tools rather than repeating an
entire migration by default.

Checkout resolves stored product price plus the selected variant adjustment,
name, images, and supplier mapping. Never accept browser prices or supplier IDs
as authoritative. Missing/deleted/hidden/unavailable selections fail closed,
including when automatic fulfillment is disabled. Preserve payment-event and
supplier idempotency when testing retries.

### Release and rollback

Latest runtime frontend: PR 162, `dpl_CFWyKqmfj1U5bLvMNmUy1LPybKcc`.
Prior compatible frontend: PR 160, `dpl_91bkRfBGxCm3chbecaFJf1jyZbk2`.
The latter retains the old homepage gap but is compatible with the existing
backend; do not roll back authoritative checkout merely to revert a UI defect.

For a verified frontend regression, restore the prior deployment with the linked
project's CLI: `vercel rollback dpl_91bkRfBGxCm3chbecaFJf1jyZbk2 --scope team_9duTzU0GI03przH6ifcdZFKt`.
Then inspect the alias target and repeat the affected flow. This is an emergency
procedure, not an instruction to roll back now. Keep the current read-model gates
and maintenance enabled unless a separately verified backend defect requires a
compatible backend rollback. Never disable a required gate under active clients.
Code rollback cannot restore deleted historical data.

## Environment boundaries

| Runtime | Frontend Convex target | Convex secrets | Intended data |
| --- | --- | --- | --- |
| Local development | Personal/development deployment | Development provider keys | Test data |
| Vercel Preview | Shared staging or branch preview deployment | Staging provider keys | Test data |
| Vercel Production | Production deployment | Production provider keys | Live data |

Set LOUIE_MAE_PRODUCTION_CONVEX_URL and
LOUIE_MAE_PRODUCTION_CONVEX_DEPLOYMENT in local/preview environments. The
pre-build guard fails if either environment points at those production values.

GEMINI_API_KEY and LOUIE_MAE_AI_MODEL belong in each Convex deployment's
environment settings. They must not be configured as VITE_ variables.

## Required one-time security steps

These changes require dashboard access and are intentionally not automated:

1. Deploy the server-side AI actions and frontend together.
2. Confirm concierge, page generation, category suggestions, variant
   translation, newsletter copy, and blog excerpts in Preview.
3. Remove VITE_GEMINI_API_KEY and any browser Gemini aliases from all Vercel
   environments.
4. Rotate the previously browser-exposed Gemini key, restrict the replacement
   key to the required Gemini APIs, and store it only in Convex.
5. Run npm run build; the post-build scanner must report
   “Client-secret verification passed.”

## Vercel build controls

The repository's ignoreCommand runs scripts/vercel-ignore-build.mjs.
Documentation-only and GitHub-automation-only commits skip a Vercel build;
runtime changes still build normally. CI cancels superseded PR runs but preserves
main runs once started. It deploys Convex without repeating the already completed
frontend build. The current GitHub workflow also runs for documentation changes;
a successful backend job on such a commit is not a new functional backend release.

Review monthly:

- Vercel Usage: Build CPU time by project and deployment.
- Vercel Deployments: repeated builds for the same commit or inactive branches.
- Vercel Observability: function invocations, duration, and transfer. A sudden
  increase should be tied to a feature or investigated before raising limits.
- Convex Usage: database reads/writes, action compute, storage, and bandwidth by
  function.
- Convex Logs: AIUsage records by operation, duration, and success. Logs do not
  contain prompts or secrets.

Keep Preview deployments for active work. Close stale pull requests and remove
inactive Git branches rather than disabling useful previews globally.

## Convex data lifecycle and usage controls

The storefront receives only public product projections. Full products,
newsletter subscribers, campaigns, draft posts, and write operations require
the configured admin allowlist (`CJ_ADMIN_EMAILS` or `ADMIN_EMAILS`). Search is
skipped until the modal is open with at least two characters and returns at
most 20 indexed matches.

Batch import scraper results are normalized into versioned
`batchImportPayloads`; raw provider HTML is not retained. Progress rows remain
small, while the next 12 review records are loaded through a dual-read path so
legacy inline payloads remain usable during migration.

Production rollout order:

1. Deploy schema and dual-read code to Preview and run the protected 1688 and
   generic import fixtures.
2. Run `batchImports:migrateLegacyPayloads` with `dryRun: true` and cursor
   pagination; record before/after bytes.
3. After approval, repeat with `dryRun: false` in batches of at most 25,
   advancing `continueCursor` until `isDone`.
4. Run `dataLifecycle:backfillRetentionMetadata` once per legacy record kind,
   first with `dryRun: true`, then (after approval) in bounded write batches.
5. Run `dataLifecycle:report` and `dataLifecycle:cleanup` with `dryRun: true`.
   Review counts before any `dryRun: false` call. Cleanup is bounded and safe
   to repeat; a parent batch job is kept until every legacy child is gone.
6. Run `files:reportStorage` for a read-only candidate list. Never delete files
   solely because the bounded app scan says “possibly unreferenced”; verify
   external/legacy references manually.

For description-audit retention metadata, call
`dataLifecycle:backfillRetentionMetadata` with
`{"kind":"descriptionAudits","dryRun":true,"limit":100}` and record the
candidate count. After approval, call it with the same arguments and
`"dryRun":false`. Repeat the write call until the returned `hasMore` is
`false`; each successful pass removes those rows from the missing-expiry index,
so rerunning is safe. Finish with another dry run and confirm zero candidates.

For product search metadata, call `products:backfillSearchText` with
`{"dryRun":true,"limit":100}` and record the candidate count. After approval,
call it with `{"dryRun":false,"limit":100}` repeatedly until `hasMore` is
`false`. Finish with the dry-run form and confirm zero candidates before
relying on indexed storefront search.

Retention defaults are intentionally conservative: batch review payloads 72
hours, terminal batch metadata 30 days, description audit debug payloads 30
days (the audit identity/final result remains), legacy successful CJ webhook
diagnostic payloads 90 days, and CJ/AI usage telemetry 90 days. Webhook event
identities are retained indefinitely until the provider replay horizon is
verified. No cleanup cron is enabled until a human reviews the first production
dry-run.

### CJ webhook payloads and safe compaction

New successful events discard their replay payload when the current claim owner
marks processing complete. Their message ID/status remains, so a delayed provider
duplicate is still suppressed. Failed, retryable and in-progress events retain
their payload. A successful event's `expiresAt: 0` denotes an already compacted
diagnostic; missing expiry metadata is not an expired record.

The October 9 expiry preview returned zero eligible records. About 21.15 GB was
still attributed to cjWebhookLog in the dashboard, without verified allocation
by deployment. Chronological samples often contained identity/status only; these
small samples cannot explain the whole table. Running compaction repeatedly with
no eligible rows will not establish storage savings.

Provider retry count does not establish the maximum replay age. Stock processing
currently records receipt time, so deleting an identity could allow an old stock
event to be applied again as new. Keep identities until replay behavior and stale
event handling are resolved. Failed/unresolved events stay protected. No historical
deletion or automated cleanup is approved by the code-deployment authorization.

Historical cleanup is a separate operation from deploying this code:

For read-only age/size attribution, `webhookRetention:storageSample` accepts
`fromInclusive` and `toExclusive` creation timestamps in milliseconds. Use a
small, fixed set of monthly windows. It reads the earliest five records in each
indexed window with a 2 MB page budget (a final record can cross that budget).
Results expose IDs, types, statuses, expiry and estimated JSON byte sizes, never
payload contents, message IDs, claim tokens or error text. These are chronological
samples, not random samples or estimates of total storage. JSON sizes exclude
index/platform overhead and must not be presented as billed storage. The query
does not backfill metadata, authorize cleanup or change any source record.

1. Confirm the deployment and recovery/backup requirements. Code rollback cannot
   recover discarded historical payloads.
2. Backfill missing legacy expiry metadata through the existing dry-run-first
   `dataLifecycle:backfillRetentionMetadata` workflow if needed.
3. Call `webhookRetention:preview` with `{"cursor":null}`. Each page inspects at
   most five records, reports only IDs/status/type/estimated payload bytes, and
   identifies unresolved exclusions. Continue with its cursor, including across
   pages containing only unresolved events. Do not restart at the first page.
4. Review the exact eligible IDs and their scope before changing historical
   data. Call `webhookRetention:compact` with those IDs and `dryRun: true`.
5. After that scope is approved, call the same IDs with `dryRun: false`. A maximum
   of five distinct IDs is accepted, and eligibility is rechecked transactionally.
   Event identities are never deleted; retries and interrupted batches are safe.
6. Verify duplicate suppression, unresolved-event recovery and table storage
   before continuing. Stop simply by ceasing these operator calls; no cleanup
   schedule is registered.

The general lifecycle cleanup also preserves webhook identities and unresolved
payloads. Prefer the exact-ID webhook tool for production review, because the
general cleanup additionally handles other retention categories. Expiry queries
exclude missing/zero timestamps, and a future `now` cannot force early cleanup.

CJ inventory polling uses `cjInventoryNextCheckAt`: visible products remain on
a six-hour freshness target, while hidden/out-of-stock products are checked
daily for restocks. A 30-minute cron selects only due records. Run the bounded
`cjHelpers:backfillInventoryNextCheck` first with `dryRun: true`, then in
approved bounded write batches after deployment. Inspect
`cjUsage:getInventoryPollSummary` for empty runs, provider token requests,
updates, and errors before changing the schedule.

## Static asset deletion evidence

Two files with copy-only names were removed from public/images/brand:

- 869F81A5-59DB-4730-B2A1-8D8DF1D33CA3 copy.PNG
- 869F81A5-59DB-4730-B2A1-8D8DF1D33CA3 copy 2.PNG

Both had SHA-256
E3F482008DFDF0A5BFDED8FB1B1412A68ABDD3017217B3EE526E38E64E7B8374,
identical to the retained canonical file
869F81A5-59DB-4730-B2A1-8D8DF1D33CA3.PNG. A repository-wide literal-name
search outside public and dist returned no references. No unique brand image
was removed.

## Monthly waste review

1. Compare the current invoice period with the previous 30 days.
2. Attribute the top three increases to a deployment, Convex function, AI
   operation, or asset.
3. Treat import, fulfillment, and customer-facing AI work as valuable when
   volume matches user activity.
4. Investigate empty scheduled runs, repeated builds, failed/retried actions,
   growing temporary import data, and client queries returning data the visible
   route does not use.
5. Do not purge production data, change billing plans, or rotate credentials
   without owner approval and a verified rollback.

## Rollback

- Frontend: roll back or promote the last known-good Vercel deployment.
- Convex: keep new function/schema changes backward-compatible through the
  frontend rollout; deploy the prior functions only if the old schema remains
  compatible.
- AI: restoring the old client-side key path is not an acceptable rollback.
  Roll back only the server action implementation or model selection.
- Environment guard: use a non-production Convex target. Do not bypass the guard
  by deleting the production reference values.

## CJ stock-webhook target index rollout

The original stock-target lookup read all source products for each VID/SKU. An
uncached production lookup on October 9, 2026 returned no matches after reading
621 products / 8,691,954 database bytes. This is a single lookup measurement,
not an estimate of total invoice savings or historical webhook storage.

`cjInventoryTargets` stores distinct `(productId, kind, value)` associations for
product-level IDs, customer variant mappings, and CJ variants. All existing
product writers maintain these through the transactional product trigger.
Unrelated price/stock/telemetry updates skip target maintenance when keys match.
VID and SKU remain distinct, matching stays case-sensitive, hidden/out-of-stock
products remain eligible for updates, and union results deduplicate product IDs.

Release procedure (each deployment separately):

1. Deploy the additive tables/indexes, writer maintenance, gated reader and
   migration functions. Before activation, the compatible legacy lookup remains
   in use. No source products or webhook history are removed.
2. Read `cjInventoryTargets:status`. If no migration exists, call `begin` once.
   If one is already in progress, resume its returned phase/cursor; do not begin
   again. An enabled migration cannot restart without an explicit disable.
3. Call `advance` with the current `expectedPhase` and `expectedCursor` until
   `verified` or `failed`. Each source batch reads at most two products; byte
   budgets apply. The backfill syncs exact keys, the source pass compares all
   keys including duplicates, and the orphan pass checks distinct product IDs
   so large variant arrays do not multiply full-source reads. Retried stale
   phase/cursor pairs make no progress and do not duplicate mappings.
4. Stop on `failed`; inspect mismatch IDs and repair their underlying mapping
   maintenance issue before restarting. Never activate an incomplete migration.
5. After phase `verified`, call `setEnabled` with `enabled: true`. Verify the
   status, compare a bounded equivalent lookup workload, and inspect failures.
   Source maintenance continues after activation. A stale returned mapping fails
   processing for recovery rather than silently dropping an inventory update.
6. For an index-related incident, `setEnabled` with `enabled: false` restores
   the legacy lookup while retaining target maintenance and data. This restores
   the prior full-scan cost too; do not leave it as the permanent solution.
   Rebuild/verify before reactivation. Existing webhook claims/recovery remain.

The index adds small mapping rows and writes when identifiers change. Record
backfill usage separately and measure steady-state reads plus mapping-write
costs. It does not reduce the retained historical `cjWebhookLog` table, authorize
identity deletion, change provider subscriptions, or resume monitoring.

The product-ID webhook helper `cjHelpers:getProductByCjProductId` uses the native
`products.by_cj_product_id` index. It preserves exact case-sensitive ID equality,
all matching listings, and creation order, including hidden/out-of-stock products.
This index is populated and maintained by Convex; it needs no application-managed
migration or readiness toggle. Verify schema deployment and an equivalent lookup
before treating the change as live. Its measured pre-change no-match baseline was
also 621 source documents / 8,691,954 bytes. Reverting only that helper to its old
filter scan is compatible with leaving the additive index in place, but restores
its former read cost. This change does not alter webhook retention or schedules.

### Webhook redelivery retry ceiling

The webhook claim mutation applies the eight-attempt ceiling to every reclaim path,
including retryable events and expired processing leases. Provider redelivery cannot
bypass the scheduled retry limit. Exhausted records and their recovery payloads are
preserved; no automatic reset, deletion, or extra supplier action is performed.
The final allowed attempt remains claimable, and only its current claim owner may
complete it. Bounded stale recovery keeps active leases intact and schedules each
recovered event once. Regression coverage: `convex/cjWebhookRecovery.test.ts`.

## Compact webhook recovery queue and index retirement

The October 9 provider table report attributed 5,676,945,241 bytes to webhook documents and 17,030,835,723 bytes to their indexes across the project. Its per-table deployment filter was not honored. Index bytes are aggregate, not a measurement of this individual index or a promised invoice reduction.

PR168 deployed a processing-only queue, completed its bounded source/queue verification in development and production, and enabled both readers. Both environments had zero processing records during migration; populated-event behavior was verified separately in integration tests. Scheduled recovery subsequently succeeded in both environments. Source event identities, unresolved payloads, status transitions, claim tokens, and retry limits remain in `cjWebhookLog`; wrapped source writes maintain the queue transactionally.

The retirement release removes only `cjWebhookLog.by_status_claimed_at`. It retains `by_message_id` for deduplication and `by_expiry` for retention tooling. No source records are deleted, no cleanup is enabled, and monitoring remains paused. The recovery reader requires an enabled, verified queue and refuses drift. It never falls back to a historical table scan.

### Deployment gate

1. Before deployment, check `webhookRecoveryQueue:status` independently in each target. Require `enabled=true`, `phase=verified`, and no mismatches. Do not deploy retirement over an unfinished PR168 migration.
2. Run the Convex deployment dry run. Require exactly one removed index: `cjWebhookLog.by_status_claimed_at`. Large-index removal requires the CLI's explicit `--allow-deleting-large-indexes` option. Scope that option to this reviewed deployment; do not add a permanent bypass to CI.
3. Deploy development, inspect deployed indexes and queue readiness, and verify scheduled recovery. Deploy the exact reviewed, CI-passing head to production with the same gate and explicit index-removal option, then merge it. Main CI redeploys the same schema with no remaining index removal. This ordering keeps the ordinary CI deletion guard intact.
4. Verify the seven operational schedules and a post-release recovery completion. Measure provider storage estimates separately before and after; reporting lag or unrelated writes may affect the result.

### New deployments and repair

Before a genuinely empty deployment receives its first webhook, call `webhookRecoveryQueue:initializeEmpty`. It atomically checks that both source and queue are empty before creating a verified, enabled state. Repeated calls on an already verified, enabled deployment leave its state unchanged. An existing nonempty deployment without verified coverage must use the PR168 migration release first; this endpoint cannot certify it.

`repair` still accepts at most five exact webhook IDs and only synchronizes derived queue rows from the authoritative source. Use it for a known mismatch. It is not a substitute for proving complete coverage after an unknown out-of-band change. The writer guard must continue covering every source mutation.

### Rollback or full rebuild

Old `begin`, `advance`, and `setEnabled(false)` calls now fail before changing state, explaining the prerequisite below. They do not disable scheduled recovery or initiate an expensive history scan.

For an unknown coverage issue or a required return to the legacy reader:

1. Restore PR168's `cjWebhookLog.by_status_claimed_at` definition as a schema-only change while retaining the current queue reader. Deploy and wait for index backfill to finish; the many historical records mean this can take time and add storage. A staged index may be used for background rebuilding if needed.
2. Restore PR168's recovery maintenance and migration functions from commit `aaf35f5d6f2bbeebf851d7751e1376923d149cdd`, preserving unrelated later changes. Deploy only after the restored index is ready. Convex also ensures a newly defined index is backfilled before registering functions that use it.
3. Call the restored `setEnabled(false)` to return to indexed source recovery. Source maintenance continues. For a rebuild, call restored `begin`, then advance with its epoch/phase/cursor through processing-source backfill, source verification, and orphan verification. Stop on mismatches and use bounded repair.
4. Re-enable only when the restored migration reaches `verified`. Index retirement is a separate reviewed release again.

Do not blindly revert all of main, assume a code revert restores the index instantly, or delete webhook identities to accelerate recovery. Index lifecycle reference: https://docs.convex.dev/database/reading-data/indexes/.
### Tracking selection and pagination

The tracking sync traverses due `confirmed`, `processing`, and `shipped` orders through `orders.by_cj_status_sync`. Each query reads at most ten rows. The run keeps one one-hour cutoff across every page and uses index-key cursors so updating a processed row does not require that row to remain in the due range. Missing legacy sync timestamps remain eligible; delivered/cancelled/failed orders remain excluded. The old internal array reader is retained for compatibility, but the active worker uses pages.

A failed provider response now increments the returned error count. Existing tracking reconciliation, notification deduplication, four-hour scheduling, and `{ synced, errors }` response shape remain unchanged. Paging bounds individual database reads; it does not establish a maximum duration for a whole sync with a large active-order backlog. If that workload develops, use a durable continuation design with explicit run totals and notification ownership before changing the manual action contract.

Deploy the additive index with the backend before exercising the new reader. Rollback can restore the old reader/worker while retaining this index. Validate pages under changing sync timestamps and status transitions. Production currently has no due tracking orders; empty-run success is not proof of live shipment or email delivery.

## Manual inventory action result (October 9, 2026)

A production manual refresh selected 25 products and successfully updated all 25
with zero provider errors in 410.656 seconds. Its public `cjActions:refreshInventory`
caller had already returned an error after 301.705 seconds while awaiting the
nested action. The error did not mean the inventory writes were rolled back.

The public action now invokes the same inventory handler directly after the
existing admin authorization check. The internal scheduled action retains that
handler and its existing arguments. Selection limits, provider request pacing,
variant snapshots, freshness scheduling and result counters are unchanged. The
admin controls say **Refresh inventory** to distinguish an action from navigation.

Regression coverage exercises a simulated 425-second, 25-product refresh through
the public action while making the old nested inventory RPC fail if called. It
also verifies provider failure reporting, targeted scope, and denial before any
inventory work. Simulated elapsed time is not a platform timeout test; release
verification must separately confirm the deployed public action returns its
actual result. This fixes the observed nested-call failure, not arbitrary-sized
workloads: the Node action's own execution limit still applies. Durable continuation
remains an option if measured batches approach that limit.

No data migration, new cron, sourcing submission, order, payment, or notification
is introduced. Rollback restores the prior caller and button labels; no records
need reverting. Monitoring must remain paused.

## Batch completion regression gate (October 9, 2026)

`convex/batchImportCompletion.test.ts` exercises the same save-then-mark sequence
used by the import UI against isolated Convex tables. It verifies duplicate save
retries (including after completion), preservation of ten variants/six images
and non-ASCII supplier fields, hidden catalog projection, per-item payload release,
legacy inline payload removal, keeping the remaining review group open, and final
job completion. Invalid saves and unauthorized completion leave review data intact.

This complements the production quick-URL browser import and accepted single CJ
submission. It does not claim production batch-button acceptance or supplier
approval/fulfillment. The existing production three ready items are untouched.

## Atomic batch product save and completion

Deploy the backend before promoting the matching frontend. `products:createBatch`
now saves products, updates derived summaries, completes associated batch items,
and deletes their temporary review payloads in one transaction. Invalid/cancelled
items roll back the entire save. Retries return the existing product identity.
Legacy clients may still call `batchImports:markImported` after saving; completed
items remain idempotent, and ready items require a persisted product before cleanup.
No schema migration or cron change is required.

Rollback the frontend first, or restore both sides together: the new frontend
relies on server completion and must not remain live against the former backend.
Development acceptance preserved ten variants/six images, completed the job and
released its payload in one request, verified retry identity, and removed the hidden
fixture without CJ submission. UI tests cover one submission and draft preservation
on rejection. These checks do not claim a new production batch-button import.

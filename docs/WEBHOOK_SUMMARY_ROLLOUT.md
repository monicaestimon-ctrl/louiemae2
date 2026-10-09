# Compact webhook dashboard statuses

The operations dashboard samples the latest 100 webhook records to report
processing, processed, retryable and failed counts plus the oldest processing
claim in that sample. Its existing query reads full records, including retained
payloads. The new allowlisted summary stores only the source ID, source creation
time, status, version and a normalized valid claim timestamp. It contains no
payload, error text, message body or claim token.

The sample keeps its existing meaning: it is the latest 100 records, not a global
backlog or all-time counter. Source creation time and source ID determine order,
not the later summary insertion time. Undefined legacy status still means
processed; invalid claim timestamps are excluded from the oldest-claim metric.
See [Convex index ordering](https://docs.convex.dev/database/reading-data/indexes/)
for why backfilled records require an explicit source-time index.

## Deploy, backfill and verify

1. Deploy the additive schema, writer maintenance and gated dashboard reader.
   Existing dashboard reads remain active until explicit activation. All typed
   webhook writers use the transactional wrapper. Claim/retry/completion changes
   update metadata with their source transaction; payload-only retention changes
   skip metadata reads and writes when the projection is unchanged.
2. Restore Convex function availability. Confirm the target is LouieMae production
   `diligent-jay-261`. Record actual production webhook row and payload volume.
   Project-level historical storage figures do not prove production allocation.
3. Choose the scope from the reader contract and production size. LouieMae had
   23,209,840 source events on October 9, 2026 UTC. Use `scope: "recent"` there:
   each pass covers the exact latest 100 events used by the operations reader,
   at most 300 row visits across backfill, verification and orphan verification.
   Live inserts/status changes still maintain summaries transactionally. Older
   source events and all replay/deduplication evidence remain untouched.
   The default `scope: "all"` retains the complete-history option for deployments
   that require it. Budget that option's one-time reads: backfill and verification
   each visit every webhook; the orphan pass also fetches summary owners. Large
   legacy payloads therefore make these passes expensive despite small batches.
   Complete separately authorized, reviewed eligible-payload compaction first
   where appropriate. Never remove unresolved replay evidence to speed this up.
4. Call internal `webhookSummaries:startRebuild` with `{ "scope": "recent" }`
   for LouieMae. Keep its returned epoch. This disables summary use until verified.
5. Call `webhookSummaries:rebuildNext` with that epoch and the current phase and
   cursor until `verified` or `failed`. Source passes read at most five records
   with a 2 MB pagination budget; the orphan pass reads five compact summaries
   and at most five source owners. Stale cursor/phase/epoch retries do not advance.
   Record progress and errors; resume from the last committed state.
6. A mismatch leaves activation disabled. Inspect the exact IDs. Use `repair`
   with one to five distinct IDs to reconcile a projection or remove an orphan
   summary, then restart verification via `startRebuild`. No source log is deleted.
   Direct dashboard writes bypass application maintenance and require repair.
7. Once all passes verify, call `setEnabled({ enabled: true })`. Wrapped live
   changes maintain each verified projection, so normal traffic does not require
   restarting a global verification pass after every status transition.
8. Compare the enabled dashboard sample with the same source window. Exercise a
   new claim, a retry, stale claim completion, successful completion and duplicate
   delivery. Verify claim ownership and replay payload retention separately from
   metadata parity. The summary does not replace the deduplication/replay record.
9. Measure dashboard read bytes and webhook write overhead under a representative
   workload. Record source and summary sizes, executions, latency and errors.
   No production savings are established by a successful deploy or fixture tests.

Recent-window verification checks source projections and the top summary owners,
including their ordering fields. It supports empty/small tables and arrivals
during the rebuild. A wrapped source deletion invalidates recent readiness,
because deleting an event can expose an older event without a summary. The
dashboard then uses its existing bounded latest-100 source query until an
operator reruns the recent rebuild. Current retention compacts payloads and
preserves source identities; it does not trigger this deletion path. Direct
dashboard edits still bypass transactional maintenance and require reconciliation.

## Rollback

`setEnabled({ enabled: false })` restores the existing full-log dashboard sample.
It does not delete logs, payloads or metadata; it restores the former read costs.
Missing rows after activation are not individually replaced by hidden full-log
reads. Disable and repair if parity fails. Existing unresolved payload retention
and successful-event deduplication identities remain unchanged by this feature.

The local writer check covers typed product, sourcing-job and webhook writes.
The untyped lifecycle metadata loop was also inspected and moved to the wrapper.
Do not add untyped source writes that evade this guard. Regression tests compare
135 source rows with the latest-100 summary window and cover private-payload
exclusion, legacy/invalid dates, retries, rollback, drift, orphan repair and auth.

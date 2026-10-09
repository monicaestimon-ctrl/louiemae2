# Incremental product health

Health summaries preserve the existing image, sourcing age, CJ mapping and
fulfillment-readiness rules. The legacy full-audit endpoint uses the extracted
shared rules and remains available for existing clients. New issue pages read
compact health records; totals come from one maintained state record. The backend
was deployed separately before the frontend cutover described below.

Version 2 also maintains exact pending/approved/rejected product counts for
legacy sourcing migration: a product counts only when its sourcing job ID is
absent. Job assignment, status transitions, insertions and deletions update
these counts in the same transaction. After explicit health activation,
`getAdminOperations` uses these counts instead of three full-product scans;
its `migration.truncated` becomes false and counts can exceed 500. Before
activation or after explicit rollback it keeps the existing capped contract.
Version 3 adds exact counts for all six inventory CJ connection states and the
Next Launch queue. Counts follow the complete shared connection-status rules,
including all customer variants, and update atomically on transitions/deletions.
`status.inventoryCounts` is available only after current-version activation;
future dashboard clients must distinguish unavailable counts from zero. The
bounded source verification independently checks every count and rejects drift.
Version-1 or version-2 verification cannot activate version 3; start a fresh rebuild.

Separately, verified catalog activation changes operations job display lookups
to compact catalog rows. It preserves job metadata and source URL while
avoiding full supplier documents. It never silently reloads a full product to
repair a missing compact row. Catalog rollback restores the old lookup path.

All product-writing builders maintain health alongside the authoritative product.
Price-only and unrelated telemetry changes skip health maintenance when the
derived value is unchanged. Summary changes and totals commit atomically; failed
product edits roll both back. The existing writer-coverage CI check applies to
the shared product builder.

The 48-hour pending threshold is stored as a due timestamp. Every five minutes,
the due-index handler reads at most 50 compact rows with a 500,000-byte budget.
It adds the age issue in the original rule order, updates the issue count, and
clears the timestamp. It does not reload full products or scan healthy rows.
Displayed hours are formatted from the submission timestamp when queried. A
backlog can require several runs; measure oldest overdue age before activation.

## Operator rollout

1. Restore backend availability; capture the existing dashboard's result and I/O.
2. Call `productHealth.startRebuild`. It creates a new epoch, disables new readers,
   and starts counts at zero without deleting tables or source data.
3. Call `rebuildNext` with the returned epoch, phase and cursor until completion.
   Backfill and verification read at most five source products per transaction;
   the orphan pass checks five summary owners. Stale cursor or epoch retries do
   not advance a second page. Concurrent product changes join the new epoch once.
4. Verification compares every source projection, all four health totals and
   all three migration counts, including approved products missing CJ variants. If a live
   summary update occurs during verification, only verification restarts; the
   maintained data does not need to be rebuilt. A busy workload may require a
   quieter verification window. Mismatches leave readers disabled.
5. Repair drift by restarting the bounded rebuild; this also removes orphan rows
   and reconstructs counts. `verifyAgain` checks integrity without rebuilding.
6. Once phase is `ready`, call `setEnabled({ enabled: true })` after reviewing
   parity, index readiness, deadline freshness, per-page I/O, and write contention.
   Activation requires the revision verified by the completed pass.
7. Deploy the frontend cutover to status plus paginated issues. Ensure the UI
   distinguishes an unprepared report from zero issues and uses exact CJ totals,
   rather than counting only loaded pages. Preserve access to every issue.

`setEnabled({ enabled: false })` stops new reader use; roll the frontend back to
compatible old endpoints first if needed. Rebuilds also disable new readers, so
coordinate their maintenance window with the client. Direct dashboard writes
bypass application maintenance and require reconciliation. Never infer savings
from a disabled deployment or claim live parity based only on fixture tests.

Tests cover rule edge cases, 535-source rebuilds, concurrent edits, stale retries,
deletion, counter drift repair, atomic rollback, bounded deadline processing,
source parity after deadline refresh, incomplete activation and authorization.
Production initialization, measurements and live workflow checks remain gates.

## Dashboard reader cutover

The prepared CJ dashboard change reads `productHealth:status` and only subscribes to
`productHealth:issuesPage` after verified activation. It requests five compact
issues initially and loads another 25 on demand. Exact totals determine the
readiness badge and missing-variant diagnostics; a partial or empty loaded page
cannot mean the inventory is clear. Every issue remains reachable through the
load-more control. The automatic `products:auditProductHealth` subscription has
been removed from this screen; its old endpoint contract remains for old clients.

Before initial activation or during rebuild/repair, this dashboard explicitly
shows unverified health. It does not start a full-product scan as a fallback.
Manual reconciliation and individual product operations remain available.
Complete the bounded rebuild/verification procedure above before merging and
deploying this frontend cutover. During subsequent maintenance, it restores the health
display. A frontend rollback to the previous deployment restores the legacy
audit subscription, with its original read costs. Disabling summary activation
alone shows the unverified state in this new frontend.

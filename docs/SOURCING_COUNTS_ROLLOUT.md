# Sourcing state count rollout

The admin operations dashboard previously loaded up to 501 complete sourcing
jobs for each of 14 states to display capped counts. Once explicitly enabled,
the same endpoint reads one compact counter document and returns exact counts,
including totals above 500. Its other fields and actions retain their existing
contracts. Recent product joins, webhook sampling and legacy migration counts
remain separate cost-reduction work; this change does not claim to remove them.

## Deployment and initialization

1. Deploy the additive schema, transactional writer wrapper and readers together.
   Missing or disabled count state preserves the existing capped dashboard reads.
2. Confirm the deployment is the existing LouieMae production `diligent-jay-261`,
   not a preview or development deployment. Confirm function execution is healthy;
   successful code deployment alone is insufficient while the team is disabled.
3. Invoke internal `sourcingCounts:startRebuild` once. Record its epoch and state.
   It disables summary reads, starts empty counters and retains source job records.
4. Invoke `sourcingCounts:rebuildNext` with that epoch and the latest returned
   `expectedPhase` and `expectedCursor`. Continue until `ready` or `failed`.
   Each step visits at most 25 source or summary rows, with a 500 KB pagination
   read budget. Backfill, orphan reconciliation and source verification are
   separate passes. Repeating an old cursor/phase or epoch is a no-op.
5. During backfill, wrapped job inserts, state transitions and deletions update
   the same counters transactionally. A job row records its epoch to prevent
   duplicate increments. Changes during verification restart only that pass;
   there is no need to suspend sourcing workers or customer operations.
6. Inspect `mismatchIds` if verification fails. Do not enable a failed result.
   Fix the uncovered writer or drift, then start a fresh rebuild. A fresh epoch
   recalculates counters rather than adding to the incorrect totals.
7. After successful verification, invoke `sourcingCounts:setEnabled` with
   `enabled: true`. If a transition happened between verification and activation,
   activation rejects it: run `verifyAgain`, finish its bounded verification
   pass, and retry activation with a fresh verified result.
8. Confirm the admin dashboard shows the verified counts, no truncation markers,
   and unchanged recent jobs, errors, manual retry controls and webhook status.
   Exercise a new job, transition, retry and cancellation; compare counts with
   independently paginated source totals. Never use the capped legacy endpoint
   as the sole parity reference for a state containing more than 500 jobs.
9. Record DB bytes/read executions and mutation conflicts for a representative
   workload before and after activation. A shared count record introduces a
   contention point on state transitions; timestamp, lease and other same-state
   updates skip count reads and writes. Check worker throughput and retry latency.

## Rollback and validation

Set `sourcingCounts:setEnabled` to `enabled: false` to restore the existing
dashboard count reads immediately. This does not delete jobs, attempts or source
data. Counter maintenance can continue while disabled. Re-enable only after a
fresh verification if intervening state transitions changed the revision.

The existing writer check now follows both typed product and sourcing-job writes
through shared helpers. All such mutation entry points must use `./functions`.
Do not introduce untyped writes that evade this check. Retention code currently
does not delete sourcing jobs; any future job deletion must use the wrapper.

Regression coverage includes 535 jobs, more than the old display cap; every
state; concurrent backfill updates; stale retries/epochs; new jobs; deletions;
transaction rollback; no-op writes; verification restarts; aggregate drift;
admin authorization; and the legacy rollback path. Production activation and
measured savings must be recorded separately after service restoration.

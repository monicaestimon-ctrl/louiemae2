# Operations job history rollout

`cjSourcingJobs.adminJobsPage` provides complete, newest-updated-first sourcing
history through Convex cursors. It requires admin authorization and current
verified catalog activation. Each page reads at most five jobs with a 500,000-byte
job pagination budget, then at most one catalog row per job. These additional
reads are outside that pagination budget; the five-job cap
bounds fan-out. Returned rows preserve the existing operational allowlist and
never include lease tokens, snapshots or private source descriptions. New job
pages omit the unused activeAttempt field and never hydrate attempt payloads.
The legacy endpoint retains its existing activeAttempt summary for old clients.

`getAdminOperations` keeps its default latest-50 contract (maximum 100) for
existing clients. New paginated clients pass `includeJobs: false` so the metrics
subscription does not hydrate duplicate recent jobs. The remaining metrics keep
their independent health/sourcing/webhook readiness gates and legacy contracts.

Frontend adoption must expose loading, unavailable and exhausted-empty states,
allow continuation beyond empty partial pages, and retain per-product reconcile
actions. Display the loaded count rather than claiming it is the total job count.
Older jobs must remain reachable beyond 100. Rebase with the other CJSettings
frontend changes and run combined CI before rollout.

Production gates: restore backend service, verify/activate the current catalog,
compare job rows and reconciliation actions against the legacy UI, and confirm
pagination under live updatedAt reordering and Convex page splitting. Compare
total database I/O for equivalent dashboard sessions, including summary writes.
Roll back the frontend before disabling catalog readers. This backend release
does not switch clients or run migrations.

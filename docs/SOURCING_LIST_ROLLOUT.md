# Bounded sourcing lists

`catalog.sourcingPage` returns pending or rejected product display rows in stable
source creation order. `catalog.recentApprovalsPage` applies an inclusive approval
cutoff through the existing status/approval index and returns newest approvals
first. Both are admin-only, require verified catalog readiness, and preserve all
cursor/continuation metadata. Page limits use the shared 50-row/500,000-byte cap.
The rows include only the name, first image, source URL and sourcing status,
identifiers, dates and error fields used by the dashboard. Full payloads and
variants remain in selected detail readers.

The approval cutoff retains the legacy ISO-string comparison. Keep `since`
stable for one pagination session; changing the window starts a new session.
The new approval list explicitly orders by approval date, unlike the legacy
creation-ordered scan. Label that order in the UI and keep all results reachable.

Deploy these additive endpoints and the sourcing/creation index first. No new
projection version or backfill is needed beyond catalog v3 because the indexed
fields are already maintained. Confirm index readiness and complete catalog
backfill/parity/activation before releasing frontend consumers.

Frontend adoption must skip the three legacy queries, show loading/unverified
states separately from empty queues, and provide continuation for every list.
Label counts as loaded results until exhaustion or use verified exact totals.
Do not disable Reconcile All because an unloaded or partial page has no matches.
Keep row-level diagnosis, resubmission, removal and product navigation available.
Use an explicit refreshed seven-day cutoff and make its window clear; do not
change cutoff values between pages of the same pagination session.

The current frontend still uses the legacy sourcing lists. No source data or
retention policy is changed by these endpoints. Rollback the frontend independently
while retaining these additive readers and indexes.

# Combined Convex reader release

This release assembles the separately reviewed frontend changes from PRs 137,
141, 145, 148, 149 and 153 on the deployed backend through PR 152. It permits one
frontend cutover and rollback after production data verification. Those component
PRs remain useful review history; merging this combined release incorporates
their commits without requiring six separate production frontend deployments.

## Current release status

The combined cutover and four production read-model activations are complete.
Later fixes through PR 162 are deployed; see the [current completion audit](CONVEX_COST_REDUCTION_PROGRESS.md#current-status--october-9-2026-after-pr-162).
Do not repeat migrations based on the original checklist below.

## Original cutover evidence and gates

Production target: LouieMae `diligent-jay-261`. PR 154 merged at
`c9bc8ac63fe3d87eba3c711f98a3de95926f0557`; main CI/backend deployment
`37872707431` passed. Vercel `dpl_BFkKcHtdrfyERgdsJRELFo43ag1t` is Ready and
promoted to both custom domains. PR 146's `dpl_81sjJPfhr3kDvZ5gK8e6ECUfAhUG`
remains the prior compatible frontend for rollback.

On October 9, 2026 UTC, authenticated production functions succeeded after the
owner transferred the existing project to `monica-estimon`. The deployment URL
and production data remain on `diligent-jay-261`. CLI access is restored. The
catalog v5 backfill completed for 621 products and passed 1,242 bidirectional
checks without mismatches. Catalog readers are enabled. Health v3 independently
verified all 621 products and totals, then activated at revision 623 after a live
update required reverification. Sourcing counts verified 603 jobs and activated
at revision 603. Webhook summaries passed 300 recent-window checks and are enabled.
Public/operator reads passed at cutover. Later authenticated editor review,
pricing-panel verification, isolated cart flows, checkout fixtures and health
read measurements are recorded in the current completion audit. Full write-flow,
external fulfillment and broad workload acceptance remain incomplete.

The destination team's billing page reports Starter with an existing $30 monthly
spending warning and $35 monthly disable threshold. These settings were inspected,
not changed. The new team's initial usage page showed zero while the deployment
usage page reported activity; do not interpret delayed usage reporting as savings.

Production database I/O warnings are now configured at 1 GB daily and 5 GB monthly.
These are conservative initial alerts, not a measured normal-workload forecast.
No deployment hard-disable threshold was added. The existing team spending cap
still applies. Reassess alert levels after measuring the migrated active workload,
and record one-time backfill/verification traffic separately. Windows reset on
UTC calendar boundaries, independently of the team's billing cycle.

Original cutover checklist (items 1–4 and deployment are completed; remaining
acceptance gates are tracked in the current audit):

1. Restore Convex application function availability through the account owner.
   Do not change payment methods, billing plans or transfer projects as part of
   this code rollout. Reconfirm the target deployment and actual account state.
2. Capture source baselines and bound the migration's one-time reads. Complete
   catalog version 5 backfill and bidirectional verification; repair every
   mismatch. Follow `CATALOG_READ_MODEL_ROLLOUT.md` before explicit enablement.
3. Rebuild product health version 3, independently verify all health, migration
   and inventory totals, then enable at the verified revision. Follow
   `PRODUCT_HEALTH_ROLLOUT.md`. Older version verification is insufficient.
4. Complete and verify sourcing-state counters and webhook summaries according
   to their operator runbooks. Production contains 23,209,840 webhook records;
   use the verified recent-window initialization for the latest-100 dashboard
   contract instead of duplicating the entire history. Deploy that additive
   backend option, initialize with `scope: "recent"`, then verify and enable it.
   Historical deletion/compaction remains a separately scoped operation.
5. Test the combined frontend against prepared staging data. Include more than
   500 products, sparse category pages, all CJ filters, search beyond truncated
   display arrays, off-page editor selections, source deletion and live changes.
6. Verify authenticated inventory edit/description generation/import, CJ mapping
   drafts and revisions, sourcing reconciliation, and older job history. Verify
   public product details, stock/variant changes, cart, checkout and fulfillment.
   Preserve failed/unresolved webhook evidence and order/payment idempotency.
7. Review the final combined diff and passing CI against the exact deployed
   backend. CodeRabbit currently skips reviews for this repository; a green
   skipped status is not an independent code review.
8. Merge the reviewed revision and deploy it to the existing production Convex
   URL. Verify Vercel aliases and application workflows before considering the
   release live. No repository environment switch is required for this release.

## Integrated behavior

- CJ Settings uses paginated sourcing lists and jobs, maintained exact health
  counts and paginated health issues, and compact variant queue cards.
- Reconcile All remains available when health is unknown or a sourcing page is
  incomplete; an empty loaded page cannot imply all inventory is healthy.
- Inventory grids and content pickers use summaries. Full selected-product
  editing and generation still load authoritative records with revision guards.
- Store grids, collection previews and legacy category options use bounded
  readers. Product detail/cart paths retain complete public product records.
- The only generic private catalog demand is the guarded, verified-empty initial
  dashboard bootstrap. No list reader silently falls back on readiness failure.

## Measurement and rollback

Compare equivalent workloads before/after: function executions, database read
and write bytes, latency/errors, reactive reruns, summary-write contention,
oldest queue age and inventory freshness. Separate one-time migration traffic
from steady-state traffic. Review sparse preview scanning and multi-page clients;
per-page bounds do not guarantee an absolute per-session cost ceiling.

The equivalent health-read comparison established 84.76% lower read bytes with
identical results. This does not establish the broader 80% workload target or an
invoice reduction; summary writes and representative operation remain to assess.
CJ worker measurements and Nexx upload/chat assurance are recorded in the current
audit. Nexx production is restored; development access remains unresolved. Keep
monitoring paused and preserve provider-spacing and lease safeguards.

For rollback, restore the prior compatible frontend first, then disable new
read-model gates if required. Do not delete source data or disable gates under
an active frontend that requires them. Keep transactional summary maintenance
unless a specific verified defect requires reverting it too.

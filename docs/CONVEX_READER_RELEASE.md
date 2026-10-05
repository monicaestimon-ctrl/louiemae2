# Combined Convex reader release

This release assembles the separately reviewed frontend changes from PRs 137,
141, 145, 148, 149 and 153 on the deployed backend through PR 152. It permits one
frontend cutover and rollback after production data verification. Those component
PRs remain useful review history; merging this combined release incorporates
their commits without requiring six separate production frontend deployments.

## Readiness gates

Production target: LouieMae `diligent-jay-261`. The existing frontend is PR 146's
Vercel deployment `dpl_81sjJPfhr3kDvZ5gK8e6ECUfAhUG`; the deployed backend main
revision is `3cc6103cf375da53753722e6b21de9f0697cb750` (PR 152).

The latest public readiness probe failed with request ID `e18aecd224a43561`.
An earlier authenticated check diagnosed team deployments disabled for free-plan
usage limits. A generic server error does not independently establish a new
billing diagnosis. No production backfill, activation or savings measurement has
been completed. Code deployment success and a working static homepage do not
establish application availability.

Before merging/deploying this release:

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
   to their operator runbooks. Webhook source scans can be expensive for retained
   historical payloads: review their production size and migration budget first.
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

The plan's 80% database-I/O reduction is an acceptance target, not an established
result or invoice promise. CJ scheduling changes require actual worker/queue
measurements; retain current provider-spacing and lease safeguards meanwhile.
Nexx's separately deployed canary controls still need live upload/cleanup and
idle-workload verification after its Convex service becomes available.

For rollback, restore the prior compatible frontend first, then disable new
read-model gates if required. Do not delete source data or disable gates under
an active frontend that requires them. Keep transactional summary maintenance
unless a specific verified defect requires reverting it too.

# Admin inventory rollout

Hold this frontend before merge until the current-version production catalog is
backfilled, verified through both passes and explicitly enabled. Rebase with the
other held frontend PRs and rerun combined CI before deployment.

The inventory tab requests private catalog pages, starting at twenty-five rows.
Collection/connection filters use indexes; hierarchical category and complete
inventory search semantics use the catalog v4 contract. Explicit searches read
at most five summaries per page, plus exceptional large source records as
documented in CATALOG_READ_MODEL_ROLLOUT.md. Empty filtered pages retain a Load
more control. Loaded counts are labeled, and an empty-inventory message appears
only after exhaustion. Loading, updating and unavailable states are separate.

CJ status and image/variant counts come from complete maintained metadata, never
from capped display variants. Edit opens the authoritative record by ID. Smart
Preview explicitly applies to loaded items and retains the full-record fetching,
admin-edit protection and revision checks in useAdminDescriptionBatch. Load more
matches before running it on a larger set. Publishing, stock checks and deletes
retain existing mutations. The global Next Launch action remains available as
Launch queued products, without an inaccurate partial count.

The inventory tab stops requesting the legacy private context list, including
while editing. Dashboard and content-editor legacy subscriptions remain separate
work; this change must not be described as eliminating every full list read.

Validation before production cutover: browse/search past product 500, exercise
every connection state and configured category descendant, compare complete
mapping counts on products with over 100 options, open/edit a late-page product,
verify unchanged description protection and publishing/stock actions, and check
loading after closing an editor. Measure summary reads plus write maintenance
against the same inventory workflow. Roll back the frontend before disabling
catalog readiness; do not add a hidden legacy full-scan fallback.

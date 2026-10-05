# Public collection preview rollout

Hold this frontend until the current catalog version is backfilled, verified
through both passes and explicitly enabled in production. Rebase with current
main and rerun CI before merge. A disabled backend cannot establish correctness
or savings through an empty catalog.

The arrivals page reads separate indexed dated/legacy preview pages for fashion,
kids, furniture and decor. Each collection shows at most twelve public summaries.
It keeps requesting byte-limited partial pages until the preview fills or the
matching range is exhausted. Legacy `isNew` rows are requested only after dated
arrivals are exhausted and space remains. Publication ordering, strict thirty-day
cutoff, visibility and legacy fallback are enforced by the backend contract.
The cutoff is fixed for the page visit; a new visit refreshes the window.

New Collection separately uses `dropPage` to fill four cards per collection in
publication order, with legacy featured priority. This is not the arrivals window
or the storefront's featured sort. Invalid publication dates have the deterministic
undated ordering documented in the v5 backend contract; verify those records
explicitly before release. Short byte-limited pages continue until four or exhaustion.

Neither page requests the shared full storefront catalog. Preview products
have an explicit display-only type, and count badges describe featured arrivals,
not total inventory. Loading and unavailable states are distinct. Existing
collection navigation, card presentation and newsletter behavior remain unchanged.

Before release, verify all four collection previews against authoritative data,
including collections whose products occur beyond the old 500-product cap,
short/empty continuation pages, live stock/price/visibility changes and legacy
products. Compare database reads and function calls for equivalent page visits;
multiple small indexed subscriptions replace the single broad subscription.
Check total cost rather than assuming fewer returned rows guarantee savings.

Rollback the frontend before disabling catalog readers. Retain the additive
backend and authoritative source documents; no automatic legacy scan fallback
is included in either new page. StorePage's separate legacy reader remains
follow-up work; this change does not claim to remove that subscription.

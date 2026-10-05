# Store catalog rollout

Hold this frontend change until LouieMae production catalog version 5 has been
backfilled, verified in both directions and explicitly enabled. Deploying the
schema alone does not satisfy this gate. Convex service is currently disabled;
live parity, checkout and cost measurements remain pending restoration.

## Reader behavior

- Product grids read 25 compact catalog rows per requested page. Collection,
  hierarchical category matching and price/newest sorting happen on the server.
  Empty filtered pages retain an explicit continuation; Coming Soon appears only
  after exhaustion. The displayed count is loaded products, not an invented total.
- Newest now uses actual source creation order instead of opaque product-ID
  comparison. Price ties follow the backend's source-time/ID order.
- Category swimlanes fill four preview cards in source creation order. Category
  hero sliders fill eight with featured/new products first. The kids root retains
  its eight-card source-order preview. Short filtered pages continue until the
  preview is filled or exhausted; grids do not automatically scan all inventory.
- Category options union site configuration, the selected category and bounded
  legacy category-name pages. Names are deduplicated, all loaded options remain
  reachable, and a separate continuation button discovers later legacy names.
- Shop all explicitly opens the product grid, including when the category is All.
  Existing category redirects and hierarchical navigation remain supported.
- Cards use only display fields plus the full variant count. Selecting a card
  loads the existing full public detail endpoint by ID. Descriptions, complete
  variants, current prices/stock and cart selection rules remain on that endpoint.
- Preview and newsletter components have stable component identities so live
  parent updates do not remount their subscriptions or discard typed email input.

## Release checks

1. Restore production function availability and record the current catalog gate.
2. Complete current-version migration/verification as described in
   `CATALOG_READ_MODEL_ROLLOUT.md`; investigate every mismatch before enabling.
3. Rebase this PR onto the final release base, run types, lint, full regression
   tests, production build/client-secret scan and review the combined frontend.
4. In staging verify all four collections, configured parent/child categories,
   legacy categories, empty intermediate pages and inventory beyond 500 rows.
   Check all sort orders across page boundaries and live publication/removal.
5. Exercise product selection, all variants, stock changes, add to cart and
   checkout. Confirm no compact card is used as a complete cart/editing product.
6. Verify newsletters retain typed input through parent rerenders and still submit
   the appropriate category tag. Check mobile category scrolling and load buttons.
7. Deploy the exact reviewed revision. Compare calls, database bytes, latency and
   errors for equivalent navigation workloads, including sparse category previews.
   A bounded individual page does not guarantee a bounded total preview scan.

## Rollback

Redeploy the previous compatible frontend before disabling catalog readiness.
The legacy storefront endpoint remains available for an explicit rollback.
Never silently fall back to the large source subscription on readiness failure.
No source product data, order, payment or inventory contract is migrated here.

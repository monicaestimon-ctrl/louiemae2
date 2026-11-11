# Public search and product navigation rollout

This increment implements Phase 3 client navigation and the unified public search index. It does not complete Phase 6 server-rendered product HTML, HTTP status handling, sitemap or structured data. A client-rendered unavailable message is not an HTTP 404 implementation.

## Data and eligibility

`publicSearch` stores a source key, immutable public product ID and normalized public name/category text only. It does not index supplier SKU, costs, descriptions, freight evidence, commissions or trade prices. Supplier-SKU lookup remains internal. Descriptions are deliberately not searched.

Legacy product publication uses the same helper as public detail. Retail commerce listing names are indexed only while published in the retail channel. The query re-resolves each commerce candidate through `retailDetail`, including the current Zuo price/stock/evidence gates and Ashcroft availability/pricing authority. Published unavailable Ashcroft listings may remain discoverable with an unavailable label. Zuo records rejected by the current eligibility authority are omitted. Legacy preview products are labeled as previews and do not gain checkout eligibility through search.

Each response evaluates at most 20 indexed candidates and returns a small explicit public card. The SDK's cursor and `isDone` are retained even when eligibility filtering removes every result from a page. The UI keeps Load more available in that case. Public names/categories are bounded, images have bounded URLs, and price must be finite and nonnegative. No client-side full-catalog scan is used.

Transactional product and commerce-listing triggers synchronize relevant text/publication changes. The typed writer checker includes commerce listings, including Zuo publish, unpublish and rollback. Price and stock are rechecked when reading a card; current pricing does not depend on copying prices into the text index.

## Backfill and cutover

Production Convex is currently disabled by the owner's billing/usage limits. No production backfill or activation was performed during implementation. Local fixtures do not establish live index completeness.

After service restoration and deployment of this schema/code:

1. Run internal `publicSearchMigration:begin` with `{}`. It disables the new reader and starts a fresh pass.
2. Call internal `publicSearchMigration:step` with the returned `phase` as `expectedPhase` and `cursor` as `expectedCursor`. Process one response before the next call. Each call reads at most five source/index rows, with a source pagination byte budget.
3. Continue through `legacy`, `listings`, `orphans`, `verifyLegacy`, `verifyListings`, and `verifyIndex`. A retried old phase/cursor returns `advanced:false`; use the current returned state. Never assume a batch succeeded when a request failed.
4. Stop on `failed`. Inspect `mismatchIds`, correct the underlying data/writer defect, and restart with `begin`. Do not bypass verification.
5. Only after `phase:"verified"`, run internal `publicSearchMigration:setEnabled` with `{"enabled":true}`. The server rejects an unverified cutover.
6. Verify public `publicSearch:status` reports `ready:true`. Search an eligible Ashcroft and Zuo product, an unavailable product, a held product and a private trade-only listing. Verify all public payloads, prices and URLs against current evidence. Check pagination beyond the first page.
7. Retain the source counts, verification state, timestamps and smoke evidence with the deployment commit.

These functions are internal operator operations, not anonymous endpoints. The client retains the existing legacy search until the new index is enabled and verified. That fallback is intentionally not full-catalog acceptance. Roll back the reader with `setEnabled({enabled:false})`; retain records for diagnosis. Run a new complete verification after a repair before re-enabling.

The normal Convex codegen command was blocked by the disabled account. Local API declaration entries were updated for the new modules and checked by TypeScript; rerun the normal generator after account restoration before production acceptance.

## Navigation and recovery

Product URLs use `/products/<immutable-public-id>` and optional `?variant=<id>`. Product renaming does not change the URL. Canonical metadata excludes variant and referral parameters. Existing collection referral links are converted to the product route while retaining ordinary URL query parameters. New retail referral destinations use the same product URL function.

The shared router handles both `popstate` and legacy `hashchange` navigation. Leaving a product for a collection returns to the root collection route. Search results are native anchors: keyboard activation works, while modified clicks retain native new-tab behavior. Selecting a search result records the search term on the originating history entry; Back restores that search. Variant changes replace the current product history entry. Invalid or unavailable linked variants do not silently select another purchasable variant.

Product detail queries remain authoritative and reactive. Loading, transport failure and confirmed absence have distinct states; failures provide manual retry without a stale purchase control. Checkout still reprices and verifies availability on the server. This work does not enable new suppliers or relax purchasing gates.

Search typing is debounced. Changed terms unmount old paginated results, keeping late results out of the current search. Pending subscriptions have a ten-second recovery state and a manual retry; no business command is retried. Search pagination failures stay within the search dialog.

## Validation

The tests cover bounded cursor traversal, stale/hidden rows, private-field exclusion, publication triggers, index corruption blocking cutover, current Ashcroft availability and current Zuo eligibility. UI tests cover timeout/retry, empty candidate pages, native links, invalid options and current cart selections.

`npm run test:product-navigation:browser` builds a fixture around the actual App and uses mocked queries with external connections and business commands blocked. It exercises keyboard search, explicit pagination, both supplier fixtures, selected-variant reload, canonical metadata, restored search on Back, collection navigation, legacy referral conversion, heading focus, axe and overflow at 320px, 844px landscape and 1440px. Run `npm run build` first. This is not live inventory, freight or payment verification, and not actual browser zoom or screen-reader acceptance.

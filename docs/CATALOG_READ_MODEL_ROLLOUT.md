# Catalog read-model rollout

The version-5 projection is maintained transactionally at product-writing entry
points. Source products remain authoritative for detail/edit/checkout operations.
Current clients still use their existing readers; this writer release does not
enable incomplete catalog lists or run any migration automatically.

Writer inventory and verification:

| Area | Integration | Regression evidence |
| --- | --- | --- |
| Product CRUD/import/variant changes | `products` mutation builder | create, edit, stale revision, delete, unauthorized edit |
| Inventory/sourcing helpers | `cjHelpers` mutation builders | out-of-stock hiding, review on restock, split boundaries |
| Durable sourcing | product-writing `cjSourcingJobs` entry points | job admission and retry projections |
| CJ pricing | `cjPricingReview` mutation builders | every variant repriced, locks/live prices preserved, stale quotes, worker leases, bounded monitoring |
| Image caching | `productImageRecords` mutation builder | cached images reflected without private description images |
| Source recovery | `productSources.attachRecovered` | revision parity and evidence privacy |
| Shared publication | `commerce.publish/unpublish` | unpublishing hides the source and projection together |
| Legacy migration tools | `productMigrations` mutation builder | category assignments remain in sync |

`npm run verify:catalog-writers` follows typed writes through helper calls to
mutation entry points and currently verifies 58 entries. It is part of CI. The
initial inventory also manually reviewed untyped writes in batch/lifecycle tools;
those target their own records, not products. Avoid introducing untyped product
writes that bypass this structural check. Changes made directly in the Convex
dashboard bypass application builders and require bounded reconciliation.

Projection contracts are deliberately distinct from full product documents:
`publicData` contains a description excerpt with an explicit truncation flag;
`adminData` holds only additional private row fields, without duplicating public
fields. Detail/editor callers must read `products.getAdmin` before saving. A test
with an 800,000-character description produces a projection under 15,000 serialized
characters while retaining the full authoritative description. This is fixture
evidence, not a measurement of billed production I/O.

Telemetry-only changes whose projected values are identical skip projection
lookups/writes. Actual price, stock, visibility and listed variant changes commit
with the source; a failed mutation rolls both back.

Activation order remains mandatory:

1. Deploy all writer integrations and verify their checks.
2. Restore backend availability and capture a representative baseline.
3. Run `catalogMigration.backfill` in operator-driven batches of at most five,
   passing its current cursor as `expectedCursor`. The versioned state records
   completion and tolerates repeated/stale requests.
4. Run both bounded verification passes across every page: source parity and
   orphan detection. Repair any drift before cutover; a completed backfill alone
   is not a reader-readiness flag.
5. Deploy paginated endpoints with explicit readiness/coverage gates, then
   update clients and authoritative detail loading. Verify more than 500 products,
   filters, authorization, concurrent updates, checkout and editing.
6. Measure total reads plus maintenance writes under the same active workload.
   Do not interpret disabled-account inactivity as savings.

Rollback before reader cutover may restore prior writer code while retaining the
additive schema. Any rollback that stops maintenance invalidates summary readiness;
rebuild and verify before later activation. No table deletion is required.

## Reader preparation and readiness controls

`catalog.storefrontPage` and `catalog.adminPage` are additive endpoints. Existing
screens continue using old contracts until the frontend cutover is verified.
Admin authorization precedes readiness checks. Public pages use only visible
rows and the public allowlist; they never return the private half of a summary.
Both endpoints reject requests before explicit readiness activation.

Pages preserve Convex continuation/end cursors and split metadata. They request
at most 50 rows and a 500,000-byte read budget. Convex 1.31.7 includes the budget
fields in its exported validator and deployed pagination implementation while
omitting them from its stripped `PaginationOptions` interface; the shared helper
derives its contract from that validator. Integration checks against a restored
deployment must confirm runtime behavior and page-split handling before cutover.
These are read budgets, not a guarantee about serialized response size or billing.

Collection and public visibility use indexes. Additional category, substring
search and admin sourcing filters apply to each bounded page. An empty page can
still have `isDone: false`; a consumer must preserve its cursor and allow continued
loading, never treat that empty page as the end. The existing `search` argument
covers bounded projection text. The separate admin search contract below covers
the complete legacy inventory search fields.

After backfill completion, run `catalogReadiness.begin`, then repeatedly call
`verifyNext` with the returned phase and cursor. Each transaction checks at most
five sources or orphan candidates. Stale cursor/phase retries cannot advance an
extra page. A mismatch changes the phase to `failed`, records affected product
IDs and keeps readers disabled. Repair one to five distinct IDs with `repair`,
then restart both verification passes. Repair handles deleted-source orphans.

Only after phase `verified`, index readiness, representative preview checks and
operator review may `setEnabled({ enabled: true })` activate the new endpoints.
Backfill completion alone cannot activate them. `setEnabled({ enabled: false })`
is the immediate reader stop control. Starting verification or repairing data
also disables readers. Roll the frontend back before disabling readers used by
that frontend; no automatic full-table fallback exists.

## Version 4 filter and preview contracts

Version 4 adds indexed price, featured priority, connection state and arrival
ordering. New schema fields are optional for deployment compatibility, but v3
verification cannot activate v4 readers: rerun the current-version backfill and
both verification passes before enabling any prepared frontend.

`storefrontPage.sort` supports price ascending/descending, source creation newest
first and featured (`isNew` first, then source creation ascending). Omitting sort
preserves the existing order argument. A future storefront adoption of `newest`
will replace its opaque-ID comparison with actual creation order. Price ties use
source creation and product ID in the selected direction.

The serializable category filter preserves configured descendant matching,
explicit valid category-ID precedence, and legacy category/subcategory fallback.
Construct it from the requested collection's configuration. Do not reuse one
collection's category hierarchy for another collection.

`adminPage.adminSearch` preserves the full inventory search concatenation,
including complete descriptions and every variant mapping field. Up to 16,000
characters are stored inline. Larger searchable text is not duplicated: only an
explicit search reads those exceptional authoritative products, at most five
source documents per page. The summary pagination budget does not include these
additional source reads. Ordinary list pages never load these full documents.
Search remains cursor-based, including empty filtered pages, and does not expose
private search text to public callers. Source reads are reactive dependencies.

`arrivalsPage` separates dated arrivals from legacy `isNew` products without a
publication date. Dated arrivals use a strict publication timestamp greater than
the supplied cutoff, newest first; invalid nonempty dates are excluded. Consumers
fill their dated preview first, then legacy rows only after exhausting dated
results, and keep the cutoff fixed for the pagination session.

Public summaries include full image and variant counts; admin summaries also
include full variant-image counts and launch-added timestamps. Capped display
arrays and description excerpts remain unsuitable for full-product editing.
Existing deployed client readers are unchanged by these additive endpoints.

## Version 5 content-picker and collection-drop contracts

`adminOptionsPage` returns only product IDs and names for content-editor pickers,
including hidden inventory. It supports bounded name filtering and preserves
empty-page continuation. `adminOption` pins the existing selection even when it
is outside the loaded page; invalid or deleted IDs return null. Both require
admin authorization and verified current-version readiness, and read summaries
without fetching authoritative product bodies.

`categoryOptionsPage` exposes public legacy category names in bounded collection
pages, including names absent from site configuration. A future storefront picker
must union configured categories with loaded names, deduplicate across pages and
offer explicit continuation until exhaustion. Do not silently treat the first
page as a complete category list or auto-scan the entire collection on mount.

`dropPage` uses a collection/publication index for the New Collection preview.
Valid publication dates sort newest first with source-creation ties; undated
products prioritize `isNew` before source creation. Invalid dates are treated
as undated for deterministic ordering instead of the old NaN comparator. Source
publication values are not rewritten. Verify invalid-date inventory explicitly
before frontend adoption. This differs from storefront featured order and from
the thirty-day arrivals window, so those contracts remain separate.

Version 5 adds a drop tie-priority field. Fresh current-version backfill and
both verification passes are required before activation; v4 verification is
insufficient. Existing clients remain unchanged by this backend-only release.

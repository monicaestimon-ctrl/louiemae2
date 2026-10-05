# Catalog read-model rollout

The version-2 projection is maintained transactionally at product-writing entry
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
mutation entry points and currently verifies 50 entries. It is part of CI. The
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

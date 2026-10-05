# Compact variant queue rollout

Catalog version 3 adds a bounded, admin-only `catalog.variantQueuePage` reader. It
uses the existing transactional product projection and catalog backfill/parity
verification. Production clients still use the legacy queue until a separate
frontend cutover is verified.

## Behavior contract

- Include exactly the legacy CJ footprint; sourcing state alone does not qualify.
- Order attention before ready, then most unmapped customer options first, then
  source creation time and ID. Pagination reaches products beyond the legacy 500.
- Preserve all seven queue filters and case-insensitive substring searches within
  each individual name, source URL, CJ product ID, customer option name/mapping,
  and supplier option name/mapping. Search includes every option, without the
  public list's 100-option cap. Search fields are private and never returned.
- Return display/status/count metadata only. Fetch `products.getAdminVariantDetail`
  for an opened workspace; its authoritative revision, complete options, source
  evidence and supplier content are required for editing and saving.
- Preserve pagination metadata, including an empty filtered page whose cursor
  must still be followed. Loaded page counts must never be labeled global totals.

## Deployment and activation

1. Deploy the optional schema fields/index and version-3 projection together.
   Existing version-2 rows remain schema-valid. Existing full-product readers
   retain their contracts. The new reader fails closed until v3 is verified.
2. Once the production service is available, run the existing bounded catalog
   backfill for the current version. Budget source reads before starting. Live
   product mutations maintain the new fields transactionally.
3. Complete source and orphan verification for v3; repair any reported IDs and
   repeat verification before explicitly enabling the current catalog version.
4. Verify queue ordering, every filter, rare option searches, hidden products,
   source deletion, and products beyond 500 against authoritative records.
5. Deploy the frontend separately: paginated cards, explicit continuation,
   selected detail loading, off-page target support, preserved dirty drafts and
   conflict handling. Any count shown must have an accurate scope.
6. Compare database bytes and query executions for the same queue workflows.
   The projection still stores complete searchable option identifiers; this
   change alone makes no guaranteed invoice or percentage-reduction claim.

Rollback the frontend reader independently if needed. Do not delete source
products, reset source revisions, or discard dirty drafts during rollback.
The version-3 migration and activation have not run in production.

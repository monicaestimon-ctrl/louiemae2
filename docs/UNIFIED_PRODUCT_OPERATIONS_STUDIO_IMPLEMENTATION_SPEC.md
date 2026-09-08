# Louie Mae Unified Product Operations Studio

## Implementation Specification

**Status:** Proposed  
**Audience:** Product, design, engineering, QA, and operations  
**Audit basis:** Production main branch at commit ef3bd4f, reviewed September 8, 2026  
**Scope:** Import Product, Add Product, Edit Product, CJ Settings, product variants, and CJ variant mapping  
**Primary outcome:** One cohesive product workspace for creating, importing, editing, categorizing, pricing, mapping, validating, and publishing products

---

## 1. Executive Summary

Louie Mae currently has two product studios and a separate CJ mapping tool:

1. **Import Product** uses ProductImport, a large batch-oriented curation workflow with strong image, variant, AI, translation, and review capabilities.
2. **Add Product** uses ProductStudio, a visually and behaviorally different four-step modal.
3. **Edit Product** reuses the Add Product modal, so existing products do not receive the richer Import Product workflow.
4. **CJ Settings** embeds CJVariantManager, a separate mapper that can link, unlink, or remove existing customer variants but cannot properly edit or create them.

This split is structural, not merely cosmetic. The workflows use different components, different draft models, different validation logic, different persistence paths, and different representations of variants. As a result:

- A product has different editing capabilities depending on how the administrator reached it.
- Import-time curation cannot be reused when editing a saved product.
- Product changes may be silently dropped by a frontend field allowlist.
- CJ mapping problems send the administrator to a list that may not contain the affected product.
- A missing, incorrect, or mislabeled customer variant cannot be fixed in place from CJ Settings.
- Variant mapping is saved one link at a time instead of as one validated product-level transaction.
- Provider re-sourcing and ordinary catalog edits are too tightly coupled.

The recommended solution is a single **Product Operations Studio** built around one canonical product draft and one server-owned save contract. Import, add, edit, and CJ resolution become entry modes into the same workspace rather than separate editors.

The existing Import Product experience should be the visual and interaction baseline because it already contains the more complete curation workflow. Its batch navigation should be preserved, while its editor internals are extracted into reusable panels that also handle manual creation, saved-product editing, and CJ mapping.

---

## 2. Goals

The implementation must:

- Give Import, Add, and Edit the same product fields, controls, validation, terminology, and visual system.
- Let an administrator open any product from CJ Settings and immediately fix its customer variants and CJ mappings.
- Let an administrator add, rename, reorder, activate, deactivate, or remove a customer variant without leaving the mapping workflow.
- Let an administrator create a customer variant directly from a CJ-returned variant and map it in one action.
- Show storefront variants and CJ-returned variants side by side.
- Save variant edits and mappings atomically.
- Include products with missing CJ variants, missing customer variants, and incomplete sourcing data in an actionable work queue.
- Preserve stable variant IDs and mappings through label edits.
- Recalculate CJ fulfillment readiness immediately after a successful save.
- Prevent invalid mappings on the server, not only in the browser.
- Keep normal product edits separate from explicit re-sourcing operations.
- Preserve the existing batch-import workflow and its AI, translation, image, category, and pricing features.
- Continue enforcing unique product names and multi-subcategory assignment through the unified save path.
- Add recovery, conflict handling, audit history, and production observability.

---

## 3. Non-Goals

This project will not:

- Redesign the customer-facing storefront.
- Change CJ's provider API or provider-side catalog data.
- Automatically publish products merely because mapping becomes complete.
- Automatically accept uncertain variant matches.
- Delete historical products, sourcing jobs, mappings, or audits.
- Replace the existing unique-name system or product taxonomy; it will integrate them into the shared editor.
- Make low-confidence AI decisions without administrator confirmation.

---

## 4. Current Production Architecture

### 4.1 Entry points

The admin page currently routes product work through separate component trees:

| Administrator action | Component | Data shape | Save path |
|---|---|---|---|
| Import product | ProductImport | ImportableProduct | products.createBatch |
| Add product | ProductStudio | Partial Product | products.create |
| Edit product | ProductStudio | Partial Product | products.update |
| Resolve CJ variants | CJSettings → CJVariantManager | Product plus embedded variants | link, unlink, or remove one mapping at a time |

AdminPage maintains separate state for ProductImport and ProductStudio. Both Add Product buttons and every Edit button call the ProductStudio path. The Import tab renders ProductImport independently. CJ Settings receives only an optional target product ID.

### 4.2 Import Product

ProductImport is approximately 3,192 lines and provides the most complete product-curation experience:

- Search, URL import, and batch import.
- A batch queue and per-product navigation.
- Persisted local and session drafts.
- Image selection, upload, deletion, ordering, preview, and variant image assignment.
- Translation.
- Smart Name and Smart Description.
- Multi-subcategory selection.
- Variant selection, renaming, image mapping, and price overrides.
- Final preview and batch creation.
- Name uniqueness checks within the batch.
- Image caching before creation.
- Hidden-by-default sourcing behavior.

However, it is creation-only. It cannot load a persisted product by ID and commit a product update. It also owns its own ImportableProduct-to-Product transformation and validation logic.

### 4.3 Add and Edit Product

ProductStudio is approximately 1,459 lines and provides a dark, full-screen four-step modal:

1. Essence
2. Visuals
3. Story
4. Review

It supports manual creation, URL quick start, images, Smart Name, Smart Description, categories, pricing, status, source URL, and basic variant editing.

Its limitations are:

- It is visually and behaviorally different from ProductImport.
- It has a less capable variant editor.
- It displays CJ Variant and SKU values but does not allow mapping.
- It does not show provider variants beside customer variants.
- It does not provide the import workflow's richer image/variant tools.
- Create and edit share the same generic experience without edit-specific context, change tracking, or conflict protection.
- It duplicates URL-import and AI orchestration already present in ProductImport.
- Variant label or image changes may mark sourcing pending and hide a product, conflating catalog edits with an explicit provider re-sourcing decision.
- New variant IDs are generated in the browser from the current time rather than through a stable server-owned identity contract.

### 4.4 CJ Settings and CJ Variant Manager

CJ Settings is an operations page containing connection, diagnostics, sourcing, inventory, issue, and mapping sections. Its mapping section uses CJVariantManager.

CJVariantManager can:

- List approved products that have returned CJ variants.
- Expand a product.
- Link an existing customer variant to a CJ variant.
- Unlink an existing mapping.
- Remove an existing customer variant.
- Scroll toward a target product ID if that product exists in the returned list.

CJVariantManager cannot:

- Add a missing customer variant.
- Rename or relabel a customer variant.
- Edit a variant image, price adjustment, selling price, stock, or order.
- Create a customer variant from an unmatched CJ variant.
- Refresh missing CJ variants.
- Compare source, storefront, and CJ data in one row.
- Apply or review suggested matches.
- Resolve several mappings and save once.
- Open the complete product editor in the same context.
- Show mapping history or who changed a link.
- Detect a concurrent edit.

The current query only returns products where:

- cjSourcingStatus is approved; and
- cjVariants exists and has at least one item.

That means an approved product with customer variants but no returned CJ variants is excluded from the mapper. The health audit explicitly describes this state as “won't appear in Variant Mapping.” Pending, needs-input, and other incomplete states are also outside the manager even when an administrator could repair the product data.

### 4.5 Current production workload snapshot

The production read models reported:

| Measure | Current value |
|---|---:|
| Products visible in the existing variant mapper | 163 |
| Customer variants on those products | 1,896 |
| Mapped customer variants | 1,018 |
| Unmapped customer variants | 878 |
| CJ-returned variants on those products | 1,888 |
| Distinct CJ variants currently referenced by a mapping | 977 |
| Sourcing jobs marked mapping required | 68 |
| Sourcing jobs marked reconciliation required | 44 |
| Sourcing jobs marked fulfillment ready | 95 |
| Sourcing jobs marked needs input | 5 |

These figures are a point-in-time operational snapshot, not migration constants. They demonstrate that the mapping workflow must be designed for a substantial queue, bulk speed, and partial/inconsistent data.

---

## 5. Audit Findings

### P0-1: There is no canonical product editor or canonical product draft

Import Product and ProductStudio each own form state, transformation, validation, and save behavior. A saved product cannot simply be loaded into the richer import editor.

**Impact**

- Product capabilities depend on the route used.
- Fixes must be implemented twice.
- Data normalization can diverge.
- Preview and saved output can disagree.
- Future fields can work in one path and disappear in another.

**Required correction**

Create one ProductEditorDraft schema, one editor state machine, one validation engine, and one family of server mutations used by every entry mode.

### P0-2: The mapping query excludes products that most need intervention

getProductsWithCjVariants returns only approved products with a non-empty cjVariants array.

**Impact**

- A product with no CJ variants cannot be repaired from the variant mapper.
- A deep link from a risk item may open CJ Settings but fail to surface the target product.
- The administrator sees a general dashboard rather than the exact blocking record.

**Required correction**

Replace the query with a purpose-built mapping work queue that includes every CJ-relevant product and returns explicit reason codes.

### P0-3: Mapping mutations do not enforce mapping integrity

The current link mutation maps over customer variants and patches the array. It does not reject an unknown customer variant ID. It does not verify that the requested CJ variant belongs to the product's returned CJ variant set. It does not prevent duplicate use of a CJ variant on the server. These protections are currently incomplete or UI-only.

**Impact**

- Stale browser state can write an invalid link.
- Two customer variants can race to the same provider variant.
- A wrong provider variant ID can be attached to a product.
- A “successful” request can leave data unchanged if the customer variant ID was absent.

**Required correction**

Validate all mapping invariants in one authenticated, transactional mutation.

### P0-4: Variant editing and mapping are not atomic

Each mapping click writes immediately. Variant removal writes separately. Missing variant creation is not available.

**Impact**

- The product passes through partial intermediate states.
- An administrator cannot review the complete intended result before committing.
- Failures can leave half-finished mappings.
- Readiness can lag behind the actual work.

**Required correction**

Use a draft workspace and one Save Variant Workspace mutation that validates and commits the full set of customer variants and mappings together.

### P0-5: The frontend update allowlist silently drops supported Product fields

BlogContext.updateProduct uses a handwritten list of allowed fields before calling the server mutation. The Product type contains fields absent from that list, including audience, canonicalProductType, batchImportItemId, multiple inventory-review fields, confirmed pricing fields, source currency fields, raw source description data, and description images.

**Impact**

- A field can appear editable yet not persist.
- New backend fields require a second frontend change that can be missed.
- Create and edit produce different records.
- Silent omission makes failures hard to diagnose.

**Required correction**

Remove the client-side field allowlist. Define server-validated create and update inputs from a shared domain schema and return structured validation errors.

### P0-6: The mapper's product query lacks the admin authorization used by its mutations

getProductsWithCjVariants does not call the CJ admin authorization guard even though it returns operational product and provider-variant data.

**Impact**

- The public Convex function surface is broader than intended.
- Authorization behavior is inconsistent within one feature.

**Required correction**

Every product operations query, mutation, and action must require the appropriate administrator identity on the server.

### P1-1: Ordinary edits can trigger provider re-sourcing side effects

ProductStudio can mark sourcing pending and hide the product when certain variant details change.

**Impact**

- Correcting a storefront label can unexpectedly change product visibility.
- Administrators cannot predict whether Save means “update catalog” or “resubmit to CJ.”

**Required correction**

Separate catalog saves from explicit sourcing commands. A variant label, image, price, or order edit must not resubmit sourcing. “Refresh CJ variants” and “Resubmit for sourcing” must be named, confirmed operations.

### P1-2: Variant terminology assumes every option is a size

The mapping feature repeatedly describes customer variants as size variants, while products may vary by size, color, set, pack, style, or multiple dimensions.

**Required correction**

Use “Customer variant” and “CJ variant” consistently. Render option dimensions explicitly.

### P1-3: CJ Settings reports problems without offering the repair at the point of need

Risk screens route to CJ Settings with a product ID. CJ Settings passes that ID to a mapper near the bottom of a long operational page. If the query excludes the product, the target is not actionable.

**Required correction**

Make the first section of CJ Settings an actionable Product Resolution Queue. Deep links must open the exact product's quick-fix drawer even if the product would not match the current filter.

### P1-4: There is no source/storefront/provider comparison model

The current system stores customer variants and CJ variants in parallel embedded arrays, but the UI does not present them as a reconciled workspace.

**Required correction**

Display original/source option text, customer-facing label, and CJ-returned variant data together. Preserve provenance for each value.

### P1-5: Draft recovery differs by route

Import Product persists its own browser draft. ProductStudio does not share that model. Existing-product edits do not have recoverable server drafts or optimistic concurrency.

**Required correction**

Use one draft lifecycle for all modes, with local recovery and explicit conflict detection for saved products.

### P1-6: Mapping work is not optimized for a queue

The current manager is an expandable product list with per-row selectors.

**Required correction**

Add status filters, search, sort, next unresolved navigation, bulk suggestions, issue counts, keyboard controls, and an atomic save.

### P2-1: Oversized components make safe iteration difficult

ProductImport, ProductStudio, and CJSettings are each large components containing view, orchestration, transformation, and persistence behavior.

**Required correction**

Extract domain logic, state, panels, and operations into independently testable modules.

### P2-2: UI coverage is concentrated on import

There is a ProductImport component test, but no comparable ProductStudio, CJVariantManager, or CJSettings interaction test.

**Required correction**

Add component, integration, and end-to-end coverage across all entry modes.

---

## 6. Target Product Experience

### 6.1 One studio, multiple entry modes

Create ProductOperationsStudio with these modes:

| Mode | Entry point | Initial focus | Commit behavior |
|---|---|---|---|
| import-new | Import tab or URL/search result | Source and images | Create one or a batch |
| manual-new | Add Product | Product identity | Create one |
| edit-existing | Product list Edit | Last incomplete section or Overview | Update one |
| resolve-cj | CJ Settings, Risk Check, or Control Room | Variants and CJ Mapping | Atomic variant/mapping update |
| readiness-review | Product or launch queue | Readiness | Update and explicitly publish |

The mode changes the initial context and available commands. It must not change which product fields exist or how those fields are validated.

### 6.2 Design direction

Use the current Import Product Studio as the design baseline:

- Light, calm curation workspace.
- Clear product progress.
- Large image-led product context.
- Batch navigation when importing more than one product.
- Sticky save and validation controls.
- Consistent typography, spacing, buttons, and status colors.

Do not preserve two unrelated visual systems inside the admin.

### 6.3 Studio information architecture

The unified studio will contain:

1. **Source & Identity**
   - Source URL
   - Original supplier title
   - Translated source content
   - Customer-facing product name
   - Audience
   - Canonical product type
   - Name uniqueness status

2. **Images**
   - Source images
   - Uploaded images
   - Image order
   - Primary image
   - Variant image assignment
   - Description/reference images

3. **Story**
   - Product description
   - Smart Description
   - Translation
   - Description provenance and audit status

4. **Categories**
   - Collection
   - Multiple subcategories
   - Primary subcategory
   - Category suggestions
   - Audience/category consistency warning

5. **Variants & Pricing**
   - Customer variants
   - Option dimensions and labels
   - Images
   - Stock state
   - Cost and price adjustments
   - Selling price override
   - Sort order and active status

6. **CJ Mapping**
   - CJ product identity
   - Returned CJ variants
   - Suggested matches
   - Mapping conflicts
   - Inventory snapshot
   - Refresh and resourcing commands

7. **Readiness & Publish**
   - Catalog validation
   - Naming validation
   - Taxonomy validation
   - CJ fulfillment readiness
   - Pricing warnings
   - Storefront visibility
   - Explicit publish action

### 6.4 Layout

For desktop, use a three-region workspace:

- **Left rail:** Product image, name, source, issue summary, section navigation, batch position.
- **Center workspace:** Editable section content.
- **Right inspector:** Validation, provider data, preview, and change summary.

For the Variants & CJ Mapping section, the center workspace becomes a reconciliation grid:

| Source option | Customer variant | Mapping | CJ variant | Status |
|---|---|---|---|---|
| Supplier text/image | Editable label, image, price, stock | Connector and confidence | CJ name, SKU, VID, cost, image, inventory | Mapped, suggested, conflict, or missing |

On narrower screens, the three regions collapse into tabs or drawers without losing functionality.

### 6.5 Persistent action bar

The footer must always show:

- Save Draft
- Save Changes or Create Product
- Validation issue count
- Unsaved-change status
- Last saved time
- Cancel/Close
- Next unresolved product when launched from a queue

Provider operations such as Resubmit for Sourcing must be separate, clearly labeled actions.

---

## 7. CJ Settings: Product Resolution Queue

### 7.1 Replace the passive mapping list

The top actionable section of CJ Settings will be Product Resolution Queue.

Queue tabs:

- All issues
- Needs mapping
- Missing customer variants
- Unmatched CJ variants
- Missing CJ variants
- Label/name problems
- Pricing problems
- Inventory review
- Needs input
- Reconciliation required
- Ready

Each tab must display a count.

### 7.2 Product row

Each row must show:

- Product image
- Product name
- Collection and subcategories
- Storefront status
- CJ sourcing status
- Readiness status
- Customer variant mapped/total count
- CJ variant matched/total count
- Highest-priority reason
- Last updated time
- Quick Fix
- Full Edit
- Refresh CJ Data when applicable

Rows must be searchable by product name, supplier title, product ID, CJ product ID, SKU, VID, and source URL.

### 7.3 Deep-link behavior

When CJ Settings receives a product ID:

1. Load that product independently of the active filter.
2. Pin it at the top of the queue.
3. Open Quick Fix automatically.
4. Focus the first blocking issue.
5. Show a clear not-found or no-longer-actionable message if the record is unavailable.

The product must not disappear merely because it has no CJ variants.

### 7.4 Quick Fix drawer

Quick Fix uses the same ProductOperationsStudio state and VariantWorkbench components, rendered in a focused drawer.

It must allow:

- Add customer variant.
- Create customer variant from CJ variant.
- Rename customer variant.
- Edit option dimensions.
- Edit image.
- Edit price adjustment or selling price override.
- Toggle active/in-stock state.
- Reorder variants.
- Map, remap, or unlink.
- Remove a variant with impact confirmation.
- Apply high-confidence suggested mappings.
- Save all changes once.
- Continue to next unresolved product.
- Expand to Full Edit without losing draft changes.

### 7.5 Create customer variant from CJ

For each unmatched CJ variant, provide “Create customer variant.”

The new customer variant should be prefilled with:

- A stable server-issued ID.
- A customer-safe label derived from CJ option dimensions.
- CJ image when usable.
- CJ VID and SKU mapping.
- Current inventory status.
- Pricing metadata when available.
- Provenance indicating it was created from CJ.

The administrator must be able to edit the label before saving.

### 7.6 Missing CJ variants

If no CJ variants were returned:

- Keep the product visible.
- Explain whether the likely cause is provider data, sourcing state, missing CJ product ID, stale synchronization, or unsupported product.
- Offer Refresh CJ Variants when a CJ product ID exists.
- Offer Resubmit for Sourcing only when appropriate.
- Offer Edit Product Data when missing source/customer fields are the blocker.
- Do not display an empty mapper as if no work is required.

---

## 8. Canonical Domain Model

### 8.1 ProductEditorDraft

Define one shared ProductEditorDraft schema containing:

- draftId
- mode
- productId when editing
- expectedRevision when editing
- source identity and source snapshots
- customer-facing identity
- name claim state
- description content and provenance
- images and ordering
- taxonomy selection
- audience and canonical product type
- pricing
- storefront state
- customer variants
- CJ product snapshot
- CJ provider variants
- proposed mappings
- readiness result
- validation result
- dirty fields
- draft timestamps

Both ProductImport and ProductStudio adapters must be temporary migration tools only. The final UI should edit ProductEditorDraft directly.

### 8.2 Customer variant model

Each customer variant needs:

- id: stable and immutable
- label: customer-facing text
- normalizedLabel: derived for search and matching
- optionDimensions: array of dimension/value pairs
- image
- sortOrder
- active
- inStock
- priceAdjustment
- sellingPriceOverride
- sourceVariantId, when known
- sourceLabel, when known
- mapping: optional mapping metadata
- createdAt
- updatedAt

Changing a label must not change the variant ID.

### 8.3 CJ provider variant snapshot

Each returned CJ variant needs:

- cjVariantId / VID
- cjSku
- cjProductId
- rawName
- normalized option dimensions
- image
- provider price/cost
- provider inventory
- active/available state
- payload version or hash
- fetchedAt

Provider fields are read-only in the customer-variant editor.

### 8.4 Mapping model

A mapping must record:

- productId
- customerVariantId
- cjVariantId
- cjSku
- method: manual, suggested-confirmed, import-derived, or migrated
- confidence when suggested
- matched signals
- mappedAt
- mappedBy
- lastValidatedAt
- status

Recommended target architecture: store mappings as first-class records or as validated product subdocuments with an accompanying immutable audit event. Do not rely only on two optional strings embedded in a mutable customer-variant object.

### 8.5 Product revision

Add a monotonically increasing product revision.

Every product update must provide expectedRevision. If the persisted revision changed:

- Reject the save with a conflict result.
- Show which sections changed.
- Allow the administrator to reload, compare, and reapply changes.
- Never silently overwrite another administrator or background CJ synchronization.

---

## 9. Variant Matching Rules

### 9.1 Matching priority

Suggestions should use deterministic signals in this order:

1. Existing exact CJ VID.
2. Existing exact CJ SKU.
3. Exact known source variant ID.
4. Exact normalized option dimensions.
5. Exact normalized label after approved alias mapping.
6. Strong multi-signal match using label, image, and price.
7. Image or price alone only as supporting evidence, never as an automatic match.

### 9.2 Normalization

Normalize:

- Whitespace, punctuation, case, and Unicode width.
- Common size forms such as 2T versus 2 T.
- Unit formats such as cm, months, and years.
- Color synonyms only from a reviewed alias dictionary.
- Dimension ordering, such as Color/Size versus Size/Color.

Do not erase meaningful differences such as:

- 2T versus 24M unless a reviewed rule explicitly permits it.
- Beige versus cream without administrator confirmation.
- Single item versus set.
- Left/right, pattern, bundle, or pack differences.

### 9.3 Confidence bands

- **0.95–1.00:** Strong recommendation; eligible for Apply Recommended.
- **0.75–0.94:** Show as a suggestion requiring individual review.
- **Below 0.75:** Do not preselect.
- **Conflict:** Never preselect, regardless of numeric score.

The administrator must see why a suggestion was made.

### 9.4 Assignment invariants

Unless an explicit future provider rule allows otherwise:

- One active customer variant maps to at most one active CJ variant.
- One active CJ variant maps to at most one active customer variant for the same product.
- A CJ variant must belong to the product's current CJ snapshot.
- A mapped CJ SKU and VID must refer to the same provider record.

---

## 10. Validation and Readiness

### 10.1 Validation layers

Run validation at three levels:

1. **Field validation:** required values, numeric constraints, URLs, IDs.
2. **Product validation:** unique product name, categories, images, pricing, variants, audience/product-type consistency.
3. **Fulfillment validation:** CJ identity, mapping completeness, inventory state, and reconciliation.

### 10.2 Blocking rules

Creating or saving a draft may allow warnings. Publishing or marking fulfillment-ready must be blocked when:

- The product name is not uniquely claimed.
- No collection is selected.
- No subcategory is selected.
- There is no primary subcategory.
- Required images are missing.
- Two active customer variants have the same normalized option identity.
- A mapping references a missing customer or CJ variant.
- One CJ variant is mapped more than once.
- Required CJ variants are unmapped.
- Pricing is invalid or missing where required.

### 10.3 Audience-aware validation

The existing AI naming and category behavior must remain integrated:

- Boys products must not receive feminine-coded suggestions merely because similar products were named that way.
- Girls, boys, unisex, adult, home, and unknown remain explicit values.
- Boys romper-type products must use the approved customer-facing “onesie” terminology.
- Multiple subcategories remain selectable.
- Category suggestions must never overwrite administrator selections without confirmation.

### 10.4 Readiness recomputation

The server must recompute and persist CJ readiness in the same transaction as a variant/mapping save.

Return:

- readiness state
- blocking reason codes
- warning reason codes
- mapped/required counts
- recommended next action

The queue should update immediately from this result.

---

## 11. Save and Draft Behavior

### 11.1 Draft lifecycle

Use this state machine:

loaded → dirty → validating → ready-to-save → saving → saved

Error branches:

- validation-error
- save-error
- revision-conflict
- provider-refresh-error

### 11.2 Draft persistence

For new imports:

- Continue local recovery for unsaved source results.
- Create a server draft once a product enters curation.
- Preserve batch ordering and selection.

For saved products:

- Never write partial product changes on every field edit.
- Store a recoverable editor draft scoped to administrator and product.
- Commit only when Save Changes is selected.
- Expire abandoned drafts using a documented retention period.

### 11.3 Atomic save

A single save must commit:

- Product fields changed by the administrator.
- Customer variant additions, edits, removals, and ordering.
- CJ mappings.
- Name-claim transitions when the name changes.
- Readiness state.
- Audit events.
- Product revision increment.

If any blocking invariant fails, commit nothing.

### 11.4 Explicit external operations

The following must remain separate from Save:

- Submit or resubmit for CJ sourcing.
- Refresh CJ product/variant data.
- Refresh inventory.
- Publish or unpublish.
- Delete product.

Each operation needs clear confirmation, authorization, idempotency, and an audit event.

---

## 12. Backend Contract

Names below are proposed and can be adjusted to repository conventions.

### 12.1 Queries

**productStudio.getWorkspace**

Inputs:

- productId, optional
- draftId, optional
- mode

Returns:

- ProductEditorDraft
- latest product revision
- validation/readiness
- allowed operations

**productStudio.listResolutionQueue**

Inputs:

- status filters
- search
- sort
- cursor
- limit

Returns:

- paginated product issue summaries
- counts by issue class
- reason codes

This query must include products with no CJ variants.

**productStudio.getCjMappingWorkspace**

Inputs:

- productId

Returns:

- product summary
- editable customer variants
- CJ snapshot
- current mappings
- suggestions
- validation/readiness

### 12.2 Mutations

**productStudio.createProduct**

- Accept canonical draft input.
- Claim the unique name.
- Validate taxonomy and variants.
- Create the product and initial audit events.
- Return ID, revision, validation, and next action.

**productStudio.updateProduct**

- Accept productId, expectedRevision, and a typed patch.
- Validate only server-approved fields.
- Coordinate name-claim transitions.
- Return the new revision and readiness.

**productStudio.saveVariantWorkspace**

- Accept productId, expectedRevision, complete proposed customer variants, and proposed mappings.
- Validate all IDs and mapping relationships.
- Commit variants, mappings, readiness, revision, and audit events atomically.

**productStudio.createCustomerVariantFromCj**

- Prefer implementing this as a local draft command.
- If a server-issued ID is required before save, make it idempotent and draft-scoped.

**productStudio.applySuggestedMappings**

- Revalidate suggestions against the latest provider snapshot and product revision.
- Never accept a stale or conflicting suggestion.

### 12.3 Actions

**productStudio.refreshCjVariants**

- Require administrator authorization.
- Fetch the provider product.
- Normalize and persist a versioned CJ snapshot.
- Revalidate mappings.
- Flag missing-provider and changed-provider conflicts.
- Never silently delete customer variants.

**productStudio.importSource**

- Consolidate URL scrape, translation, image normalization, and source snapshot creation.
- Return the canonical draft shape used by every studio mode.

### 12.4 Error contract

Return structured errors with:

- code
- field or entity path
- user-safe message
- recoverable flag
- current revision when conflicting
- recommended action

Do not rely on string matching in the UI.

---

## 13. Component and File Plan

### 13.1 New shared product-studio modules

Create:

- components/product-studio/ProductOperationsStudio.tsx
- components/product-studio/ProductStudioShell.tsx
- components/product-studio/ProductEditorProvider.tsx
- components/product-studio/ProductStudioActionBar.tsx
- components/product-studio/ProductIssueSummary.tsx
- components/product-studio/BatchProductNavigator.tsx
- components/product-studio/panels/SourceIdentityPanel.tsx
- components/product-studio/panels/MediaPanel.tsx
- components/product-studio/panels/StoryPanel.tsx
- components/product-studio/panels/TaxonomyPanel.tsx
- components/product-studio/panels/VariantWorkbench.tsx
- components/product-studio/panels/CjMappingPanel.tsx
- components/product-studio/panels/ReadinessPanel.tsx
- components/product-studio/cj/ProductResolutionQueue.tsx
- components/product-studio/cj/VariantReconciliationGrid.tsx
- components/product-studio/cj/CjVariantInspector.tsx
- components/product-studio/cj/MappingSuggestion.tsx
- components/product-studio/cj/QuickFixDrawer.tsx

### 13.2 Shared domain modules

Create:

- lib/productEditorDraft.ts
- lib/productEditorValidation.ts
- lib/productEditorAdapters.ts
- lib/productReadiness.ts
- lib/variantIdentity.ts
- lib/variantMatching.ts
- lib/variantMappingValidation.ts

The existing productCategories, productNames, smartDescription, pricing, and CJ readiness modules should be consumed rather than duplicated.

### 13.3 Backend modules

Create or extract:

- convex/productStudio.ts
- convex/productVariantMappings.ts
- convex/productEditDrafts.ts
- convex/productOperationAudits.ts

If the first delivery slice retains embedded mappings, keep the API boundary above so storage can be normalized later without another UI rewrite.

### 13.4 Existing components to migrate

**AdminPage**

- Replace separate modal and import editor routing with one studio launcher.
- Pass mode and context rather than different callbacks and partial models.
- Let CJ deep links launch the focused mapping mode.

**ProductImport**

- Retain search, URL acquisition, and batch queue.
- Replace its review/editor internals with ProductOperationsStudio panels.
- Remove duplicate Product transformation and validation after parity is reached.

**ProductStudio**

- Route Add and Edit to ProductOperationsStudio.
- Retire after feature-flag rollout and parity verification.

**CJSettings**

- Put ProductResolutionQueue near the top.
- Mount QuickFixDrawer using the shared editor.
- Keep connection/automation settings as a separate operational section.

**CJVariantManager**

- Replace with VariantReconciliationGrid and shared draft/save behavior.
- Retire one-click immediate-write mapping mutations after migration.

**BlogContext**

- Remove the handwritten product-update allowlist.
- Use typed product-studio commands.

---

## 14. Migration Strategy

### Phase 0: Safety and measurement

- Add admin authorization to the existing mapper query.
- Add server validation to current link/unlink/remove mutations.
- Add telemetry for queue size, mapping failures, and time to resolve.
- Add an inclusive mapping work-queue query.
- Capture baseline readiness and mapping metrics.
- Do not change the existing UI yet.

### Phase 1: Canonical draft and shared validation

- Define ProductEditorDraft.
- Build Product-to-Draft and ImportableProduct-to-Draft adapters.
- Centralize product, taxonomy, name, pricing, variant, and readiness validation.
- Create revision-aware save contracts.
- Add audit events.

### Phase 2: Unified Add and Edit

- Build ProductOperationsStudio shell and panels.
- Launch manual-new and edit-existing from AdminPage.
- Ensure both modes expose the same controls.
- Preserve existing imported and manually created product data.
- Keep old ProductStudio behind a rollback flag temporarily.

### Phase 3: Unified Import

- Retain import acquisition and batch navigation.
- Replace ProductImport review and final-review editors with the shared studio panels.
- Move create transformation to the server contract.
- Verify batch creation, image caching, naming, translation, descriptions, categories, variants, and price parity.

### Phase 4: CJ Resolution Queue and Quick Fix

- Deploy the inclusive work queue.
- Add quick-fix drawer.
- Add side-by-side reconciliation grid.
- Add customer variant creation and full editing.
- Add deterministic suggestions.
- Add atomic variant/mapping save.
- Deep-link Risk Check and Control Room directly into the target product.

### Phase 5: Retire duplication

- Remove obsolete editor sections from ProductImport.
- Remove ProductStudio.
- Remove CJVariantManager and immediate per-link write paths.
- Remove BlogContext product update allowlist.
- Remove temporary adapters after all callers use ProductEditorDraft.

### Phase 6: Storage normalization, if not completed earlier

- Backfill first-class mapping records and audit metadata.
- Verify every embedded legacy mapping.
- Dual-read during validation.
- Switch reads to normalized mappings.
- Stop legacy writes.
- Remove compatibility fields only in a separately approved migration.

---

## 15. Backfill and Data Migration

### 15.1 Preflight report

Before writing data, generate a report of:

- Products with duplicate customer variant IDs.
- Products with duplicate normalized customer variant identities.
- CJ variants referenced more than once.
- Mappings whose CJ variant is absent from the product snapshot.
- Mappings with SKU/VID disagreement.
- Approved products with no CJ product ID.
- Approved products with no CJ variants.
- Products with no customer variants but multiple CJ variants.
- Products with unmapped customer variants.
- Products whose fields differ between canonical Product and current editor allowlist support.

### 15.2 Backfill rules

- Preserve every existing customer variant ID.
- Preserve valid current mappings and mark method as migrated.
- Do not guess invalid or ambiguous mappings.
- Mark ambiguous records reconciliation-required.
- Store old values in an audit payload.
- Make the migration idempotent.
- Support dry-run and resumable batches.

### 15.3 Verification

After backfill:

- Record counts must reconcile.
- No valid mapping may be lost.
- Every invalid mapping must have a reason code.
- Readiness must be recomputed.
- A sample of girls, boys, unisex, home, single-variant, and multi-dimensional products must be manually verified.

---

## 16. Detailed Interaction Requirements

### 16.1 Add Product

1. Administrator selects Add Product.
2. Unified studio opens in manual-new mode.
3. No unrelated default collection is silently selected.
4. Administrator may enter a source URL or begin manually.
5. The same Images, Story, Categories, Variants, CJ Mapping, and Readiness panels are available as in every other mode.
6. Save creates one canonical product record.

### 16.2 Import Product

1. Administrator searches or enters a URL.
2. Selected products enter a batch.
3. Each batch item opens in the unified studio.
4. Existing translation, Smart Name, Smart Description, images, categories, variants, and pricing controls remain available.
5. Batch navigation preserves completion state.
6. Final review uses the same validation engine as Add and Edit.
7. Batch save creates all valid products and clearly isolates any invalid item.

### 16.3 Edit Product

1. Administrator selects Edit from a product row.
2. The exact saved product loads into the unified studio.
3. The studio shows current readiness, source, provider state, and last saved revision.
4. The administrator can use every control available during import.
5. Save updates only intended fields through the canonical server contract.
6. A catalog-only edit does not resubmit sourcing or hide the product.

### 16.4 Fix a missing variant from CJ Settings

1. Queue shows “Missing customer variant.”
2. Administrator selects Quick Fix.
3. Unmatched CJ variants appear on the provider side.
4. Administrator selects Create customer variant on the correct CJ row.
5. A draft customer variant is prefilled and mapped.
6. Administrator edits its customer-facing label and price if needed.
7. Save validates and commits the variant and mapping atomically.
8. Readiness recalculates.
9. The queue removes or reclassifies the product.
10. Next unresolved product is offered.

### 16.5 Correct an existing variant label

1. Administrator opens Quick Fix or Full Edit.
2. Administrator changes only the customer-facing label.
3. Stable customer variant ID and CJ mapping remain intact.
4. Save records the label change and revision.
5. No sourcing resubmission occurs.

### 16.6 Remap an incorrect link

1. Administrator selects the currently mapped row.
2. The UI displays the old provider variant and its audit information.
3. Administrator chooses a different CJ variant.
4. Duplicate/conflicting assignments are blocked.
5. One save replaces the mapping and recalculates readiness.

---

## 17. Accessibility and Speed

The workbench must:

- Be fully keyboard navigable.
- Use visible focus states.
- Provide labels for icon-only controls.
- Not communicate mapping state by color alone.
- Preserve focus after saves and queue transitions.
- Announce validation and save results to assistive technology.
- Support Escape to close a non-dirty drawer.
- Warn before closing a dirty draft.

Recommended keyboard shortcuts:

- Command/Ctrl + S: save.
- J/K: next/previous unresolved product when focus is outside a form field.
- M: focus mapping selector for the active row.
- A: add customer variant.
- Shift + Enter: accept focused high-confidence suggestion.

Shortcuts must be documented in the UI and must not override text-entry behavior.

---

## 18. Security and Audit Requirements

- Require administrator identity on every product operations query, mutation, and action.
- Validate authorization on the server even when the route is admin-only.
- Never expose provider credentials or raw secret-bearing payloads to the client.
- Redact secrets from error messages and logs.
- Record actor, timestamp, product, revision, operation, and before/after summary for:
  - product creation
  - product update
  - variant creation/edit/removal
  - map/remap/unlink
  - CJ refresh
  - sourcing submission/resubmission
  - publish/unpublish
- Require explicit confirmation when removing a mapped or order-referenced variant.
- Prevent deletion when fulfillment history requires retention; deactivate instead.

---

## 19. Observability

Track:

- Products by resolution reason.
- Unmapped customer variants.
- Unmatched CJ variants.
- Time from CJ approval to mapping complete.
- Time spent per product in Quick Fix.
- Suggested mapping acceptance rate by confidence band.
- Mapping conflicts.
- Save failures by error code.
- Revision conflicts.
- Provider refresh failures.
- Products moved to fulfillment-ready after save.
- Catalog edits that unexpectedly invoke sourcing; target must be zero.
- Draft recovery rate.

Add a small operational summary to CJ Settings and structured events to the existing logging system.

---

## 20. Testing Strategy

### 20.1 Unit tests

Cover:

- Product-to-Draft conversion.
- ImportableProduct-to-Draft conversion.
- Draft-to-create input.
- Draft-to-update patch.
- Variant identity normalization.
- Dimension normalization.
- Matching score and confidence bands.
- Duplicate mapping prevention.
- SKU/VID consistency.
- Name uniqueness integration.
- Multi-subcategory validation.
- Audience/product-type terminology.
- Readiness reason codes.
- Revision conflict formatting.

### 20.2 Component tests

Cover:

- Studio opens in every mode.
- Add and Edit expose the same sections.
- Import batch navigation preserves drafts.
- Quick Fix opens the targeted product.
- Target product with no CJ variants still appears.
- Add, rename, reorder, deactivate, and remove customer variant.
- Create customer variant from CJ.
- Map, remap, and unlink.
- Suggested match reasoning.
- Dirty-state warning.
- Validation summary and field focus.
- Conflict UI.

### 20.3 Backend integration tests

Cover:

- Unauthorized query and mutation rejection.
- Unknown product, customer variant, and CJ variant rejection.
- CJ variant membership validation.
- Duplicate assignment rejection.
- Atomic variant and mapping commit.
- No partial write on validation failure.
- Product revision increment.
- Stale revision rejection.
- Readiness recomputation in the same transaction.
- Audit event creation.
- Idempotent provider refresh and migration.

### 20.4 End-to-end tests

Required scenarios:

1. URL import → curate → translate → Smart Name → Smart Description → multi-category → variants → create.
2. Manual Add uses the same panels and creates the same record shape.
3. Edit imported product retains source, AI provenance, categories, images, variants, and pricing.
4. Edit a customer variant label without changing its mapping or triggering sourcing.
5. CJ returns more variants than customer variants → create and map missing customer variant.
6. Customer product has variants but CJ returns none → queue still offers recovery actions.
7. Apply high-confidence mappings, review, and save once.
8. Reject duplicate CJ assignment.
9. Concurrent edit produces a recoverable conflict.
10. Deep link from Risk Check opens exact product and first blocking mapping issue.
11. Mapping completion moves the product to the correct readiness state.
12. Unique-name and audience-aware naming rules work identically in Import, Add, and Edit.

---

## 21. Performance Requirements

- Paginate the Product Resolution Queue.
- Do not send every full product and provider payload to the browser for the queue.
- Load the full mapping workspace only when a row is opened.
- Virtualize very large variant tables when necessary.
- Cache deterministic match calculations by snapshot/version.
- Debounce draft persistence.
- Keep interactive editor updates local; use server validation at section boundaries and save.
- A normal product workspace should become interactive within two seconds on an ordinary admin connection.
- Queue filtering and search should respond within 300 ms after data is available.

---

## 22. Rollout and Rollback

Use two independent flags:

- unifiedProductStudio
- cjMappingWorkbench

Rollout order:

1. Internal administrators.
2. Add Product.
3. Edit Product.
4. A small percentage of Import sessions.
5. All Import sessions.
6. CJ Quick Fix for a subset of products.
7. Full CJ queue.
8. Remove old routes after a stable observation period.

Rollback must:

- Turn off the new entry points without reverting data migrations.
- Preserve drafts and audit records.
- Keep legacy reads compatible during the rollout window.
- Never restore unsafe legacy mutations after normalized mapping data becomes authoritative.

---

## 23. Acceptance Criteria

### Unified studio

- Add, Import, and Edit open the same studio shell and shared panels.
- A field available in one mode is available in every applicable mode.
- Visual design, terminology, validation, and save behavior are consistent.
- The import batch experience remains efficient.
- Existing products can use all import-time curation controls.
- No supported Product field is silently dropped by a client allowlist.

### CJ workflow

- CJ Settings has an actionable, filterable resolution queue.
- A product needing help appears even when cjVariants is empty.
- A deep link always shows the target product or an explicit explanation.
- An administrator can add and fully edit a customer variant in Quick Fix.
- An administrator can create a customer variant from a CJ variant.
- Customer and CJ variants appear side by side.
- Multiple changes save atomically.
- Mapping integrity is enforced on the server.
- Readiness updates immediately after save.
- Normal label edits do not resubmit sourcing.

### Reliability

- Product revisions prevent silent overwrite.
- All product-operation endpoints require admin authorization.
- Every material variant and mapping change is audited.
- Migration is idempotent and preserves valid mappings.
- Critical workflows have automated unit, component, integration, and end-to-end coverage.

### Product rules

- Product-name uniqueness works through every entry mode.
- Suggested names are audience and product aware.
- Boys romper-type products use “onesie” terminology.
- Multiple subcategories can be selected and persisted everywhere.
- Product category and naming metadata survive later edits.

---

## 24. Recommended Pull Request Sequence

1. **PR 1 — Mapping safety**
   - Add mapper query authorization.
   - Add strict server mapping validation.
   - Add inclusive resolution queue read model.
   - Add baseline tests and metrics.

2. **PR 2 — Canonical product draft**
   - Add shared draft, validation, adapter, revision, and error contracts.
   - Add product operation audit schema.

3. **PR 3 — Unified Add/Edit studio**
   - Build shared shell and panels.
   - Route Add and Edit through it.
   - Remove the frontend update allowlist from the new path.

4. **PR 4 — Unified Import**
   - Reuse the shared panels for batch import.
   - Move final transformation and validation to canonical server commands.

5. **PR 5 — CJ resolution workbench**
   - Add resolution queue, Quick Fix, reconciliation grid, suggestions, customer variant editing, and atomic save.

6. **PR 6 — Migration and retirement**
   - Backfill mapping metadata.
   - Verify production data.
   - Retire legacy ProductStudio, editor portions of ProductImport, CJVariantManager, and legacy write paths.

Each PR must be ready for review, deployable behind flags, and safe to roll back without data loss.

---

## 25. Definition of Done

This initiative is complete only when:

- Import, Add, and Edit are truly the same product editing system, not visually similar wrappers around different logic.
- CJ Settings supports the complete repair loop without forcing administrators to hunt through other pages.
- Missing or incorrect customer variants can be created, edited, and mapped to the correct CJ variants quickly.
- The target product remains actionable in every relevant incomplete state.
- Save behavior is typed, authenticated, validated, revision-aware, atomic, and audited.
- Existing valid product, variant, name, taxonomy, pricing, image, sourcing, and mapping data is preserved.
- Automated tests cover all critical acceptance scenarios.
- Production metrics show no regression in import completion and a measurable reduction in unresolved mapping work and time to resolution.

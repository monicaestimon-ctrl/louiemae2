# Louie Mae Product Naming and Multi-Subcategory Implementation Specification

Status: Proposed  
Scope: Product import, manual product creation, AI naming, product persistence, taxonomy assignment and storefront category discovery  
Primary: Louie Mae engineering/product  
Last updated: 2026-09-07

## 1. Executive summary

Louie Mae must guarantee that every customer-facing product name is unique across the entire catalog, regardless of collection, category, publication state, import method or product lifecycle. The guarantee must apply on every AI naming turn and on every save. A name that has been suggested, accepted, renamed away from or attached to a deleted product must never be offered or used for another product.

Louie Mae must also allow one product to be assigned to multiple subcategories inside its collection. For example, one unisex pair of pants may belong to both `girls-pants` and `boys-pants`. The product remains one inventory record, but it must be discoverable through both category paths.

These requirements cannot be guaranteed by an AI prompt or client-side validation alone. The implementation therefore introduces:

1. A permanent, globally scoped product-name ledger.
2. Atomic name reservation and claim operations in Convex mutations.
3. A retrying AI generation workflow that records every suggestion before returning it.
4. Definitive name validation on every product create, import, rename, recovery and delete path.
5. Stable, collection-scoped subcategory IDs stored as an array on products.
6. One primary subcategory for labels, breadcrumbs and default navigation.
7. Shared hierarchical category-matching logic for storefront and admin experiences.
8. An additive migration and dual-read rollout that preserves existing inventory.

## 2. Goals

### 2.1 Naming goals

- Guarantee global name uniqueness across every current and future collection and category.
- Guarantee that every successful AI naming turn returns a name that has never been recorded before.
- Prevent concurrent imports or browser sessions from receiving the same suggested name.
- Prevent manual entry, bulk imports and internal repair jobs from bypassing the rule.
- Permanently remember suggested and previously used names.
- Preserve boutique-quality names; never make a collision unique by appending a number or technical suffix.
- Provide actionable conflict messages without discarding the administrator's other work.
- Maintain an auditable history of suggestion, activation, rename and retirement events.

### 2.2 Categorization goals

- Allow a product to belong to multiple subcategories within one collection.
- Preserve a single primary subcategory for presentation and navigation.
- Make a product discoverable through every directly assigned subcategory and each assigned subcategory's ancestors.
- Avoid duplicate product cards when several assignments match the same page.
- Use stable IDs for relationships so category-title edits do not break product placement.
- Support existing legacy product records throughout migration.

## 3. Non-goals

- A product will not belong to multiple top-level collections in this implementation. `collection` remains singular.
- The system will not automatically merge products because their source URLs, images or variants appear similar.
- Near-duplicate names are not initially a database-level hard failure. They are a quality warning and AI avoidance signal.
- The implementation will not add numeric suffixes such as `Poppy Romper 2`.
- The implementation will not automatically choose which existing product keeps a name if production already contains a collision.
- This work does not redesign the public collection URLs. Existing title-based links remain supported during rollout.

## 4. Current-state findings

### 4.1 Name generation is advisory rather than authoritative

The existing smart-name action queries product names from only the inferred collection. That lookup examines at most 120 products and returns at most 40 names. A duplicate in another collection, outside the lookup window, or in an unsaved import draft is invisible to the generator.

The generated name is validated only against this bounded list. The fallback builder loops through a small first-name pool and grounded modifiers, but it has no explicit exhaustion failure; if all candidates have already been used, it can still return the final duplicate candidate.

The final `products.create` and `products.update` mutations do not normalize or validate product names. As a result, AI duplication avoidance can be bypassed by:

- manual entry;
- simultaneous imports;
- two administrators working concurrently;
- batch products that have not yet been saved;
- imports from different collections;
- direct CJ sourcing creation;
- 1688 hydration and recovery mutations;
- future maintenance utilities that patch `products.name` directly.

### 4.2 Import persistence can partially succeed

The import screen constructs product payloads and the admin screen saves them with concurrent individual calls. The context layer catches create errors and returns `null`, while the import completion message is based on the requested product count. A future uniqueness error could therefore be hidden or reported as a successful import unless the error contract is refactored.

### 4.3 Product categorization is singular

The current product model has a required `category` string and an optional `subcategory` string. Import currently stores a category display title in `category` and generally stores a category ID in `subcategory`. Product Studio exposes one category selector, and storefront/admin filters compare the single `category` string.

Category hierarchy is represented by `parentCategory`, which contains a parent display title. Renaming a parent can orphan its child relationships.

## 5. Required invariants

The implementation is complete only when the following statements are always true.

### 5.1 Name invariants

1. `normalizedName` is globally unique in the product-name ledger.
2. Every successful AI naming response has a persisted ledger record before the response is returned.
3. A ledger record is never deleted through normal application behavior.
4. Names in `suggested`, `active` or `retired` state are unavailable to every other product or draft.
5. A product save cannot succeed unless its name has been atomically claimed.
6. Renaming a product atomically retires its old name and activates its new name.
7. Deleting a product retires its active name but does not free it.
8. All name comparisons use the same canonical normalizer.
9. A failed or exhausted generator never silently returns a duplicate.
10. Every direct database write affecting `products.name` uses the central name-claim helper.

### 5.2 Category invariants

1. A product belongs to exactly one collection.
2. Every value in `subcategoryIds` exists within that collection's category configuration.
3. `subcategoryIds` contains no duplicates.
4. If `primarySubcategoryId` is present, it is also present in `subcategoryIds`.
5. A published product has at least one valid subcategory assignment.
6. A hidden sourcing-intake product may temporarily have no subcategory.
7. Parent-category membership is derived from assigned descendants rather than redundantly stored.
8. Any product list deduplicates by product ID after matching categories.

## 6. Name normalization contract

Create one pure function, used by browser tests and all server paths:

```ts
normalizeProductName(input: string): string
```

Required normalization sequence:

1. Convert the input to Unicode NFKD form.
2. Remove combining marks.
3. Convert to lowercase using a stable locale-insensitive strategy.
4. Convert ampersands to the word `and`.
5. Treat apostrophes, quotation marks, dashes, slashes and other punctuation as separators.
6. Remove remaining characters outside letters, numbers and spaces.
7. Collapse consecutive whitespace.
8. Trim leading and trailing whitespace.

Examples that must produce the same key:

| Display name | Normalized key |
| --- | --- |
| `Poppy-Ruffle Romper` | `poppy ruffle romper` |
| ` POPPY  RUFFLE ROMPER ` | `poppy ruffle romper` |
| `Poppy / Ruffle Romper` | `poppy ruffle romper` |

Additional validation:

- The display name must not be empty after normalization.
- The key must have a reasonable maximum length, recommended 120 characters.
- The display name should remain 2-4 words for AI-generated boutique names.
- Manual names may exceed four words when intentionally approved, but global uniqueness still applies.
- Control characters and markup are rejected.

Normalization changes are breaking changes to uniqueness semantics. Version the algorithm with `normalizationVersion: 1` in the ledger so a future version can be migrated deliberately.

## 7. Data model

### 7.1 Product changes

Add optional fields first for an additive deployment:

```ts
products: {
  name: string,
  nameKey?: string,
  activeNameClaimId?: Id<"productNameClaims">,

  collection: string,
  subcategoryIds?: string[],
  primarySubcategoryId?: string,

  // Legacy fields retained during migration.
  category: string,
  subcategory?: string
}
```

`nameKey` is a denormalized lookup/debug field. The ledger remains the authority.

`category` should be maintained as the primary category display title during the compatibility period. `subcategory` should be maintained as the primary subcategory ID. New code must not treat either field as the full assignment set.

### 7.2 Product-name claims

Add a table:

```ts
productNameClaims: {
  normalizedName: string,
  normalizationVersion: number,
  displayName: string,
  status: "suggested" | "active" | "retired",

  ownerKey?: string,
  productId?: Id<"products">,
  suggestionRequestId?: string,
  source: "ai" | "manual" | "migration" | "recovery" | "direct_sourcing",

  firstRecordedAt: number,
  activatedAt?: number,
  retiredAt?: number,
  updatedAt: number
}
```

Indexes:

```ts
.index("by_normalized_name", ["normalizedName"])
.index("by_product", ["productId"])
.index("by_owner", ["ownerKey"])
.index("by_status_updated", ["status", "updatedAt"])
```

There must be only one claim document per normalized name. Convex indexes are used to find the record; application mutations enforce the one-record invariant atomically.

### 7.3 Name-event audit log

Add an immutable audit table:

```ts
productNameEvents: {
  claimId: Id<"productNameClaims">,
  productId?: Id<"products">,
  ownerKey?: string,
  event: "suggested" | "activated" | "renamed" | "retired" | "migration_claimed",
  displayName: string,
  normalizedName: string,
  requestId?: string,
  actorUserId?: string,
  metadata?: unknown,
  createdAt: number
}
```

Indexes:

```ts
.index("by_claim", ["claimId", "createdAt"])
.index("by_product", ["productId", "createdAt"])
.index("by_created_at", ["createdAt"])
```

Events support troubleshooting and prove why a name is unavailable without mutating history.

### 7.4 Category configuration changes

Extend the category type:

```ts
type Category = {
  id: string,
  title: string,
  parentCategoryId?: string,

  // Temporary compatibility field.
  parentCategory?: string
}
```

Category IDs are scoped to a collection. The stable internal key is therefore:

```ts
`${collectionId}:${subcategoryId}`
```

This is necessary because IDs such as `accent-chairs` currently exist in more than one collection.

## 8. Owner identity for suggestions

Every name-generation request must include a stable `ownerKey`.

Owner-key priority:

1. Existing product: `product:<productId>`
2. Batch import item: `batch-item:<batchImportItemId>`
3. Stable normalized source URL: `source:<sha256(normalizedUrl)>`
4. New manual draft: `draft:<uuid>`

The browser creates the manual draft UUID once and persists it with the product draft. Reloading the import review must preserve it.

The owner key is not a uniqueness boundary. All names remain globally unique. It only proves that a saved product is activating the suggestion created for its own draft.

Every generation turn must still produce a newly recorded name. A second generation request from the same owner may not return one of that owner's earlier suggestions.

## 9. Server-side name operations

Place normalization and claim behavior behind shared functions that accept a Convex query/mutation context. No feature should duplicate the rules.

### 9.1 Check availability

```ts
checkProductNameAvailability({
  displayName,
  productId?,
  ownerKey?,
  claimId?
})
```

Possible results:

```ts
type NameAvailability =
  | { available: true; normalizedName: string }
  | {
      available: false;
      normalizedName: string;
      reason: "suggested" | "active" | "retired";
      claimId: Id<"productNameClaims">;
      belongsToCurrentProduct: boolean;
    };
```

The current product may continue using its current active claim. This is needed for saves that change price, images or capitalization without renaming the product.

### 9.2 Record an AI suggestion

```ts
recordProductNameSuggestion({
  displayName,
  ownerKey,
  requestId,
  actorUserId
})
```

Algorithm inside one mutation:

1. Authenticate the administrator or trusted internal action.
2. Normalize and validate the candidate.
3. Query `productNameClaims.by_normalized_name`.
4. If any record exists, return `NAME_UNAVAILABLE`; do not overwrite it.
5. Insert a `suggested` claim.
6. Insert a `suggested` event.
7. Return the claim ID and normalized name.

Because the read and insert occur in one transaction, concurrent attempts for the same key conflict and only one attempt can commit.

Suggested claims do not expire. This is deliberate: a name that was offered once is permanently remembered and is never offered to another product.

### 9.3 Claim a manual name during create

If a manually entered name has no ledger record, the create mutation inserts an `active` claim and the product in the same transaction.

If a record already exists, creation fails unless it is the exact `suggested` claim supplied by the same draft owner. In that case the mutation promotes it to `active`.

### 9.4 Activate an AI suggestion

The product payload carries:

```ts
{
  name: string,
  nameClaimId?: Id<"productNameClaims">,
  nameOwnerKey?: string
}
```

The create mutation verifies:

- the claim exists;
- the display name normalizes to the claim's key;
- the claim has `suggested` status;
- the claim belongs to the submitted owner key;
- the claim is not attached to another product.

It then inserts the product, changes the claim to `active`, attaches `productId`, and writes the activation event atomically.

### 9.5 Rename a product

Rename algorithm in one mutation:

1. Load the existing product and active claim.
2. Normalize the requested display name.
3. If the key is unchanged, update display capitalization/punctuation on the product and active claim.
4. If the key changed, validate or activate the new claim.
5. Mark the old claim `retired`.
6. Update the product's name, key and active claim ID.
7. Insert `renamed`, `retired` and `activated` audit events as appropriate.

The old name remains unavailable forever.

### 9.6 Delete a product

Deletion must occur in a mutation that:

1. Loads the product.
2. Marks its active name claim `retired`.
3. Inserts a retirement event with reason `product_deleted`.
4. Deletes the product.

The claim and events remain.

### 9.7 Structured errors

Server mutations must throw or return structured errors with stable codes:

```ts
type ProductNameErrorCode =
  | "PRODUCT_NAME_EMPTY"
  | "PRODUCT_NAME_INVALID"
  | "PRODUCT_NAME_UNAVAILABLE"
  | "PRODUCT_NAME_CLAIM_MISMATCH"
  | "PRODUCT_NAME_GENERATION_EXHAUSTED"
  | "PRODUCT_NAME_MIGRATION_CONFLICT";
```

UI-safe conflict detail:

```ts
{
  code: "PRODUCT_NAME_UNAVAILABLE",
  displayName: string,
  normalizedName: string,
  reason: "suggested" | "active" | "retired"
}
```

Do not return another product's private source data in the error.

## 10. AI generation workflow

### 10.1 Request changes

Extend `SmartNameRequest`:

```ts
type SmartNameRequest = {
  productId?: string,
  ownerKey: string,
  generationRequestId: string,
  sourceSnapshot: SourceProductSnapshot,
  adminContext?: {
    selectedCollection?: string,
    selectedSubcategoryIds?: string[],
    primarySubcategoryId?: string
  },
  generationMode: NameGenerationMode,
  options?: {
    allowImageAnalysis?: boolean,
    forceFreshVariation?: boolean,
    maxAttempts?: number
  }
}
```

### 10.2 Response changes

```ts
type SmartNameResponse =
  | {
      ok: true,
      name: string,
      nameClaimId: string,
      ownerKey: string,
      facts: NormalizedProductFacts,
      warnings: string[],
      fallbackUsed: boolean
    }
  | {
      ok: false,
      errorCode: ProductNameErrorCode,
      error: string,
      warnings: string[]
    };
```

### 10.3 Candidate generation loop

For each request:

1. Authenticate.
2. Normalize the source product and extract verified facts.
3. Load a bounded diversity sample for the prompt. This sample is an optimization, not the uniqueness guarantee.
4. Generate a candidate using Gemini.
5. Coerce and validate the structured response.
6. Call `recordProductNameSuggestion`.
7. If the claim succeeds, return it.
8. If the name already exists, add it to the retry exclusion list.
9. Regenerate with an explicit collision warning.
10. Repeat up to five total AI attempts by default.
11. Enumerate grounded deterministic fallback candidates, attempting to record each one.
12. If no candidate can be recorded, return `PRODUCT_NAME_GENERATION_EXHAUSTED`.

The action must never return a name before the ledger mutation commits.

### 10.4 Prompt behavior

The prompt should still receive relevant previous names to improve first-pass diversity, but uniqueness language must be explicit:

- Do not reproduce any excluded full name.
- Avoid reusing the same first-name-plus-product-type combination when a quality alternative exists.
- Use only grounded product facts.
- Return 2-4 words.
- Never add digits or inventory-style suffixes.
- Preserve the Louie Mae boutique naming format.

The prompt is not trusted as enforcement.

### 10.5 Fallback behavior

Refactor the fallback builder to return candidates rather than one presumed-safe result:

```ts
buildSafeNameFallbackCandidates(facts): GeneratedSmartNameDraft[]
```

Candidate order:

1. First name + strongest grounded modifier + product type
2. First name + second grounded modifier + product type
3. First name + two compatible grounded modifiers + product type, while respecting the four-word limit
4. First name + product type

Every fallback candidate passes through the ledger. Exhaustion is an error, never permission to reuse.

## 11. Batch import transaction design

Add an authenticated mutation:

```ts
createImportedProducts({
  products: ImportProductInput[]
}): Promise<{
  productIds: Id<"products">[];
  idempotentProductIds?: Id<"products">[];
}>
```

Before any insert, the mutation must:

1. Resolve existing `batchImportItemId` records for idempotency.
2. Normalize all names for genuinely new products.
3. Detect duplicate keys inside the submitted payload.
4. Validate every supplied name claim.
5. Validate collection and subcategory assignments.
6. Validate primary subcategory membership.

If validation fails, return item-level errors and perform no inserts.

If validation succeeds:

1. Insert each new product.
2. Activate or create each name claim.
3. Insert name events.
4. Return IDs in input order.

Image caching remains outside the mutation. The client should reserve/validate names before expensive image caching and perform the atomic create afterward. If a final mutation fails, the prepared images can safely remain cached; no catalog product was partially created.

Description-audit linking should be included in the batch mutation when feasible. If it remains a follow-up operation, its failure must be reported separately and must not cause the product import itself to be labeled a failure.

## 12. Other product write paths

The following paths require explicit refactoring:

### 12.1 Manual Product Studio create/update

- Pass owner and claim IDs with generated names.
- Run a debounced availability query for typed names.
- Await and surface create/update errors.
- Do not close Product Studio after a failed save.

### 12.2 Direct CJ sourcing intake

- Give each temporary sourcing product a deterministic unique intake name that includes its batch item identity.
- Claim that intake name when creating the product.
- When hydration assigns the boutique name, use the atomic rename helper.
- Retire the intake name after hydration.

### 12.3 1688 recovery

- Replace bounded-array validation with the ledger-backed generation loop.
- Make `applyRecoveredProduct` use the centralized atomic rename/category helper instead of accepting an unrestricted patch containing `name`.
- Dry runs may generate preview candidates without recording them only when clearly labeled non-authoritative. A dry-run candidate must never be shown as a guaranteed available final name.

### 12.4 Seed data

- Initial product seeding must use the same create/claim logic.
- Seed collisions must fail visibly rather than being silently repeated by multiple effects.

### 12.5 Future maintenance jobs

- Prohibit direct `ctx.db.patch(productId, { name })` outside the central module.
- Add a repository search/checklist item for reviewers.
- Consider an ESLint restriction or narrow server helper export if direct writes become a recurring risk.

## 13. Multi-subcategory write contract

### 13.1 Product input

Create/update/import payloads accept:

```ts
{
  collection: string,
  subcategoryIds: string[],
  primarySubcategoryId?: string
}
```

Server normalization:

1. Trim IDs.
2. Remove empty entries.
3. Deduplicate while preserving selection order.
4. Limit to eight assignments.
5. Load the current collection configuration.
6. Reject IDs that do not exist in the selected collection.
7. Ensure the primary ID is included.
8. If no primary is provided and the array is nonempty, use the first selected ID.
9. Write the primary category title into legacy `category`.
10. Write the primary ID into legacy `subcategory` during dual-write rollout.

Changing a product's collection clears its category assignments unless the submitted mutation also supplies a complete valid replacement set for the new collection.

### 13.2 Leaf assignment rule

Administrators assign the most specific applicable categories. Parent membership is derived.

Example:

```ts
{
  collection: "kids",
  subcategoryIds: ["girls-pants", "boys-pants"],
  primarySubcategoryId: "girls-pants"
}
```

Do not redundantly store `girls`, `girls-bottoms`, `boys` or `boys-bottoms` on this product. Matching helpers derive those ancestors.

Categories with no children, including many furniture and decor categories, are valid assignable leaves.

## 14. Category hierarchy helpers

Create pure shared helpers, recommended in `lib/productCategories.ts`:

```ts
getCategoryById(collection, categoryId)
getCategoryParent(collection, categoryId)
getCategoryAncestors(collection, categoryId)
getCategoryDescendants(collection, categoryId)
normalizeProductCategoryAssignments(product, collection)
productMatchesCategory(product, requestedCategoryId, collection)
getPrimaryCategory(product, collection)
getProductCategorySearchTerms(product, collection)
```

`getCategoryAncestors` must guard against cycles and missing parents. A category configuration is invalid when:

- IDs repeat within a collection;
- a parent ID is missing;
- a category is its own parent;
- a hierarchy cycle exists.

The category editor must prevent saving invalid hierarchy changes.

### 14.1 Matching algorithm

```ts
function productMatchesCategory(product, requestedId, collection) {
  for (const assignedId of product.subcategoryIds) {
    if (assignedId === requestedId) return true;
    if (getCategoryAncestors(collection, assignedId).includes(requestedId)) return true;
  }
  return false;
}
```

During migration, if `subcategoryIds` is absent, resolve the legacy `subcategory` ID or `category` title and use it as a one-item effective assignment array.

## 15. Import-review UI specification

### 15.1 Draft type changes

Replace:

```ts
targetSubcategory?: string
```

with:

```ts
targetSubcategoryIds?: string[]
targetPrimarySubcategoryId?: string
nameOwnerKey: string
nameClaimId?: string
nameAvailability?: "unchecked" | "checking" | "available" | "unavailable"
nameConflictReason?: string
```

Legacy draft restoration should convert `targetSubcategory` into a one-item array when it matches a valid ID.

### 15.2 Subcategory picker

Replace the single-select subcategory control with a reusable multi-select picker:

- Group categories visually by their top-level ancestor.
- Show checkboxes for assignable leaves.
- Allow search by category title.
- Show selected categories as removable chips.
- Indicate the primary selection with a radio/star control.
- When the first category is checked, make it primary automatically.
- When the primary category is removed, promote the first remaining selection.
- Show a concise count when collapsed, such as `2 subcategories selected`.
- Keep the control keyboard-accessible and use checkbox semantics.

For a unisex pants product, the administrator can check both:

- Girls → Girls Bottoms → Girls Pants
- Boys → Boys Bottoms → Boys Pants

### 15.3 Name field behavior

The name field should:

- Debounce manual availability checks by approximately 300-500 ms.
- Check current review-batch names immediately on the client.
- Display `Checking name...`, `Unique name`, or a specific conflict message.
- Clear the stored AI claim ID when the administrator edits the name to a different normalized value.
- Preserve the claim when only capitalization changes without changing the normalized key.
- Disable Next/Import while the name is empty or unavailable.
- Offer `Generate another unique name` on conflict.

### 15.4 Final review

Each product summary displays:

- final product name;
- name uniqueness status;
- primary subcategory;
- all additional subcategories;
- collection;
- existing image, variant, description and price review data.

The final import button performs a preflight validation and then invokes the atomic batch mutation.

### 15.5 Failure behavior

If the server rejects a name:

- keep the entire review draft;
- return to or focus the first affected product;
- mark every affected product, not only the first;
- do not mark batch-import items as imported;
- do not show a success count;
- allow regeneration or manual correction and retry.

## 16. Product Studio UI specification

Use the same category picker and name-status components as import review.

Product Studio save behavior:

- Creating a product requires an available name.
- Editing an existing product may retain its current claim.
- Renaming requires a new claim and warns that the old name will remain retired permanently.
- Closing without saving leaves AI suggestions recorded and unavailable, consistent with the strict every-turn rule.
- A failed save keeps the studio open and displays the server error next to the field.
- Publishing requires at least one valid subcategory; saving hidden sourcing inventory may omit it.

## 17. Auto-categorization changes

The current auto-categorizer returns one category string. Replace its target contract with:

```ts
type CategorySuggestion = {
  suggestedSubcategoryIds: string[],
  primarySubcategoryId: string,
  confidenceById: Record<string, number>,
  reasons: Record<string, string>
}
```

Rules:

- Suggestions must be restricted to valid IDs from the selected collection.
- The AI may suggest multiple categories when evidence supports shared applicability.
- The AI must not infer gender solely from styling color.
- The administrator confirms suggestions before import.
- Invalid AI IDs are discarded and surfaced as a warning.
- Category suggestions do not alter the name-uniqueness scope; naming stays global.

## 18. Storefront behavior

### 18.1 Category resolution

Continue accepting existing `?cat=<title>` URLs. Resolve the title to a category ID within the current collection and then use hierarchical matching.

A future URL migration may use category IDs, but it is not required for this release.

### 18.2 Product grids

- Collection `All` views filter only by collection and include each product once.
- Leaf-category views match direct assignments.
- Parent-category views match assignments to any descendant.
- Results are deduplicated by product ID before sorting.
- Existing sort behavior remains unchanged.

### 18.3 Category previews

Preview sliders use the same matching helper as full grids. A product assigned to both Girls Pants and Boys Pants appears in both relevant previews, but only once per preview.

### 18.4 Product labels and links

- Product cards display the primary category title.
- Admin inventory may display `Girls Pants +1` for additional assignments.
- New-arrival and new-collection cards navigate to the primary category.
- Search indexes primary, secondary and ancestor category titles.
- Cart and order product identity remains unchanged.

## 19. Migration plan

### 19.1 Pre-migration audit

Add a read-only internal query/action that reports:

- normalized name collisions;
- blank or invalid normalized names;
- exact category ID matches from legacy `subcategory`;
- exact category-title matches from legacy `category`;
- ambiguous title matches;
- missing category matches;
- duplicate category IDs within a collection;
- unresolved parent titles and hierarchy cycles.

The audit must support pagination and produce counts plus affected product IDs. It must not mutate data.

### 19.2 Existing name collisions

If collisions exist:

1. Do not automatically choose a winner.
2. Present all products in each collision group.
3. Keep the oldest or strongest brand name only after an administrator chooses.
4. Generate and reserve new names for the remaining products.
5. Apply each rename through the atomic rename helper.
6. Rerun the audit until no collisions remain.

### 19.3 Historical deleted names

The current products table cannot prove names used by products that were deleted before the ledger existed. If exports, backups or prior catalog spreadsheets are available, normalize and import those names as `retired` claims before enforcement.

After the ledger launches, deletion and rename history is permanent automatically.

### 19.4 Name backfill

After existing collisions are resolved:

1. Process products in deterministic creation order.
2. Normalize the current name.
3. Insert an active claim with source `migration`.
4. Attach the product ID.
5. Patch `nameKey` and `activeNameClaimId` on the product.
6. Insert a `migration_claimed` event.
7. Make the job resumable and idempotent.

Any collision encountered during backfill stops or quarantines the affected group. It must not overwrite an earlier claim.

### 19.5 Category backfill

For each product:

1. Load the collection's category configuration.
2. If legacy `subcategory` exactly matches an ID, use that ID.
3. Otherwise, if legacy `category` exactly matches one title within the collection, use that category's ID.
4. Otherwise perform a normalized-title match only when it yields exactly one result.
5. Set `subcategoryIds` to the resolved one-item array.
6. Set `primarySubcategoryId` to the resolved ID.
7. Keep legacy fields synchronized.
8. Flag ambiguous or unmappable products for manual review.

Do not infer a second category during migration. Multiple assignments should be added by the administrator or a reviewed category-suggestion workflow.

### 19.6 Parent-ID backfill

For every category with `parentCategory`:

1. Find the exact parent title within the same collection.
2. Set `parentCategoryId`.
3. Report missing or multiple matches.
4. Validate the completed hierarchy for cycles.

## 20. Rollout sequence

### Phase A: Additive foundation

- Add optional product fields.
- Add ledger and event tables/indexes.
- Add normalizer and category helpers.
- Add audit queries.
- No storefront behavior changes.

Exit criterion: schema deployed and audit reports are available.

### Phase B: Clean and backfill

- Resolve existing name collisions.
- Backfill name claims.
- Backfill category assignments and parent IDs.
- Resolve unmapped taxonomy records.

Exit criterion: every non-sourcing product has one active name claim and a valid primary category assignment.

### Phase C: Enforce all writes

- Refactor create, update, delete, batch import, direct sourcing, recovery and seeding.
- Add AI suggestion recording and retries.
- Add structured error propagation.

Exit criterion: repository search finds no uncontrolled `products.name` insert/patch path.

### Phase D: Dual-read UI release

- Release reusable name-status and multi-category picker components.
- Update import review and Product Studio.
- Update storefront, search, admin filters and primary-category links.
- Prefer new arrays with legacy fallback.

Exit criterion: old and new products render correctly and cross-category placement is verified.

### Phase E: Strict publishing validation

- Require an active name claim for every product save.
- Require at least one valid category before publishing.
- Monitor legacy fallback usage.

Exit criterion: no production products depend on legacy-only category matching.

### Phase F: Legacy cleanup

- Stop using `category` and `subcategory` as authorities.
- Retain denormalized primary fields only if helpful for external integrations.
- Remove dual-read branches after an observation period and a final audit.

## 21. Concurrency and failure analysis

### 21.1 Two generators produce the same candidate

Both attempt `recordProductNameSuggestion`. One mutation commits. The other observes a conflict/retries and generates another candidate. Only the committed name is returned.

### 21.2 A manual save races an AI suggestion

Both attempt to create the same normalized claim. Only one commits. The loser receives `PRODUCT_NAME_UNAVAILABLE` and retains its draft.

### 21.3 Two products in one import batch have the same name

The batch mutation detects duplicate normalized keys before writing and rejects the complete batch with errors attached to both items.

### 21.4 Network fails after a suggestion is recorded

The suggestion remains in the ledger and will not be offered again. This intentionally favors the strict uniqueness requirement over reclaiming unused suggestions.

### 21.5 Product save fails after an AI suggestion

The suggestion remains recorded. The administrator can retry the same save using the returned claim ID and owner key. If the draft loses that identity, the name remains unavailable rather than being unsafely reclaimed.

### 21.6 Import fails after image caching

No product or active claim is partially created because the catalog mutation is atomic. Cached image objects may remain and can be cleaned by normal orphan-retention policies.

### 21.7 Category is renamed

Product assignments remain valid because they reference IDs. Labels and breadcrumbs reflect the new title automatically.

### 21.8 Category is deleted while products use it

The category editor must block deletion and report the number of affected products, or require an explicit replacement category migration. It must never silently orphan products.

## 22. Security and authorization

- Public storefront queries may read product category assignments but not internal name-ledger ownership metadata.
- Name availability queries should return availability and reason only, not unrelated product details.
- Suggestion recording requires authenticated admin access or a trusted internal action.
- Product create/update/delete retains existing authentication requirements.
- Migration and repair functions are internal or admin-only.
- Audit event actor IDs are server-derived, never trusted from the client.
- Owner keys identify drafts but are not substitutes for authentication.

## 23. Observability

Add structured server logs and counters for:

- name generation attempts;
- candidate collisions;
- AI versus fallback success;
- generation exhaustion;
- manual name conflicts;
- batch preflight failures;
- name activations, renames and retirements;
- products using legacy category fallback;
- invalid category assignments rejected;
- products with multiple assignments.

Recommended dashboard metrics:

- percentage of name requests succeeding on first attempt;
- average attempts per successful suggestion;
- count of unavailable manual names;
- count of migration conflicts remaining;
- count of published products without new category fields;
- count of multi-subcategory products;
- category pages with zero matching products.

Logs must use request IDs and product/draft owner keys, without logging unnecessary source descriptions or credentials.

## 24. Test plan

### 24.1 Unit tests: name normalization

- capitalization differences collide;
- repeated whitespace collides;
- punctuation and dash differences collide;
- ampersand and `and` collide;
- accented and non-accented equivalent names collide;
- empty/punctuation-only names fail;
- control characters fail;
- maximum length is enforced;
- normalization is deterministic.

### 24.2 Unit tests: fallback candidates

- candidates remain grounded in facts;
- candidates respect the word limit;
- candidates contain no digits/suffixes;
- duplicate candidates are removed;
- candidate exhaustion returns an explicit error.

### 24.3 Mutation tests: claim lifecycle

- manual create makes an active claim;
- AI suggestion makes a suggested claim before response;
- suggestion activation attaches the product;
- a second create with the same key fails;
- renamed product retires its old name;
- retired name cannot be claimed;
- deleted product's name stays retired;
- capitalization-only edits retain the claim;
- mismatched owner/claim fails;
- idempotent batch item retry does not create another product or claim.

### 24.4 Concurrency tests

- concurrent suggestion attempts for one candidate yield one success;
- concurrent manual creates yield one success;
- concurrent create and rename yield one claimant;
- concurrent batch imports cannot claim the same name.

### 24.5 Category helper tests

- direct leaf assignment matches the leaf;
- leaf assignment matches all ancestors;
- sibling category does not match;
- multiple assignments match both branches;
- collection-wide results contain the product once;
- legacy category fallback works;
- invalid/missing parents are reported;
- hierarchy cycles are detected;
- duplicate IDs within one collection are rejected;
- the same ID in different collections remains properly scoped.

### 24.6 Product mutation category tests

- duplicate IDs are normalized away;
- invalid IDs are rejected;
- primary must belong to the assignment array;
- changing collection clears stale assignments;
- published product without category fails;
- hidden sourcing intake without category succeeds;
- legacy primary fields are correctly dual-written.

### 24.7 Component tests

- name field shows checking/available/unavailable states;
- manual edits clear an incompatible suggestion claim;
- multi-picker selects and removes categories;
- primary selection changes correctly;
- changing collection clears selections;
- saved browser draft restores owner, claim and category arrays;
- final review shows all categories;
- failed import focuses affected products and preserves draft data.

### 24.8 End-to-end acceptance scenarios

1. Generate names for two similar Girls Pants products; both successful turns return different never-before-recorded names.
2. Generate names simultaneously in two browser sessions; no duplicated suggestion is returned.
3. Attempt to type an existing Furniture name into a Kids product; save is blocked because scope is global.
4. Rename a product and attempt to use its old name elsewhere; save is blocked as retired.
5. Delete a product and attempt to reuse its name; save is blocked as retired.
6. Import a batch containing two identical manual names; no product in the batch is created.
7. Assign a product to Girls Pants and Boys Pants; it appears in both leaf pages and both parent paths.
8. View All Kids; the multi-assigned product appears once.
9. Rename `Girls Bottoms`; child placement continues working via parent ID.
10. Open a legacy product during dual-read rollout; it remains discoverable and editable.

## 25. Acceptance criteria

### 25.1 Naming

- Every successful AI generation turn creates a permanent unique ledger entry before returning the name.
- No name in the ledger can be suggested or claimed for a different product.
- All collections and categories share one global namespace.
- Create, update, rename, delete, import, direct-sourcing and recovery paths enforce the same rule.
- Current import-batch duplicates are detected before persistence.
- Concurrent operations cannot commit the same normalized name.
- Previous names remain unavailable after rename or deletion.
- The fallback path never returns a known duplicate.
- UI errors identify the affected draft and preserve review work.
- No success message includes failed imports.

### 25.2 Categories

- Administrators can select multiple subcategories for one product.
- One selected subcategory is designated primary.
- Assignments are stored using stable IDs.
- A product assigned to Girls Pants and Boys Pants appears in both paths.
- Parent-category pages derive membership correctly.
- Multi-assigned products appear once in collection-wide views.
- Search and admin filters recognize every assignment.
- Published products cannot retain invalid or empty assignments.
- Existing products remain functional during migration.

## 26. File-level implementation map

### New recommended files

- `lib/productNames.ts`: pure normalization, display validation and client-safe error parsing.
- `lib/productNames.test.ts`: normalization and candidate tests.
- `lib/productCategories.ts`: assignment normalization, hierarchy traversal and matching.
- `lib/productCategories.test.ts`: hierarchy and matching tests.
- `convex/productNameClaims.ts`: availability queries, suggestion recording and audit reads.
- `convex/productWriteHelpers.ts`: shared atomic product/name/category write helpers.
- `convex/productMigrations.ts`: audits and resumable backfills.
- `components/ProductNameField.tsx`: reusable name input and availability states.
- `components/SubcategoryMultiSelect.tsx`: reusable grouped multi-picker.

### Existing files requiring changes

- `convex/schema.ts`: ledger/event tables, indexes and additive product fields.
- `convex/products.ts`: guarded create/update/delete, atomic batch create and category validation.
- `convex/smartNames.ts`: owner-aware retry/reservation workflow.
- `convex/geminiNameClient.ts`: candidate-based fallback and stronger retry exclusions.
- `convex/batchImports.ts`: guarded direct-sourcing creation.
- `convex/recover1688Imports.ts`: ledger-backed recovery naming.
- `convex/recover1688ImportsDb.ts`: restricted atomic recovery mutation.
- `lib/smartDescription.ts`: smart-name owner and multi-category request/response types.
- `types.ts`: product/category types.
- `components/import/ProductCard.tsx`: name status and draft fields where applicable.
- `components/ProductImport.tsx`: multi-select assignments, unique-name state, preflight and atomic batch save.
- `components/ProductStudio.tsx`: shared name/category controls and error handling.
- `components/AdminPage.tsx`: atomic import result handling and multi-category inventory display/filtering.
- `contexts/BlogContext.tsx`: stop swallowing product mutation failures; update field allowlist/contracts.
- `components/StorePage.tsx`: ID-based hierarchical matching and result deduplication.
- `components/SearchModal.tsx`: search all category labels/ancestors.
- `components/NewArrivalsPage.tsx`: primary-category links.
- `components/NewCollectionPage.tsx`: primary-category labels/links.
- `convex/sourceProductNormalizer.ts`: preserve multi-category admin context where relevant.
- `convex/productFacts.ts`: use primary and additional categories as grounded context without treating them as product claims.

## 27. Definition of done

The feature is done when all acceptance scenarios pass against a production-like Convex deployment, the pre-migration and post-migration audits show no unresolved name collisions or invalid published category assignments, and a repository-wide review confirms there is no uncontrolled product-name write path.

The central architectural rule is:

> AI proposes a candidate, but only the permanent transactional ledger can make that name available to Louie Mae.

The central category rule is:

> A product is stored once, assigned to one or more stable subcategory IDs, and discovered through every applicable category path.

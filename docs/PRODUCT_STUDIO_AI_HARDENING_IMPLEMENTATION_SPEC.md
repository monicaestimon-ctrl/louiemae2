# Product Studio AI Reliability, Naming, Audience, and Translation Hardening

Status: Implementation-ready specification
Scope: Product Import, Product Studio, Smart Name, Smart Description, translation, category context, and permanent name-memory enforcement
Prepared from: Production audit on September 7, 2026
Related specification: `PRODUCT_NAMING_AND_MULTI_SUBCATEGORY_IMPLEMENTATION_SPEC.md`

## 1. Executive summary

Louie Mae's current pipeline correctly prevents two products from owning the same normalized full product title. It does not yet enforce the stricter brand rule that the memorable boutique identity inside a generated name must never be reused. For example, `Poppy Dress` and `Poppy Pants` are different complete titles, so the current registry permits both even though customers perceive `Poppy` as a repeated product name.

The production audit also found three reliability failures:

1. Smart Name always asks for a feminine first name and uses feminine fallback pools for every collection, including boys' products.
2. Romper-like products are normalized to `Romper` regardless of audience, contrary to the required boys' terminology of `Onesie`.
3. Smart Description and server-side variant translation share a Gemini project currently limited to 20 free-tier requests per day. Once exhausted, Smart Description returns a provider error instead of the safe fallback.
4. The manual Translate button uses the unauthenticated MyMemory API directly from the browser. Timeouts are swallowed for variant labels, leaving Chinese text unchanged while providing weak feedback.
5. Product Import defaults uncategorized products to Furniture. That placeholder is then treated as high-confidence admin input, even when the source title explicitly describes a boys' outfit.

This specification hardens the pipeline around five guarantees:

- Every complete product title remains globally unique forever.
- Every Smart Name boutique identity is globally unique forever across all collections and categories.
- Naming terminology and name style are derived from explicit audience, product type, description, attributes, and all selected subcategories.
- Translation has a server-side, observable, partially recoverable workflow and never reports unchanged Chinese text as success.
- Smart Description continues with safe, grounded copy when the AI provider is unavailable or rate-limited.

## 2. Production audit baseline

The implementation must preserve the following existing production invariants:

- 449 products have normalized name keys and active exact-name claims.
- No duplicate normalized complete product titles exist.
- Suggested and retired complete titles remain unavailable.
- Products may be assigned to multiple subcategories with one primary subcategory.

The audit identified these additional facts:

- The name ledger contains 449 active, 7 suggested, and 1 retired exact-name claims.
- There are 72 repeated opening tokens among products/claims.
- All seven current suggestions reuse a boutique first name already active elsewhere.
- Examples include `Poppy Pants`, `Birdie Pants`, `Rosie Bow Romper`, and `Meadow Romper` while products with the same first token already exist.
- A live imported boys' casual suit was still assigned to the default Furniture collection with no subcategory selected.
- A live Smart Description request returned Gemini `429 RESOURCE_EXHAUSTED`, with a 20-request-per-day free-tier limit.
- A live manual translation attempt left all six Chinese variant labels unchanged.
- A direct request to the current translation provider exceeded a 20-second timeout.

## 3. Goals

### 3.1 Product naming

- Prevent reuse of normalized complete titles across suggested, active, retired, renamed, and deleted products.
- Prevent reuse of the Smart Name boutique identity across all collections and categories.
- Treat merely suggesting a boutique identity as permanent use.
- Make every returned Smart Name server-validated and atomically reserved before it reaches the interface.
- Generate boys', girls', unisex, adult-fashion, furniture, decor, and other names from appropriate policies.
- Make deterministic fallbacks obey the same audience, terminology, grounding, and uniqueness rules as AI output.

### 3.2 Audience and taxonomy grounding

- Resolve audience from explicit category assignments and verified source evidence.
- Pass all selected subcategories into generation, not only the primary one.
- Never let a placeholder/default collection override explicit source evidence.
- Detect and surface conflicting evidence rather than silently choosing a misleading context.
- Use `Onesie` for boys' and unisex romper-like products.

### 3.3 Translation

- Remove direct third-party translation calls from the browser.
- Translate all requested product fields with per-field status.
- Preserve user edits made while translation is running.
- Never show a success message when Chinese text remains without a warning.
- Avoid consuming Smart Name/Smart Description model quota for common variant-label translation.

### 3.4 Smart Description

- Return grounded fallback copy when Gemini is rate-limited, unavailable, or times out.
- Avoid duplicate image-analysis requests when name and description generation run together.
- Give the administrator a clear success, fallback, partial-success, or actionable failure result.
- Preserve the existing description audit trail and add provider-failure metadata.

## 4. Non-goals

- Automatically renaming existing products that currently reuse a first name.
- Inferring a product's gender from color alone, model appearance alone, or stereotypes.
- Replacing the existing multiple-subcategory storage model.
- Automatically publishing or submitting products for sourcing.
- Allowing an AI model to bypass the database uniqueness ledger.
- Treating translation output as authoritative product facts without preserving the source text.

## 5. Terminology and policy decisions

### 5.1 Complete title

The shopper-visible complete product name, such as `Poppy Ruffle Dress`.

The normalized complete title continues to use the existing product-name normalization function and permanent claim ledger.

### 5.2 Boutique identity

The distinctive name token assigned by Smart Name, such as `Poppy` in `Poppy Ruffle Dress`.

For AI-generated names, the model must return this separately as `boutiqueIdentity`. The server must not attempt to recover it from the final display string when structured output is available.

### 5.3 Descriptive title

A title without a boutique identity, such as `Embroidered Stripe-Cuff Pants`. Descriptive titles are protected by complete-title uniqueness but do not reserve common descriptive opening words such as `Embroidered`, `Kids`, `Cotton`, `Girls`, or `Boys` as boutique identities.

### 5.4 Audience

The canonical audience values are:

```ts
type ProductAudience =
  | 'boys'
  | 'girls'
  | 'unisex_kids'
  | 'women'
  | 'men'
  | 'unisex_adult'
  | 'home'
  | 'unknown';
```

### 5.5 Onesie spelling and use

The standard spelling is used:

- Singular product type: `Onesie`
- Plural category/display label: `Boys Onesies`

Policy:

- `boys` plus romper/onesie/bodysuit source evidence becomes `Onesie`.
- `unisex_kids` plus romper/onesie/bodysuit source evidence becomes `Onesie`.
- `girls` plus explicit romper evidence remains `Romper`.
- A matching multi-piece outfit remains `Set`, even when one included garment is a onesie.

## 6. Proposed architecture

The pipeline should be divided into deterministic stages:

```text
Source scrape/import
        |
        v
Source normalization and source preservation
        |
        v
Category + audience resolution
        |
        v
Grounded product facts and product-type resolution
        |
        +----------------------+
        |                      |
        v                      v
Translation              Cached visual analysis
                               |
                               +------------+
                               |            |
                               v            v
                         Smart Name    Smart Description
                               |            |
                               v            v
                    Atomic name claim   Validation/fallback
                               |            |
                               +-----+------+
                                     v
                              Administrator review
                                     |
                                     v
                               Save/import product
```

No generated name may be displayed before the name-claim mutation succeeds.

## 7. Data-model changes

### 7.1 Extend `productNameClaims`

Add optional fields initially, then make them required for all new AI claims:

```ts
productNameClaims: defineTable({
  // Existing fields
  normalizedName: v.string(),
  displayName: v.string(),
  normalizationVersion: v.number(),
  status: v.union(
    v.literal('suggested'),
    v.literal('active'),
    v.literal('retired'),
  ),
  ownerKey: v.string(),
  productId: v.optional(v.id('products')),
  source: v.union(v.literal('ai'), v.literal('manual'), v.literal('migration')),
  requestId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  retiredAt: v.optional(v.number()),

  // New fields
  boutiqueIdentity: v.optional(v.string()),
  boutiqueIdentityKey: v.optional(v.string()),
  boutiqueIdentityNormalizationVersion: v.optional(v.number()),
  namingMode: v.optional(v.union(
    v.literal('boutique_identity'),
    v.literal('descriptive'),
    v.literal('legacy_unknown'),
  )),
  audience: v.optional(productAudienceValidator),
  productTypeKey: v.optional(v.string()),
})
  .index('by_normalized_name', ['normalizedName'])
  .index('by_boutique_identity_key', ['boutiqueIdentityKey'])
  .index('by_owner', ['ownerKey'])
  .index('by_product', ['productId']);
```

One claim document represents the atomic reservation of its complete title and optional boutique identity. A separate identity table is unnecessary unless performance testing shows the index insufficient.

### 7.2 Extend `productNameEvents`

Add the boutique identity fields and audience to every new event so an audit can explain why an identity became unavailable.

### 7.3 Extend source/category context

Change category hints to support the full selected assignment set:

```ts
type CategoryHints = {
  sourceCategory?: string;
  selectedCategory?: string;
  selectedSubcategory?: string;
  selectedSubcategoryIds?: string[];
  primarySubcategoryId?: string;
  selectedCollection?: ProductCollection;
  selectionSource?: 'admin_confirmed' | 'auto_suggested' | 'placeholder' | 'source';
};
```

### 7.4 Add resolved context to generation audits

Name and description audit records should store:

- resolved audience
- audience confidence
- evidence list
- resolved product type
- terminology rule used
- selected collection
- all selected subcategory IDs
- primary subcategory ID
- conflict warnings

### 7.5 Add visual-fact cache

Create `productAiFactCache`:

```ts
productAiFactCache: defineTable({
  snapshotHash: v.string(),
  imageSetHash: v.string(),
  model: v.string(),
  promptVersion: v.string(),
  visualFacts: v.array(v.any()),
  warnings: v.array(v.string()),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index('by_snapshot_hash', ['snapshotHash'])
  .index('by_image_set_hash', ['imageSetHash']);
```

Default expiry: 30 days. A changed image set or prompt version creates a new cache record.

## 8. Boutique-identity normalization

Add `normalizeBoutiqueIdentity` beside the existing complete-name normalizer.

Rules:

1. Unicode normalize using NFKC.
2. Trim leading/trailing whitespace.
3. Lowercase using locale-independent rules.
4. Convert apostrophe variants to a canonical apostrophe.
5. Collapse punctuation, separators, and whitespace.
6. Remove leading `the` only when the model incorrectly supplies it.
7. Reject empty values and values longer than 40 display characters.
8. Reject common descriptive/generic tokens from being classified as boutique identities.

Examples:

| Display identity | Key |
|---|---|
| `Poppy` | `poppy` |
| ` POPPY ` | `poppy` |
| `Mary-Jane` | `mary jane` |
| `Mary Jane` | `mary jane` |

The generic-token blocklist should include at least:

```text
baby, boys, boy, girls, girl, kids, children, cotton, linen, lace,
floral, embroidered, striped, fleece, ruffle, summer, winter,
dress, pants, shorts, set, top, chair, table, lamp, romper, onesie
```

## 9. Permanent uniqueness behavior

### 9.1 Authoritative rule

A candidate conflicts if either condition is true:

- Its normalized complete title exists in any product or exact-name claim.
- Its boutique identity key exists in any AI/migrated boutique-identity claim.

Claim status does not make a name reusable. `suggested`, `active`, and `retired` all block reuse.

### 9.2 Atomic reservation

Replace the current reservation input with:

```ts
reserveNameSuggestion({
  displayName,
  boutiqueIdentity,
  namingMode,
  audience,
  productTypeKey,
  ownerKey,
  requestId,
});
```

Inside one Convex mutation:

1. Normalize and validate the complete title.
2. Normalize and validate the boutique identity when present.
3. Query complete-title claims and product history.
4. Query boutique-identity claims.
5. If either conflicts, return a typed collision without writing.
6. Insert one suggested claim containing both keys.
7. Insert the corresponding event.
8. Return the claim ID and normalized keys.

Convex mutation serialization makes the read/check/write operation concurrency-safe when all reservation paths use this mutation.

### 9.3 Regeneration and same-draft history

Every intentional Smart Name click creates a new request ID. Before generation, load every prior suggestion for the owner key and exclude both its complete title and boutique identity.

The existing `forceFreshVariation` flag must no longer be informational. When true, validation must reject every prior full title and identity for that draft even if the global lookup has been truncated for prompt size.

### 9.4 Prompt limits versus enforcement

The prompt may receive a bounded list for token efficiency:

- all used boutique identity keys when reasonably sized
- otherwise a curated available pool plus owner history
- up to 40 recent similar complete titles for style diversity

The server must always validate against the full database. Prompt limits are never correctness limits.

### 9.5 Exhaustion behavior

If no unused boutique identity remains in the relevant pool:

- Do not append numbers to a repeated identity.
- Do not reuse an identity with a new product type.
- Try an expanded, curated audience-appropriate pool.
- If still exhausted, generate a unique descriptive title with `namingMode: 'descriptive'`.
- If neither mode can be reserved, return `NAME_RESERVATION_EXHAUSTED` with no suggestion.

## 10. Legacy boutique-identity migration

### 10.1 Dry-run classification

Create an internal migration query that classifies existing claims as:

- recognized boutique identity
- descriptive title
- ambiguous/manual review

Use the historical name pools plus a curated Louie Mae identity dictionary. Do not classify generic first words such as `Kids`, `Lace`, or `Embroidered` as boutique identities.

### 10.2 Repeated legacy identities

Existing repeated identities must be grandfathered without renaming products:

- Patch every confidently classified claim with the same identity key.
- Record a migration event and a `legacyDuplicateIdentity: true` audit flag where applicable.
- Any existing row for that identity blocks all future suggestions.
- Do not try to choose one existing product as the only legitimate owner.

### 10.3 Migration phases

1. Deploy optional schema fields and indexes.
2. Run dry-run report with counts and samples.
3. Review ambiguous classifications.
4. Backfill in bounded batches with checkpoints.
5. Verify that product descriptions and unrelated product fields are unchanged.
6. Enable boutique-identity enforcement for new suggestions.
7. Make AI-created identity fields required at the application boundary.

### 10.4 Readiness query

Extend product naming readiness with:

```ts
{
  products: number;
  exactClaims: number;
  claimsWithNamingMode: number;
  boutiqueIdentityClaims: number;
  ambiguousLegacyClaims: number;
  repeatedLegacyIdentityGroups: number;
  newClaimsMissingIdentityMetadata: number;
  completeTitleDuplicateGroups: string[][];
  readyForIdentityEnforcement: boolean;
}
```

## 11. Audience resolution

Implement `resolveProductAudience(snapshot, adminContext)` as a deterministic function.

### 11.1 Evidence precedence

From highest to lowest authority:

1. Administrator-confirmed subcategory IDs
2. Administrator-confirmed primary subcategory
3. Administrator-confirmed collection/category
4. Structured source attributes such as gender, applicable people, department, age group
5. Explicit title phrases such as `boys`, `girls`, `men`, or `women`
6. Explicit description phrases
7. Auto-suggested taxonomy
8. Unknown

A placeholder default has no authority and must never outrank source evidence.

### 11.2 Multiple subcategories

- Any Boys-only assignment resolves to `boys`.
- Any Girls-only assignment resolves to `girls`.
- Both Boys and Girls assignments resolve to `unisex_kids`.
- Adult men and women assignments together resolve to `unisex_adult`.
- Home/furniture/decor collections resolve to `home` unless stronger administrator evidence indicates the collection is wrong.

### 11.3 Conflicts

Return warnings such as:

```text
Selected collection is Furniture, but the source title explicitly says boys' clothing.
Confirm the collection before generating a name.
```

When administrator-confirmed context conflicts with source context, administrator context wins but the conflict remains visible in the audit.

### 11.4 Unknown audience

If the evidence is insufficient:

- Do not infer gender from pink, blue, floral, ruffles, model appearance, or similar stereotypes.
- Use the neutral pool only after the administrator confirms the category.
- Disable automatic Smart Name during import-auto mode until categorization is resolved.

## 12. Product-type and terminology resolution

Replace free-text regex-to-label behavior with a canonical product-type enum and a deterministic display-label resolver.

```ts
type CanonicalProductType =
  | 'romper_like'
  | 'dress'
  | 'top'
  | 'pants'
  | 'shorts'
  | 'set'
  | 'overall'
  | 'cardigan'
  | 'chair'
  | 'table'
  | 'storage'
  | 'lighting'
  | 'decor'
  | 'other';
```

`resolveDisplayProductType(type, audience, facts)` produces the display term. The model may not override this output.

Priority rules:

1. Matching/two-piece/three-piece/coordinated evidence resolves to `Set`.
2. Otherwise romper/onesie/bodysuit resolves to canonical `romper_like`.
3. `romper_like + boys` becomes `Onesie`.
4. `romper_like + unisex_kids` becomes `Onesie`.
5. `romper_like + girls` becomes `Romper`.
6. Unknown audience blocks automatic generation when the selected taxonomy matters to terminology.

## 13. Smart Name generation contract

### 13.1 Request

```ts
type SmartNameRequestV3 = {
  productId?: string;
  ownerKey: string;
  sourceSnapshot: SourceProductSnapshot;
  adminContext: {
    selectedCollection?: string;
    selectedSubcategoryIds: string[];
    primarySubcategoryId?: string;
    selectionSource: 'admin_confirmed' | 'auto_suggested' | 'placeholder';
  };
  generationMode: SmartGenerationMode;
  options: {
    allowImageAnalysis: boolean;
    forceFreshVariation: boolean;
  };
};
```

### 13.2 Structured response from the model/fallback

```ts
type GeneratedSmartNameDraftV3 = {
  name: string;
  boutiqueIdentity?: string;
  namingMode: 'boutique_identity' | 'descriptive';
  modifier?: string;
  productType: string;
  audience: ProductAudience;
  supportedByFactIds: string[];
  confidence: number;
  notesForAdmin?: string[];
};
```

### 13.3 Name-style pools

Maintain curated pools in configuration, not embedded repeatedly in prompts:

- boys: masculine and neutral boutique identities
- girls: feminine and neutral boutique identities
- unisex kids: neutral boutique identities
- women/adult fashion: collection-appropriate identities
- men/adult fashion: masculine and neutral identities
- home: optional design-led identities or descriptive naming

No identity may appear in more than one currently available pool after global exclusion is applied. Cross-pool overlap is acceptable in source configuration because the global identity registry remains authoritative.

### 13.4 Validation

Validate:

- two to five words according to the selected naming mode
- required deterministic product-type label
- boutique identity matches resolved audience policy
- boutique identity is not already claimed
- complete title is not already claimed
- title does not repeat the marketplace title
- modifier is grounded by verified facts
- risky material, certification, construction, and safety claims have direct evidence
- no banned marketplace phrasing
- no numeric suffix added merely to avoid collision

### 13.5 Fallback behavior

The deterministic fallback must receive:

- resolved audience
- deterministic product-type label
- all used boutique identity keys
- all prior owner suggestions
- grounded modifier candidates

It must return the first server-valid candidate. The fallback must never default to a feminine pool for unknown or home products.

## 14. Category suggestion redesign

Replace the current single-string category action with a structured action:

```ts
type CategorySuggestion = {
  collectionId?: string;
  subcategoryIds: string[];
  primarySubcategoryId?: string;
  audience: ProductAudience;
  canonicalProductType: CanonicalProductType;
  confidence: number;
  evidence: Array<{
    source: 'title' | 'description' | 'attribute' | 'variant' | 'admin';
    excerpt: string;
  }>;
  warnings: string[];
};
```

Requirements:

- Build the list of valid collection and subcategory IDs from the current taxonomy, not a hardcoded outdated category array.
- Permit multiple subcategory IDs.
- Return stable IDs, not display titles.
- Run deterministic keyword/attribute matching before optional model classification.
- Validate the model response against the current taxonomy.
- Never retain the existing collection when the only value is a placeholder default.

## 15. Product Import workflow changes

### 15.1 Initial state

- Change `targetCollection` from `collections[0] || 'furniture'` to an unresolved draft state.
- Display `Choose or confirm a collection`.
- Do not assign Furniture unless the user, source evidence, or validated categorizer selects it.

### 15.2 Import order

For each scraped product:

1. Preserve raw source fields.
2. Normalize source fields.
3. Translate necessary source/variant fields.
4. Suggest collection and multiple subcategories.
5. Resolve audience and product type.
6. Present category confirmation.
7. Enable Smart Name and Smart Description.

### 15.3 Button requirements

- Smart Name is disabled when collection, category, audience, or required product type is unresolved.
- Smart Description may run with unknown audience only if it does not produce audience-specific claims; otherwise request category confirmation.
- Changing collection/subcategories invalidates previous unresolved generation context.
- Existing reserved suggestions are not released or reused.

### 15.4 Context propagation

`buildSnapshotForImportProduct` must include:

- `targetSubcategoryIds`
- `primarySubcategoryId`
- selection source
- translated title and description separately from raw title and description
- structured source properties
- translated variant names and original variant names

## 16. Product Studio workflow changes

- Use the same source snapshot builder, audience resolver, type resolver, translation action, and name generator as Product Import.
- Remove fallback strings such as `Furniture` and `home decor` when context is absent.
- Auto Categorize must update collection, selected subcategory IDs, primary subcategory, and resolved audience together.
- If category inference suggests another collection, switch the draft collection only after showing the suggested change or when auto-enhance is explicitly enabled.
- Smart Name suggestions must display a small context line, for example: `Boys · Onesie · based on selected Boys category and source title`.

## 17. Translation redesign

### 17.1 Server-side action

Create an authenticated Convex action such as `translations.translateProductFields`.

Do not call MyMemory or another translation API directly from React.

### 17.2 Provider strategy

Use a provider interface:

```ts
interface TranslationProvider {
  translateBatch(items: TranslationItem[], from: string, to: string):
    Promise<TranslationProviderResult[]>;
}
```

Initial production strategy:

1. Apply the local glossary and structural parser.
2. Send unresolved segments to a separately budgeted production translation provider.
3. Preserve the source when the provider fails.
4. Return a typed partial result rather than silently succeeding.

The translation provider must not use the same small daily quota as Smart Name and Smart Description.

### 17.3 Variant parsing and glossary

Parse combined labels such as:

```text
颜色: 条纹 / 适合身高: 90cm
```

Translate key/value segments independently while preserving separators, numbers, units, and punctuation.

Initial glossary examples:

| Chinese | English |
|---|---|
| 颜色 | Color |
| 尺码 | Size |
| 适合身高 | Suitable Height |
| 条纹 | Stripe |
| 白色 | White |
| 黑色 | Black |
| 蓝色 | Blue |
| 红色 | Red |
| 粉色 | Pink |

The glossary must be versioned and unit-tested.

### 17.4 Output contract

```ts
type TranslationFieldResult = {
  field: 'name' | 'description' | 'variant';
  fieldId?: string;
  original: string;
  translated: string;
  status: 'translated' | 'unchanged' | 'failed';
  remainingSourceLanguage: boolean;
  provider?: string;
  errorCode?: string;
};

type TranslateProductResponse = {
  ok: boolean;
  complete: boolean;
  translatedCount: number;
  unchangedCount: number;
  failedCount: number;
  results: TranslationFieldResult[];
  warnings: string[];
};
```

### 17.5 Validation

- If the original contains Chinese and the result is identical, status is `unchanged`, not success.
- If the result still contains Chinese, set `remainingSourceLanguage: true`.
- Preserve numbers, sizes, SKUs, and URLs.
- Never overwrite a field changed by the user after the request started.
- Map variants by stable variant ID, not solely by label text.

### 17.6 Retry and timeout

- Eight-second provider timeout per batch.
- One retry for timeout, 429, or 5xx with jitter.
- No retry for authentication, invalid request, or unsupported language.
- Cap batch sizes and concurrency centrally.
- Return partial progress if some batches succeed.

### 17.7 Interface feedback

Examples:

```text
Translation complete: 8 fields translated.
```

```text
Translation partially complete: 5 of 6 labels translated. One label timed out and remains in Chinese.
```

```text
Translation unavailable: the translation service did not respond. No fields were changed.
```

## 18. Smart Description hardening

### 18.1 Production quota

Provision a billed production quota for the Google project used by Convex. Confirm that `GEMINI_API_KEY`, `SMART_DESCRIPTION_MODEL`, and `SMART_NAME_MODEL` belong to the intended production project.

Do not depend on a 20-request-per-day free-tier quota for an import pipeline.

### 18.2 Typed provider errors

Normalize provider failures to:

```ts
type AiProviderErrorCode =
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'TIMEOUT'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN_PROVIDER_ERROR';
```

Do not return the provider's raw JSON error to the browser.

### 18.3 Safe fallback on exceptions

The current safe fallback is reached for malformed/invalid model output but not for thrown text-generation errors. Change the action flow:

1. Normalize source.
2. Load or attempt visual facts.
3. Extract deterministic facts.
4. Attempt model generation.
5. If generation throws a recoverable provider error, build the safe fallback.
6. Validate the fallback.
7. Create the description audit with provider error metadata.
8. Return `ok: true`, `fallbackUsed: true`, and a user-facing warning.

Only return `ok: false` when source facts are insufficient to build safe copy, authorization fails, or audit persistence fails.

### 18.4 Shared visual analysis

Name and description generation currently perform image analysis independently. Replace this with:

- cache lookup by snapshot/image-set hash
- one visual analysis request on cache miss
- shared normalized fact object for combined enhancement
- cached facts reused by separate manual buttons

### 18.5 Combined enhancement action

Add a server orchestration action for `Enhance with AI` that:

1. Normalizes once.
2. Resolves category/audience once.
3. Loads/analyzes images once.
4. Extracts facts once.
5. Generates and reserves the name.
6. Generates or falls back for the description.
7. Returns independent name and description results so one may succeed when the other fails.

### 18.6 Quota and circuit behavior

- Record every request using the existing AI usage instrumentation.
- When quota is known exhausted, skip repeated model calls for a short circuit period and use deterministic fallbacks immediately.
- Do not retry quota-exhausted requests five times.
- Show provider state in the admin health panel.

## 19. User-interface states

Every Translate, Smart Name, Smart Description, and combined Enhance button must support:

- idle
- validating context
- working
- success
- partial success
- safe fallback
- actionable failure

Requirements:

- Disable repeated clicks while the current request is active.
- Preserve the latest administrator edits with request-start snapshots.
- Show the resolved audience and product type before applying a Smart Name.
- Show `Fallback copy used—AI quota unavailable` when appropriate.
- Include a Retry action only for retryable failures.
- Never show generic `failed` text when a typed reason exists.

## 20. Observability

### 20.1 Structured events

Log these events with request ID, owner key, product ID when available, and duration:

- `category_resolution_started/completed/conflicted`
- `translation_started/completed/partial/failed`
- `visual_analysis_cache_hit/miss/failed`
- `smart_name_started/model_failed/fallback_used/collision/reserved/failed`
- `smart_description_started/model_failed/fallback_used/generated/failed`

Do not log full raw descriptions, API keys, tokens, or complete third-party payloads.

### 20.2 Metrics

Track:

- Smart Name success rate
- model versus fallback rate
- complete-title collision rate
- boutique-identity collision rate
- average attempts before reservation
- audience conflict rate
- translation completion/partial/failure rate
- remaining-Chinese rate
- Smart Description provider-error and fallback rate
- image-analysis cache hit rate
- requests per product enhancement

### 20.3 Admin health panel

Display:

- current AI provider state
- quota/rate-limit warning state
- translation provider state
- recent fallback percentage
- recent translation partial-failure percentage
- count of unresolved category-context conflicts

## 21. Security and privacy

- Keep all AI and translation credentials server-side in Convex environment variables.
- Do not expose translation provider keys in Vite/client variables.
- Require verified CJ admin identity for generation and translation actions.
- Clamp source text, attribute counts, image counts, and batch sizes.
- Continue treating source/vendor text as untrusted product data, not instructions.
- Sanitize provider errors before returning them to the browser.
- Keep source and translated fields separately for traceability.

## 22. Test plan

### 22.1 Unit tests: normalization and identity

- Case, spacing, punctuation, and Unicode variants normalize to the same boutique identity.
- `Mary-Jane` and `Mary Jane` conflict.
- Generic descriptive words are not classified as boutique identities.
- AI-generated identity metadata is required before reservation.

### 22.2 Unit tests: audience

- Boys subcategory resolves to boys.
- Girls subcategory resolves to girls.
- Boys plus Girls resolves to unisex kids.
- Structured gender attribute resolves correctly.
- Explicit source title beats a placeholder Furniture default.
- Administrator-confirmed Furniture beats conflicting source text but emits a warning.
- Color or visual styling alone does not assign gender.

### 22.3 Unit tests: terminology

- Boys romper becomes Onesie.
- Boys bodysuit becomes Onesie.
- Unisex romper becomes Onesie.
- Girls romper remains Romper.
- A two-piece boys' outfit containing a bodysuit remains Set.

### 22.4 Unit tests: name generation

- Masculine/neutral identity for boys.
- Feminine/neutral identity for girls.
- Neutral identity for dual-category kids.
- No feminine fallback forced onto boys/home.
- Modifier requires evidence.
- Deterministic fallback respects all identity claims.
- Pool exhaustion switches to descriptive naming without numeric suffixes.

### 22.5 Concurrency tests

- Two requests for the same complete title: one succeeds.
- Two different titles with the same boutique identity: one succeeds.
- Cross-category requests with the same identity: one succeeds.
- Suggested identity blocks another draft immediately.
- Retired identity remains blocked.
- Concurrent save and regeneration cannot activate two owners.

### 22.6 Translation tests

- Glossary translation preserves numbers and units.
- Provider timeout retries once.
- Identical Chinese response is `unchanged`.
- Partial batches return partial success.
- Stable variant IDs receive the correct translations.
- Edits made during translation are preserved.
- No provider credentials enter the browser bundle.

### 22.7 Smart Description tests

- Gemini 429 produces validated safe fallback copy.
- Timeout produces safe fallback copy.
- Authentication error remains a failure.
- Insufficient source facts produce an actionable failure.
- Image analysis is performed once for combined enhancement.
- Cached image facts are reused.
- Audit records provider error, fallback reason, audience, and product type.

### 22.8 Component tests

- Import begins with unresolved collection rather than Furniture.
- Smart Name is disabled until required context is confirmed.
- All selected subcategory IDs are included in the action request.
- Partial translation warning lists the remaining count.
- Smart Description fallback is visibly distinguished from model-generated copy.
- Buttons always leave their loading state after success or failure.

### 22.9 End-to-end production-like scenarios

1. Import a boys' romper source with Chinese variants.
2. Confirm automatic suggestion of Kids + Boys + Boys Onesies when that taxonomy exists.
3. Confirm English variant labels or explicit partial warning.
4. Generate an audience-appropriate unique name ending in `Onesie`.
5. Generate again and confirm both title and boutique identity change.
6. Open another category and verify neither prior identity can be reused.
7. Simulate Gemini 429 and verify safe description fallback.
8. Assign both Boys and Girls subcategories and verify neutral audience behavior.
9. Save the product and verify both full-title and identity claims activate.
10. Delete/rename in a test deployment and verify both remain unavailable.

## 23. Acceptance criteria

The release is acceptable only when all conditions pass:

### Naming

- 100 consecutive Smart Name requests across mixed categories produce 100 unique normalized complete titles.
- The same run produces 100 unique boutique identity keys for boutique-style names.
- No suggested, active, retired, renamed, or deleted identity is reused.
- Exact and boutique-identity enforcement succeeds under concurrent generation.
- A returned name is already reserved before the interface displays it.

### Audience and terminology

- Boys' one-piece sources always use `Onesie`, never `Romper`.
- Boys' products never use a feminine-only name pool.
- Dual Boys/Girls assignment uses neutral naming.
- Placeholder Furniture context cannot override explicit boys/girls source evidence.
- Every selected subcategory is represented in generation context and audits.

### Translation

- No browser request is made directly to MyMemory or another translation provider.
- A successful response contains no remaining Chinese in requested translated fields.
- Partial translation is visibly reported and preserves successful fields.
- Timeouts never result in a false success message.

### Smart Description

- Provider 429 and timeout responses return validated safe fallback copy when sufficient facts exist.
- The administrator sees that fallback was used and why.
- Combined name/description enhancement performs at most one visual-analysis request per snapshot cache miss.

### Migration and regression safety

- All 449 baseline products retain their descriptions, prices, images, variants, and category assignments unless explicitly migrated.
- Exact full-title duplicate groups remain zero.
- All recognized historical boutique identities block future use.
- Full test suite, type check, production build, and client-secret scan pass.

## 24. Rollout plan

### Phase 0: Operational recovery

- Provision production AI quota/billing.
- Verify production model and API-key project alignment.
- Add provider health visibility.

### Phase 1: Compatibility schema

- Deploy optional boutique-identity metadata and indexes.
- Deploy expanded category hints and audit fields.
- Deploy visual-fact cache schema.
- Keep enforcement disabled.

### Phase 2: Deterministic foundations

- Implement audience resolver.
- Implement canonical product-type resolver.
- Implement `Onesie` terminology rules.
- Implement identity normalization and validation.

### Phase 3: Translation and description reliability

- Move translation server-side.
- Add glossary, typed partial results, retries, and output validation.
- Add Smart Description provider exception fallback.
- Add shared visual-fact cache.

### Phase 4: Naming migration

- Run boutique-identity dry run.
- Review ambiguous records.
- Backfill legacy claim metadata.
- Verify product-field checksums.

### Phase 5: Enforcement and interface

- Enable global boutique-identity enforcement.
- Remove Furniture placeholder default.
- Connect structured categorization to Product Import and Product Studio.
- Add context/fallback/partial-result interface states.

### Phase 6: Verification

- Run concurrency and 100-generation tests in development.
- Run complete automated suite.
- Deploy to preview and execute authenticated end-to-end scenarios.
- Run migration readiness in production before enabling enforcement.
- Deploy production with a kill switch for AI generation, not for name uniqueness.

### Phase 7: Post-release monitoring

- Monitor for 72 hours.
- Alert on any exact-title or boutique-identity collision.
- Alert when translation partial/failure rate exceeds 5% over 30 minutes.
- Alert when Smart Description fallback exceeds 20% over 30 minutes.
- Review unresolved audience conflicts daily during the monitoring period.

## 25. Rollback strategy

- Schema additions remain backward-compatible and should not be removed during rollback.
- If generation quality regresses, disable Smart Name/Smart Description buttons through existing feature flags.
- Never disable or roll back exact-title or boutique-identity collision checks after enforcement begins.
- Translation may fall back to glossary-only mode if the provider fails.
- Existing claims created during the release remain permanently reserved even if application code rolls back.
- Rollback must not delete migration events, claims, audits, or source fields.

## 26. Work breakdown

### Backend/data

- Schema and indexes
- Identity normalization
- Claim reservation changes
- Owner-history query
- Audience resolver
- Product-type resolver
- Category suggestion V2
- Translation action/provider/glossary
- AI provider error normalization
- Description fallback-on-exception
- Visual-fact cache
- Readiness and migration functions
- Metrics and admin health queries

### Frontend

- Unresolved initial collection state
- Categorization-before-generation workflow
- All-subcategory context propagation
- Typed translation feedback
- Audience/product-type context display
- Smart Name/Description fallback states
- Actionable errors and retry behavior
- Loading and stale-response protection

### Quality and operations

- Legacy migration dry run
- Product-field checksum tooling
- Unit, component, concurrency, and end-to-end tests
- Production quota verification
- Preview deployment verification
- Production readiness gate
- Post-release alerts and monitoring dashboard

## 27. Definition of done

This work is done only when:

1. The migration readiness report is green.
2. Production AI quota is suitable for expected import volume.
3. Translation no longer depends on a browser-side free endpoint.
4. Smart Description remains useful during provider failure.
5. Every Smart Name is grounded in resolved audience, product type, attributes, description, and all selected subcategories.
6. Boys' romper-like products use `Onesie`.
7. Complete titles and boutique identities are permanently unique across every category.
8. Automated and authenticated live tests pass.
9. No unrelated product data changes during migration.
10. The admin interface clearly distinguishes generated, fallback, partial, and failed results.

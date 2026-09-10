# Shared Import Studio and CJ Product Generation Workflow

Status: Implementation-ready proposal; no runtime implementation or deployment authorized by this document itself.
Prepared: September 10, 2026
Repository baseline: `33624ccf608a9666ef9de4da189092e9c65be6ab` (production changes through PR #97).
Reference experience: `components/ProductImport.tsx`, the Import Product curation studio also used by Admin Add/Edit.

## 1. Outcome and meaning of exact parity

CJ Settings must use the same supplier retrieval, source preparation, Smart Name, Smart Description, image analysis, brand rules, validation, warnings, and review controls as Import Studio. Sharing only the final AI endpoint is insufficient.

A product opened through Import, Add/Edit, or CJ Settings must produce the same canonical generation request when its source revision, selected variants, selected images, and administrator context are equal. AI wording may differ because fresh variation is enabled; request parity does not mean identical stochastic output.

Use Import Studio's existing Details & Story panel as the visual and interaction baseline. Extract it into reusable components rather than copying its markup into a second implementation. Preserve the surrounding CJ mapping workspace and Import Studio's batch navigation. Do not redesign the whole administration console.

The only necessary differences are contextual: an unsaved import has a draft identity; an existing product has a product ID and revision; a proposed split has an explicit selected-variant scope and a future child identity. These differences must not change the generation algorithm.

## 2. Verified baseline and regression boundaries

- Import URL handling calls `api.scraper.scrapeProduct`. For 1688, `convex/scraper.ts` retrieves OTAPI `BatchGetItemFullInfo` with the Description block and `GetItemDescription` concurrently. Non-1688 sources retain the existing supported scraper path.
- `ProductImport.buildSnapshotForImportProduct` passes supplier title, source descriptions, detail text, product and detail images, variant labels, structured OTAPI properties, category context, currency, and supplier metadata.
- Its description button uses already-fetched data. It does not make a new OTAPI request on every click.
- `CJListingReview` calls the same `smartDescriptions.generateSmartDescription` action but sends only current name/description, listing photos, variants, and limited context. It does not fetch OTAPI data.
- Import Studio exposes source quality, warnings, and fallback status. CJ does not expose equivalent feedback.
- Product persistence supports `rawSourceDescription`, `rawHtmlDescription`, and `descriptionImages`, but not the structured `sourceProperties` used by the import draft. Source evidence therefore degrades after saving.
- `buildCjProductSplit` does not carry these source-description fields into the child. The new split editor starts with empty copy.
- PR #96 introduced the thin CJ generation adapter. PR #97 preserved grouped variant values and offered later CJ photos in import curation; it did not repair source retrieval or persistence parity.
- The shared AI provider selection, prompt, validators, fallback writer, and scraper were not changed by PRs #96–97.

Historical repository documentation reports provider quota problems. Treat that as historical context only. Inspect current generation audits and provider configuration before asserting the present cause of an AI failure.

## 3. Scope

### Required

1. A shared, server-controlled source retrieval and preparation service.
2. Persistent source evidence that survives import, edit, split, reload, and later CJ approval.
3. One canonical request builder for Smart Name and Smart Description.
4. Shared Details & Story generation controls, progress, warnings, and review behavior.
5. Strict separation of source evidence, administrator facts, generated suggestions, and published copy.
6. Variant-scoped generation for split listings, including image evidence from import and CJ.
7. Explicit recovery for legacy products with incomplete source data.
8. Correct generation audit linkage and transactional product saves.
9. Tests that compare requests across entry points and verify the complete live flow.

### Excluded

Changing retail pricing, inventory policy, fulfillment mappings, supplier sourcing requests, product publication rules, translation-provider selection, category taxonomy, or the model/billing plan. No automatic catalog-wide rewriting or publishing. No promise to recover facts the supplier does not provide.

## 4. Target architecture

Use the following responsibility boundaries; module names are proposed and may be adjusted consistently during implementation.

| Module | Responsibility |
| --- | --- |
| `convex/productSources.ts` | Admin source preparation action, private snapshot queries/mutations, retrieval reuse, source refresh, authorization. |
| `lib/productSourceAdapters.ts` | One adapter for each existing scraper result shape, including OTAPI attributes, descriptions, images, and configured variants. Reused by single import and batch import. |
| `lib/productGeneration.ts` | Pure canonical builder: immutable source evidence + selected scope + explicit administrator facts/context -> `SourceProductSnapshot`. |
| `convex/smartNames.ts`, `convex/smartDescriptions.ts` | Existing generation engines, name registry, image analysis, validation/repair, and audits. No CJ-specific prompt or model. |
| `components/product/DetailsAndStory.tsx` | Extracted Import Studio copy controls and layout, used by Import, Add/Edit, CJ review, and split review. |
| `components/product/useProductGeneration.ts` | Shared request state machine and response handling, with stale-result protection. |
| `convex/products.ts`, `lib/cjProductSplit.ts` | Transactional save/split, scope validation, source/audit references, and optimistic concurrency. |

The generation action must prepare or load source evidence on the server. Do not rely on a particular frontend remembering to include every source field. Keep raw provider credentials and source retrieval server-side.

Before removal, migrate every active generation call site: single-URL import, batch preparation, per-product smart buttons, bulk enhancement, Admin Add/Edit, CJ final review, and split review. Audit `ProductStudio.tsx` for remaining callers; migrate it if reachable, otherwise document it as legacy. Do not leave a second request builder available for future reuse.

## 5. Source storage and contracts

### 5.1 Immutable supplier snapshots

Introduce an admin-only `productSourceSnapshots` table. A snapshot is shared evidence for a supplier listing, not a published product description. Store normalized, bounded fields rather than an unbounded full provider response.

Required fields:

- `schemaVersion`, `adapterVersion`, `canonicalSourceUrl`, provider/platform, source item ID where supplied, retrieval timestamp, and content hash.
- Original and translated titles where available.
- Clean source description and sanitized HTML-derived detail text. Preserve useful text/tables; never render unsanitized supplier HTML.
- Structured attributes with key, value, evidence origin, confidence, and scope: listing-wide, identified source variant(s), or unknown.
- Product/gallery images and detail images, normalized and deduplicated, with original order and source origin.
- Source variants with stable provider IDs, names, option values, and associated images where available.
- Available supplier metadata and original price/currency as evidence only; not retail-pricing updates.
- Retrieval status (`complete`, `partial`), missing sections, and sanitized warnings.

Do not store API keys, authorization headers, or credential-bearing URLs. Large debug payloads, if needed, belong in restricted storage with explicit retention; generation must work without them. Bound array/text sizes to fit Convex document and request limits. Reject truncation silently changing scope; record truncation warnings.

Maintain a private source-cache index keyed by provider + canonical source item identity + adapter version. Its current pointer can advance to a new immutable snapshot. Old snapshots remain addressable while referenced by products or generation audits. Avoid deleting referenced evidence during cleanup.

### 5.2 Product and draft references

Add optional, typed fields to product storage, create/update validators, import adapters, and TypeScript product types:

- `sourceSnapshotId`: authoritative evidence revision selected for this product.
- `sourceParentProductId`: split lineage when known.
- `sourceVariantScope`: explicitly matched source-variant IDs, if verified.
- `sourceScopeStatus`: `whole_listing`, `confirmed_subset`, or `needs_confirmation`.
- `sourceEvidenceOverrides`: administrator-confirmed facts and image associations; never generated prose masquerading as facts.

Keep `cjVariantScope` as the existing fulfillment boundary. CJ VIDs and OTAPI variant IDs are different namespaces; never compare them directly or invent an ID correspondence.

Unsaved import/split drafts carry a stable draft ID, source reference, image selection, variant selection, and generation revision. Source preparation must not create a sellable product merely to obtain a snapshot.

Legacy text/image fields remain readable during migration. The canonical builder prefers the selected snapshot; do not merge conflicting duplicate sources without a warning. Public storefront queries must not expose raw supplier snapshots or audit/debug records.

### 5.3 Typed preparation and generation results

Replace unconstrained frontend request construction with validated contracts. A preparation request includes the product ID or authorized draft context, expected product revision when applicable, normalized source URL, current snapshot reference, retrieval mode (`reuse_or_fetch` or `refresh`), and a request ID.

A result distinguishes: ready, partial-but-usable, needs-source-confirmation, and failed. Return snapshot ID, source revision/hash, fetched/reused indicator, warnings, and missing evidence. Absence is not represented as an empty successful product.

A generation request adds operation (`name` or `description`), selected scope, chosen images, explicit administrator facts/context, and draft revision. Existing product facts/scope must be checked against stored data. The server must verify that snapshot references and selected IDs belong to the authorized source context.

Return actual model, prompt version, source hash, audit ID, validation, warnings, fallback reason, and typed provider error/retryability where relevant. Stop recording placeholders such as `server-configured` and `pending-link` when authoritative values are available.

## 6. Shared retrieval and generation sequence

1. Capture the draft revision, selected variants/photos, and administrator category context.
2. Authorize the administrator before retrieving snapshots, making provider calls, or reserving a name.
3. Resolve the original supplier URL. A CJ product URL is not a substitute for the original 1688 URL. If no supported source exists, offer manual verified facts and selected images with a visible limited-source status.
4. Reuse a compatible complete source snapshot. If none exists, required sections are missing, or the URL/adapter identity changed, run the existing scraper through the shared adapter.
5. For 1688, retain the current two OTAPI calls, timeout behavior, response unwrapping, text cleaning, property extraction, and detail-image extraction. A missing description response must be represented as partial retrieval, not a successful empty description.
6. Allow an explicit **Refresh supplier details** action in every entry point. Do not fetch OTAPI on every Smart Description click. A failed refresh retains the prior snapshot and reports the failure. Do not repeatedly refetch a known incomplete source on each click without a retry decision.
7. Persist the retrieved immutable snapshot and return its identity. Concurrent preparation for the same source should reuse a completed result or a bounded in-flight retrieval lease. Avoid duplicate provider requests while allowing recovery after lease expiry.
8. Resolve the selected style scope and exclude incompatible sibling products and photos.
9. Build the canonical source snapshot with the same shared function for every surface.
10. Call the existing smart engine with common model/prompt settings, image analysis enabled, SEO options for descriptions, and fresh variation enabled. Preserve existing uniqueness and audience rules for Smart Name.
11. Validate and, where appropriate, repair the model output using the existing shared validators. Do not weaken unsupported-claim checks to obtain longer prose.
12. Return a suggestion and visible generation status. Persist product copy only through the explicit product save workflow.

Partial retrieval can still support generation if sufficiently grounded facts exist. The UI must say which source sections were unavailable. Missing fabric, care, closure, or dimensions must never be invented from colors or photographs.

## 7. Canonical evidence rules

Use the supplier's original title as source evidence. Keep the administrator's chosen display name separate. Neither an existing AI-generated name nor generated description is a substitute for the original supplier facts.

Evidence precedence:

1. Explicit administrator-confirmed facts for this product/scope.
2. Verified supplier attributes and text applicable to this scope.
3. Relevant source/variant images and their approved low-risk visual facts.
4. Explicitly identified uncertainty; do not convert guesses into factual claims.

Preserve raw source text, cleaned HTML-derived text, structured properties, detail images, source currency, selected category/subcategory IDs, primary subcategory, collection, and audience. Align these fields across manual, automatic, and batch generation. Audit current normalization to ensure category selection provenance and audience are not dropped in a second normalization pass.

Build one gallery from normalized URLs while retaining origin and ordering. Pass selected listing images, explicitly selected variant photos, and relevant detail images. Include appropriate later CJ variant photos. Exclude deselected styles and unrelated sibling imagery from split generation. The available picker gallery and the images used as AI evidence are separate concepts: an image being available does not mean it should influence the current listing.

This scope rule is a deliberate correction applied to BOTH surfaces: today's import builder passes all draft images/variants without consistently enforcing curation selections. Exact parity must use the same corrected selection rules, not reproduce mixed-product contamination.

Keep raw variants and normalized grouped variants semantically equivalent through repeated normalization. Preserve the PR #97 regression test.

## 8. Split and final CJ mapping behavior

- A child inherits a reference to the full supplier snapshot and explicit lineage, not a blindly copied multi-product marketing description.
- Its generation scope contains exactly the selected CJ variants and explicitly matched customer options, plus verified source-variant associations where available.
- Unambiguous image/option correspondences may be proposed. Do not treat matching size alone, similar names, or shared supplier URL as proof that two variants are the same dress.
- If source attributes apply to the whole supplier listing but may differ across styles, mark them unknown for the child until confirmed. For example, do not apply a cotton claim from another dress to every child.
- An administrator can confirm applicable source facts or retry with selected photos and limited facts. The panel explains why a detail is excluded.
- Preserve the original source snapshot for the remaining parent; update only its scope. Repeated splits must leave each child independently traceable.
- After later CJ verification, add new photos as available choices without replacing imported selections, image order, variant images, names, descriptions, prices, or stock choices.
- OTAPI refresh is a read/retrieval operation. It must not re-source through CJ or modify fulfillment identifiers.

## 9. Shared Import Studio panel and interaction contract

Extract the existing Details & Story controls and feedback presentation from ProductImport. Import, Add/Edit, CJ final review, and the split editor render that shared panel with the same control names and behavior. Existing surrounding themes may supply colors; field order, button behavior, status information, and review semantics must match.

Required controls:

- Editable product name and Smart Name.
- Editable description and Smart Description.
- Source URL/identity and retrieval state, with Refresh supplier details and last successful retrieval time.
- Source quality and actionable warnings, consistent with Import Studio.
- Explicit fallback/error state; detailed audit IDs may live in an expandable diagnostic section.
- The existing image curation/variant assignment workflow, with saved import, supplier-detail, and later CJ photos identifiable.

Generation states: idle -> loading supplier details (when necessary) -> preparing selected product -> generating -> ready, limited draft, or failed. Keep the administrator's current text intact on failures.

A successful, validated AI result may populate the editable draft, matching Import Studio's direct-edit workflow. Both surfaces must adopt the same safer fallback behavior: show fallback as a limited suggestion with **Use this draft**; do not silently overwrite useful existing copy. For a blank draft, still identify limited output before acceptance. This is an intentional shared correction to current behavior, not a CJ-only divergence.

Examples of user-facing messages:

- “Supplier details loaded. Ready to generate.”
- “The supplier description could not be loaded. You can retry or continue with the available facts and selected photos.”
- “AI generation is unavailable. Your description has been kept.”
- “Limited draft available. Review it before using it.”
- “Choose which supplier details belong to this dress before generating.”

Do not display raw provider errors, secrets, or a generic success toast for a provider failure. Quota exhaustion must not invite unlimited immediate retries. Busy controls, keyboard focus, accessible status announcements, and visual labels must work in both themes and on narrow screens.

## 10. Fallback quality and operational diagnosis

The existing fallback writer copies fact values directly, which produces fragments such as “pink” and “blue.” Retain the safety constraint but compose supported facts into grammatical detail lines, combine colors into one appropriate line, deduplicate facts, and exclude placeholders such as “Option: Option.”

Do not pad sparse evidence with repeated generic brand sentences. If there are too few meaningful product-specific facts, return an insufficient-evidence state instead of claiming a full description is ready. Share the quality gate and fallback composer across all entry points.

Operational diagnosis is mandatory before release: inspect actual failed audits, current configured model, provider error category, and image-analysis warnings. Confirm whether failures come from quota, authentication/configuration, timeout, invalid output, or validation rejection. Do not change paid plans, credentials, or models as an implicit part of this implementation. Report any external limitation that still prevents normal generation.

## 11. Persistence, audits, and concurrency

- Generation itself does not save listing copy or publish a product.
- Saving an existing CJ review remains one transaction for name reservation, description/audit metadata, gallery, customer variants, and CJ mappings.
- Validate expected product revision and snapshot/scope identity. Reject stale saves without partial product changes.
- Splitting creates the child and updates the parent atomically, preserving current CJ job/scope protections and hidden child status.
- Associate accepted description audits with the correct product, including a child created after generation. Do not attach a child draft's audit to its parent. Keep generated text separately from the edited final text and record administrator edits accurately.
- Smart Name suggestions retain existing permanent reservation semantics. A discarded suggestion must not accidentally release an identity that existing policy treats as used.
- Fingerprint requests using source content revision, selection, facts, category context, and draft revision. A late response after edits, selection changes, refresh, navigation, or unmount cannot replace the current draft.
- Exclude transient timestamps and unrelated inventory updates from semantic equality/hash inputs. Include selected image changes and relevant source changes.
- Source-fetch cache writes may complete even when a product save later conflicts; they are evidence cache entries, not partial product mutations.

## 12. Legacy recovery and migration

Use additive schema changes and backward-compatible readers first. Do not bulk regenerate or rename products during migration.

For an existing product:

1. Reuse a compatible source snapshot if present.
2. Recover source evidence from the associated import record or description audit if it is unambiguously linked and contains suitable original evidence. Preserve provenance; never relabel generated text as supplier text.
3. Otherwise fetch the original source URL through the shared loader.
4. If unavailable, show the missing evidence and allow manual verified facts. Do not silently replace sourceUrl or infer a different supplier listing.

For split products, recover lineage only from explicit records or verifiable identifiers; identical source URLs alone do not establish parentage. If source-variant matching is unresolved, retain the CJ scope and ask for fact/image confirmation inside the shared panel.

Provide an admin-only dry-run report with counts for reusable snapshots, recoverable legacy records, required fetches, ambiguous split scopes, and missing URLs. Apply backfill in bounded resumable batches with rate limits and idempotent references. No product prose or publication changes. Start with on-demand recovery for selected products before any broad backfill.

## 13. Implementation sequence and affected files

1. Add typed source contracts, shared adapters, and immutable source storage; tests first for OTAPI response shapes and evidence preservation.
2. Route single and batch import retrieval through the adapters. Retain `scraper.ts` as the existing network integration; avoid duplicating its OTAPI calls.
3. Add canonical scoped request building and update both smart actions to use prepared evidence and return authoritative metadata.
4. Update product schema/validators, `types.ts`, import draft types, create/update field allowlists, import conversion, and split persistence. Verify `contexts/BlogContext.tsx` and Admin save adapters do not drop the new references.
5. Extract the shared Details & Story panel and generation hook. Replace `buildSnapshotForImportProduct` and CJ's inline snapshot assembly. Update automatic and bulk generation as well as visible buttons.
6. Add scope confirmation, later-CJ-image availability, fallback review behavior, and source refresh controls in both surfaces.
7. Add legacy recovery, audits, parity tests, and operational diagnostics.
8. Validate, review, and release backend-compatible changes before the frontend begins requiring them.

Existing files requiring inspection or changes: `ProductImport.tsx`, `CJListingReview.tsx`, `CJProductSplit.tsx`, `CJVariantManager.tsx`, `ProductStudio.tsx` if active, `lib/batchImportProduct.ts`, `lib/cjProductSplit.ts`, `lib/smartDescription.ts`, `convex/scraper.ts`, `convex/batchImports.ts`, `convex/products.ts`, `convex/schema.ts`, `convex/sourceProductNormalizer.ts`, `convex/smartDescriptions.ts`, `convex/smartNames.ts`, `convex/descriptionAudits.ts`, and product/draft types.

## 14. Acceptance tests

| ID | Scenario | Required result |
| --- | --- | --- |
| P1 | Same evidence and selection opened in Import, Edit, CJ, and split draft | Canonical requests equal after removing request/draft/product identity fields. Same generation options and panel behavior. |
| P2 | Single URL import versus batch import of the same OTAPI fixture | Identical normalized source facts, attributes, image origins, and variant options. |
| P3 | 1688 item Description block, GetItemDescription, and response-envelope variations | All supported existing response shapes produce preserved evidence; partial failures are explicit. |
| P4 | Save import, unmount, reopen in CJ | Raw source evidence, structured properties, detail images, source revision, and chosen photos remain available. |
| P5 | Mixed listing with 84 variants; select one seven-size dress | Exactly those seven variants and applicable facts/images reach generation. Other dresses' colors, materials, and details do not leak. |
| P6 | Create child, then repeat split | Independent child scopes, correct parent remainder, stable evidence provenance, hidden children, unchanged prices and exact mappings. |
| P7 | CJ later returns additional images | New images appear as choices in both surfaces; saved gallery and variant assignments stay selected and unchanged. |
| P8 | Click Smart Description repeatedly with complete source | Source snapshot reused; no unnecessary OTAPI calls. Fresh AI variation remains permitted. |
| P9 | Refresh fails or source data is partial | Existing evidence and description preserved; actionable source warning shown; bounded retry behavior. |
| P10 | Provider quota, timeout, invalid JSON, or validation rejection | Accurate result category; no misleading success or silent overwrite; same behavior across surfaces. |
| P11 | Sparse/color-only facts | No bare-color description fragments or invented product details. Grammatical limited draft or insufficient-evidence result. |
| P12 | Administrator edits while generation is pending, switches product, or changes selected photos | Late result discarded; no wrong-product update or stale overwrite. |
| P13 | Product changed concurrently before save/split | Revision conflict with no partial product mutation. |
| P14 | Name reservation and split audit save | Accepted claim/audit belongs to child; parent claim untouched; manual edits tracked. |
| P15 | Unsupported/private URL or unauthorized caller | Existing URL protections and admin authorization enforced; no provider call or evidence exposure. |
| P16 | Source refresh or metadata recovery | No sourcing request, inventory change, price rewrite, mapping change, or publication side effect. |
| P17 | Legacy saved product missing structured properties | Recover/refetch through the same source path; incomplete state never silently presented as complete. |
| P18 | Grouped variants normalized twice | Style and size values survive; no `Option: Option` regression. |
| P19 | Keyboard and narrow-screen use | Shared buttons, warnings, acceptance controls, and photo choices remain usable and clearly labeled. |

Golden request tests should compare semantic data, not prose snapshots. Mock provider output for deterministic UI tests; use a live source and real generation separately to verify service health and output quality.

## 15. Release and live verification

- Implement in an isolated branch without including unrelated workspace changes.
- Run focused tests, full test suite, lint, frontend type check, strict Convex type check, production build, and client-secret scan.
- Open a ready-for-review PR using the default branch. Follow the repository's natural CodeRabbit workflow; do not manually trigger a review without the user's request. Resolve current actionable findings; report skipped review honestly.
- Deploy compatible backend changes before promoting the frontend. Verify source-storage indexes and any migration limits. Preserve old read paths until recovery is verified.
- Live-test a hidden product: load source evidence through Import, open the same product in CJ, compare evidence/selection, generate real copy, review it, save, and reopen to confirm persistence.
- Live-test a mixed source listing without publishing it. Verify split-scoped evidence, source retrieval reuse, later CJ image availability, and correct audit linkage.
- Include an explicit provider-failure test in a controlled environment. Do not deliberately exhaust production quota.
- Record deployed commit, source snapshot revision, audit IDs, provider outcome, tests, and any remaining limitations. Do not claim generation quality is complete merely because a fallback string saved successfully.
- Rollback must preserve source records and existing products. Old frontend readers continue to work with additive fields; rolling back UI must not require deleting snapshots or reversing product splits.

## 16. Definition of done

There is one shared workflow for retrieving supplier evidence and generating product copy, and one shared Details & Story experience derived from Import Studio. Source data survives saves and splits. The same selected product receives equivalent evidence from every entry point. Normal generation has been verified against the live provider; failures are visible and preserve existing copy. No bare-color fallback is presented as a finished description, and no unrelated dress facts enter a separated listing.

All required acceptance tests pass, the deployment is verified, and any remaining external provider limitation is explicitly reported rather than hidden behind a generic success state.

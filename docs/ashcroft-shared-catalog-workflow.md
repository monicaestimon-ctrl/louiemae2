# Ashcroft import and shared catalog recommendation

> Superseded for implementation by [the detailed build specification](ashcroft-admin-build-spec.md), dated September 21, 2026. The owner clarified that Ashcroft ordering must remain manual through the dealer portal; suggestions below about later ordering automation are not part of the approved scope.

Reviewed September 20, 2026. This is a proposed workflow, not an implemented integration. Local code includes uncommitted furniture and product-copy work; local capability does not establish production deployment.

## Findings

- Atelier uses `products`; House uses `furnitureProducts`, with separate publication and quote records. House imports intentionally do not create Atelier products or CJ requests.
- `convex/furnitureImport.ts` delegates to the generic scraper. `convex/scraper.ts` currently reads metadata and broad page images; it does not reliably isolate Ashcroft's feature tabs, full gallery, SKU, packaging, or authenticated dealer price.
- Atelier's admin import/save flows can mark products with source URLs as pending CJ sourcing. Ashcroft needs an explicit provider route throughout import, pricing, stock, checkout, and fulfillment.
- `lib/furniture.ts` uses cost × currency rate × 6 as the high estimate, with the low estimate $100 below it. At $1,049 USD, that is $6,194–$6,294. Replace this policy for Ashcroft before publication.
- Gemini text generation and brand-voice configuration already exist. No integrated product image-generation pipeline or Jev integration was found in the inspected code.
- The live https://louiemae.com/furniture/admin redirected to www and displayed the prelaunch page in the inspected browser. Verify production routing/deployment separately.

## Recommended product model

Add a canonical supplier catalog record, initially for Ashcroft, with stable supplier/product/variant identity. Existing Atelier and House records can remain as linked channel projections to avoid a disruptive rewrite. Shared facts, media, and supplier stock must have one source of truth, not independently editable copies.

Canonical record:
- supplier = Ashcroft; fulfillmentProvider = ashcroft; sourcingRequired = false.
- Supplier SKU, supplier product/variant IDs where available, canonical URL, source timestamp, original facts, original description, reference media, provenance and conflicts.
- Structured dimensions, units, materials, color, orientation, care, assembly, packaging per carton, supplier warranty evidence and commercial-use evidence.
- Private confirmed dealer cost and currency; supplier availability and last-checked timestamp. Unknown availability stays unknown.
- Approved Louie Mae name/copy; approved media with source/reference linkage and generation history.

Channel records:
- Atelier: hidden/published status, consumer price, category, gallery ordering, optional copy overrides, checkout eligibility.
- House: hidden/published status, trade quote policy, quantity tiers, minimum quantities and optional project-oriented copy/gallery overrides.
- Both reference the same canonical product and supplier variant identity.

Deduplicate using supplier + SKU/variant ID, not the raw URL alone. Importing a collection URL or product URL for the same SKU should update the same draft. Preserve old IDs and quote/order snapshots. Re-imports update supplier facts and raise differences; they do not overwrite approved copy or media.

## Operator workflow

1. Choose Add product → Ashcroft and paste a listing URL (batch URLs later).
2. Fetch approved supplier feed/API data when available; otherwise use a dedicated Ashcroft listing parser. Import only the selected product's gallery, not recommendations. Never assume the server has the browser's logged-in dealer pricing.
3. Display an editable draft with source evidence, missing fields, conflicts, price verification and reference-image permissions. Supplier costs stay private.
4. Generate Louie Mae copy from verified facts using the existing brand voice. Keep exact measurements; never infer top-grain leather, commercial certification or commercial warranty from appearance or channel placement.
5. Generate a hero first using a saved Louie Mae visual preset and approved product references. Approve the hero's setting and product fidelity before generating remaining images.
6. Generate the necessary reference-supported gallery angles. Review source versus output side by side. Retry individual images, not the entire set.
7. Set Atelier retail pricing and House quote pricing separately, including confirmed freight, handling, delivery service and margin policy.
8. Choose Publish to Atelier, Publish to House, or both. One action publishes a consistent approved revision to the selected channels; failures must be visible and retryable without duplicates.
9. Refresh source cost and stock through the permitted supplier mechanism. Retain approved imagery and copy. Flag stale/changed information and recheck availability before committing an order.

## Image studio

Start with reference-guided image editing, not custom model training. Save a versioned Louie Mae visual brief and a small set of approved existing brand images. Select the relevant references per request instead of sending the entire brand library.

Initial aesthetic: warm ivory/plaster, aged wood, natural linen, earthy ceramics, soft directional daylight, restrained styling, realistic scale and color. Preserve the product's finish even when the room is warmly lit.

Suggested gallery:
1. Editorial hero in a Louie Mae interior, whole item visible.
2. Clear front/three-quarter view.
3. Alternate side/rear view when supported by actual supplier references.
4. Useful material/construction detail, with extra views where the item requires them.

Do not generate invisible construction as factual product photography. Missing rear/side coverage requires more supplier photography, owned photography or a verified 3D asset. For maximum identity fidelity, prefer a licensed product cutout placed into a generated setting, preserving original product pixels. This still requires appropriate reference/reuse permission.

Store source/reference assets separately from publishable assets. A generated output is not automatically approved for publication. Preserve product geometry, cushion count, seam placement, legs, arm shape, finish and chaise orientation. Automatic visual checks can flag errors; a person approves the initial production batches.

Clarify why Ashcroft images cannot be used: permission to publish unchanged images and permission to use/edit them as AI references are separate questions. If reference use is unavailable, obtain approved assets or owned photos before this stage.

## APIs and background processing

- First choice: direct Gemini image API, building on the existing Google SDK and Convex backend. Benchmark Flash Image for routine work and Pro Image for hero/retry work using the same inputs. Choose by product fidelity, approval rate and cost per accepted gallery, not price per generation alone.
- Keep provider/model identifiers configurable. Existing text-generation configuration does not establish image-generation readiness or current SDK compatibility.
- Jev, if this means TypeSafe's model, is optional later for typed classification/scoring of extracted text and metadata. It does not generate images or replace the supplier importer. Supplier identity, SKU deduplication and fulfillment routing should use deterministic rules.
- Use durable background jobs with queued/running/needs-review/approved/failed states, bounded retries, per-product spend limits, usage tracking and reference/prompt/model hashes to avoid duplicate generation.
- Keep API credentials server-side. Store approved originals plus optimized web derivatives in controlled storage; both channels reuse the same media assets.

## Supplier fulfillment and pricing

Ashcroft's FAQ describes purchase-order-based dropshipping. Confirm the actual account ordering method before building an automated order API. Initially route Ashcroft orders to a dedicated supplier queue with SKU, quantity, delivery details, freight approval, supplier acknowledgement and tracking. Never send these lines to CJ. Mixed carts must split by fulfillment provider and preserve provider-specific delivery costs/status.

Do not interpret a dropshipping service fee policy as free freight. Confirm delivery service, freight, pallet charges, damage/returns procedures, applicable MAP and commercial-use coverage. Until freight/availability are reliable enough for checkout, use a clearly labeled quote flow.

Request from Ashcroft (not sent during this review):
- Dealer CSV/XML/API or scheduled stock/price feed, identifiers and update cadence.
- Approved photography, all available angles, and permitted AI reference/editing use.
- Ordering/PO method and available tracking/status integration.
- Freight/handling/service options, price/MAP rules, warranty and commercial-use terms.

## Lore pilot

Source: https://ashcroftfurniture.com/collections/sectionals/products/lore-l-shaped-genuine-leather-sectional-in-tan-right-facingafc01299

Observed in the authenticated browser: SKU SEC00401302; displayed price $1,049; six gallery thumbnails; tan genuine pigmented leather; 106.1 W × 61.4 D × 32.5 H inches; 133.1 lb product weight; solid + manufactured wood frame; walnut-colored solid wood legs. Shipping tab lists two cartons: 75.9 lb / 69.7 W × 36.2 D × 18.5 H inches, and 83.6 lb / 62 W × 38.6 D × 18.5 H inches.

Conflict: title says right-facing; description body says left-facing. Flag for supplier clarification before treating orientation as verified. Do not copy the contradictory text into generated descriptions. Six thumbnails do not establish six unique useful views until inspected.

## Implementation sequence and acceptance checks

1. Shared catalog linkage + Ashcroft-specific extraction + provider routing + separate pricing policy.
2. Image Studio with saved visual preset, source/output comparison, approval and durable storage.
3. Both-channel publication and supplier order queue; verify live routes.
4. Feed refresh and ordering automation only after supplier access is confirmed.

Pilot one SKU, then a small varied batch. Verify duplicate imports collapse to one product; source updates preserve approved content; both channels render the approved revision; hidden drafts remain hidden; Ashcroft creates zero CJ sourcing/fulfillment jobs; mixed orders route correctly; freight is never silently omitted; failed image jobs retry without duplicate spend; source images never become public by default.

References:
- https://ashcroftfurniture.com/pages/faq
- https://ai.google.dev/gemini-api/docs/image-generation
- https://docs.typesafe.ai/introduction

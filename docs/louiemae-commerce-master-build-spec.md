# Louie Mae commerce — master build specification and coverage audit

Version 1.1 · September 21, 2026 · Specification audit complete for the agreed workflows. This is not a production verification or a claim that the feature is built.

Implementation progress, tested behavior, configuration, and release blockers are tracked separately in [Commerce implementation status](commerce-implementation-status.md).

## 1. Implementation entry point and authority

Confirmed House pricing policy (September 21, 2026): apply multipliers to supplier unit cost converted to USD: ≤$50 ×6; >$50–$75 ×4.5; >$75–<$175 ×4; $175–<$250 ×3; ≥$250 ×2. At each new band enforce the preceding band's upper-bound price: $300, $337.50, $700, then $750. Round converted cost and final estimates to cents. This prevents downward price jumps. These are House starting merchandise estimates only; retain existing retail pricing. Bulk/quantity/high-invoice discounts are customized from actual economics in the final quote, never automatically granted by a quantity or invoice threshold. No inferred delivery or tax is included.

Read this document first, then the two detailed specifications:

1. [Ashcroft admin, Image Studio, shared product and publication specification](ashcroft-admin-build-spec.md).
2. [House three-provider, commercial quote/payment and CJ recovery specification](house-commercial-three-provider-workflow.md).

Together these define the build. This master document controls route eligibility and shared behavior; the Ashcroft document controls Ashcroft-specific content/image/manual-order behavior; the three-provider document controls commercial invoicing and CJ recovery. The earlier `ashcroft-shared-catalog-workflow.md` is historical research only. Prior suggestions for future automated Ashcroft ordering are outside the agreed scope.

## 2. Confirmed route and destination matrix

| Import entry | Route | Required sourcing | Publication eligibility | Execution after ready/paid customer order |
|---|---|---|---|---|
| Atelier normal Import Studio | CJ | Existing CJ sourcing and verified mappings/readiness | Retail and/or House | Exact paid items automatically enter CJ order/payment workflow; exceptions pause for resolution |
| Atelier Ashcroft import | Ashcroft | None through CJ | Retail and/or House | Owner manually places dealer order; Ashcroft fulfills |
| House owner-managed import | Owner-managed logistics | None through CJ or Ashcroft | House only | Owner arranges procurement/logistics; no supplier automation |

House's Add existing product associates a shared eligible CJ/Ashcroft product; it does not run another import or sourcing request. For new CJ/Ashcroft URLs, link to the appropriate Atelier entry point. Shared products can be edited from either authorized admin after creation.

These are backend rules, not only button visibility. Reject prohibited imports/publications/jobs through direct API calls, bulk paths, scheduled jobs and retries too. Do not silently fall back to CJ based on a URL or to owner-managed based on absent mappings. Existing ambiguous legacy records require explicit classification/review rather than guessed conversion.

## 3. Dynamic publishing and shared content requirements

- Use database-backed channel listings, not hard-coded customer-page product arrays or manually edited landing-page HTML.
- Import/store the product once. Each destination references approved shared product/media revisions and its own pricing/presentation settings.
- Add, publish, edit and unpublish a product through admin without a code deployment. New application capability still requires its normal initial deployment.
- Destination controls are retail, House or both when the route permits. House-only owner-managed products cannot acquire a retail destination through an API bypass.
- Save draft and Publish are distinct. Saving shared work does not silently change live pages. Show drafts and live revision badges in both admins.
- Publish-to-both validates both and commits their revision references atomically. Retry does not duplicate listings.
- Store variant identity once; each channel explicitly chooses eligible variants. Public variant selectors, displayed images, prices and inquiry/order payloads must refer to the same variant ID.
- A change to one channel's price/category/intro/gallery ordering does not overwrite the other. Shared name/specification/media changes clearly show affected destinations.
- Hide one destination independently. Product archive hides both and preserves quote/order history. No shared supplier stock is duplicated by publishing twice.
- Public catalog/detail queries return only approved published fields. Exclude dealer costs, supplier contacts, private reference photos, margins, AI metadata and customer records.
- Public pages update from the publication state via reactive queries or explicit cache invalidation. Test both catalog cards and detail/quote views; no stale hidden listing can remain orderable.
- Use stable public links and preserve them across renaming; historical invoice links resolve to their frozen paid version. House categories/featured placement are editable rather than hard-coded.
- Paginate/search admin catalogs and supplier pickers as records grow; do not silently hide records past the existing bounded-list limits.

## 4. Ashcroft required end-to-end scenario

Paste URL in Atelier → import selected-product evidence/gallery → generate/review Louie Mae name and description → generate faithful branded environments with source/output review → set separate retail/commercial estimates → preview and publish either/both → customer inquiry/confirmed project payment → one manual dealer-order task → owner orders → Ashcroft ships.

Image generation is reference-based with exact-product preservation and approval. Normally prepare 3–4 useful views according to available reference coverage; generate no fictional unseen construction. Brand preset, permission evidence, provider cost controls and durable jobs are specified in the Ashcroft document. Generate a gallery once and reuse it across both destinations.

No Ashcroft SKU enters CJ sourcing, shipping estimates, supplier payment or fulfillment. A paid commercial invoice may automatically create the internal task; it must never automatically purchase in the dealer portal.

## 5. CJ required end-to-end scenario

Import in Atelier → CJ sources/approves or rejects → offered variants mapped/verified → ready product published to either/both with independent channel prices → House inquiry → editable project quote → accepted fixed version → itemized Stripe invoice/email/payment URL → verified full customer payment → validated exact paid allocation → CJ order → verified CJ supplier payment → supplier processing/shipment.

No routine manual reselection after payment. The invoice selects the actual product/variant/quantity; the system uses those verified mappings. Customer payment and CJ payment remain separate records. Customer payment does not automatically top up CJ funds.

Required example: original request 30 chairs → negotiated quote 15 chairs → invoice 15 chairs → exactly 15 of the selected variant submitted to CJ. Keep the original inquiry and all revisions. Changing quantity/variant/address requires refreshed supply/freight checks. No unit-retail-shipping multiplication as a substitute for bulk freight.

CJ error resolution must implement section 17 of the commercial spec: show paid item next to CJ variant, repair only an exact-item mapping, revalidate, and resume the existing allocation safely. Substitutions require customer agreement. Already-created/paid supplier orders require confirmed remote amendment/cancellation or manual resolution; local edits alone are insufficient.

## 6. Owner-managed catalog and supplier profiles

Import URL in House only → OTAPI for supported 1688 listings or supported supplier extraction → generated editable name/description → selected approved images → option/variant images and identity → configured commercial estimate → publish House only.

Required model/UI detail beyond a freeform supplier note:

- One supplier profile linked to many products, keyed by reliable platform/vendor identity; manual names alone must not silently merge suppliers.
- Supplier name, platform/store URL/ID, contact methods, factory/pickup location when known, verification status/date and evidence references. Keep private.
- Dated supplier offers per variant: source cost/currency, MOQ, order increments, quantity tiers, availability/lead-time evidence, price validity, FX rate/date and exclusions. Unknown values are explicitly unknown.
- Preserve source option IDs and actual variant combinations. Do not invent every Cartesian combination if the supplier sells only some options.
- Match images using source variant evidence; if ambiguous, leave image unassigned and ask the operator to choose. Preserve shared product photos separately from variant-specific images.
- Allow draft/manual completion when extraction is partial. Validate MOQ/order increments on customer selection, quote edits and invoice finalization where applicable.
- Keep packaging/carton details, supplier terms and document references optional at catalog stage. Required logistics evidence becomes a gate before final project commitment/payment, not a requirement to merely save an import.
- Existing `furniture-product-intake-template.md` and `furniture-supplier-inquiry.md` are background field references. They do not authorize supplier contact or impose an automatic 6× pricing rule on the new workflow. Any formula, including a retained 6× rule for a specific owner-managed policy, must be explicit, reviewed configuration.

No new freight booking, supplier payment, forwarding, inspection or fulfillment API is in scope for this route. The commercial quote workspace can record manually confirmed logistics and collect payment after terms are finalized, but provider dispatch is a no-op beyond internal manual follow-up.

## 7. Commercial quote, invoice and order contracts

Required UI actions: Prepare quote, Add/remove item, Change variant/quantity, Edit unit price/discount, Add delivery/service charge, Preview quote, Record acceptance, Finalize & send invoice, Copy payment link, View payment status, Resolve fulfillment issue.

Suggested additional backend contracts (reuse naming conventions as appropriate):

| Contract | Required validation/output |
|---|---|
| `importOwnerManagedProduct` | House admin authorization, explicit route, safe URL/OTAPI extraction, dedupe and partial draft; zero CJ jobs |
| `associateDestination` | Canonical ID/channel, provider eligibility, one draft channel association; no duplicate import |
| `saveSupplierProfile` / `saveSupplierOffer` | Private admin fields, reliable identity, dated offer revision, expected version |
| `saveCommercialQuoteDraft` | Project/expected version, valid variants/quantities/charges, server-calculated totals, invalidate dependent checks |
| `recordQuoteAcceptance` | Exact quote revision, acceptance source/evidence/date; no implied payment |
| `finalizeAndSendInvoice` | Accepted revision, current checks, recipient/total preview, explicit send intent, idempotent invoice attempt |
| `reconcileInvoicePayment` | Trusted provider state, account/mode/currency/amount/version, durable dedupe; no caller-supplied paid flag |
| `dispatchPaidAllocations` | Immutable paid snapshot, provider partition, release policy, one job/task per allocation |
| `resolveCjException` family | Section 17 contracts: authenticated evidence-based correction/reconciliation/resumption with concurrency controls |

External invoice creation/finalization/sending is not atomic with the database. Persist an attempt first, use provider idempotency, save resulting IDs, and reconcile uncertain responses before repeating. Never leave two payable invoices for one accepted version through a retry. Customer account/test-versus-live state must match the configured environment.

Store payment evidence separately from financial readiness and fulfillment state. Validate one trusted immutable paid revision. No duplicate webhook, stale invoice, client redirect, manual paid checkbox or unrelated Stripe payment may spend supplier funds. Confirmed by the owner September 21, 2026: verified full customer payment is required before CJ ordering begins. Deposits/installments do not release CJ orders and are outside v1.

Project groups can include all three routes. Partition fees and shipping deliberately; do not submit service charges as supplier products. Explicit mixed-project coordination policy determines whether groups may proceed independently. A failure never changes customer payment history or falsely marks unrelated groups fulfilled.

## 8. Coverage audit

All rows are requirements coverage, not executed test results. Detailed acceptance checks are A01–A35 in the Ashcroft spec and R01–R10 plus commercial scenarios in the three-provider spec.

| ID | User requirement | Specification location | Audit result |
|---|---|---|---|
| M01 | One import, two destinations | Master §§2–3; Ashcroft §§4,10 | Covered |
| M02 | Dynamic admin-managed customer catalogs | Master §3 | Made explicit in this audit |
| M03 | Ashcroft starts in Atelier and publishes both | Master §4; Ashcroft §§1,5 | Conflicting entry-point text corrected |
| M04 | Names/descriptions/accurate branded images | Ashcroft §§6–8 | Covered |
| M05 | Independent retail/commercial estimates | Ashcroft §9; commercial §§2–3 | Covered; numeric policies remain configurable |
| M06 | Ashcroft manual portal order, no CJ | Master §4; Ashcroft §11 | Covered |
| M07 | Existing CJ sourcing approval/rejection and mapping | Commercial §3 | Covered |
| M08 | CJ dual publication with commercial pricing | Commercial §§2–3 | Covered |
| M09 | Quote changes quantity/variant/adds/removes lines | Commercial §§5–6 | Covered |
| M10 | Itemized emailed invoice/payment link | Commercial §§7–8 | Covered; old exclusion corrected |
| M11 | Verified payment automatically fulfills exact CJ items | Commercial §§9–10,17 | Covered |
| M12 | Specific CJ variant correction/error resolution | Commercial §17 | Added full UI, contracts and recovery tests |
| M13 | Corrections after CJ order/payment do not duplicate purchase | Commercial §17 | Added stage-specific constraints |
| M14 | House-only owner-managed URL/OTAPI import | Master §6; commercial §4 | Covered |
| M15 | Supplier profile, variants/images, descriptions and estimates | Master §6; commercial §4 | Expanded profile/variant requirements |
| M16 | Owner-managed never sent to CJ or published retail | Master §§2,6; commercial §2 | Covered by server rules |
| M17 | Distinct post-payment actions for mixed providers | Commercial §11; master §7 | Covered |
| M18 | Historical snapshots, duplicate/race protection | Both detailed specs; master §7 | Covered |
| M19 | Permissions, private costs/media/customer information | Ashcroft §§14–15; commercial §12 | Covered |
| M20 | Migration, deployment gates and acceptance tests | Ashcroft §§17–18; commercial §§14,16–17 | Covered |

## 9. Business configuration versus build completeness

Build all configuration screens and draft/blocked states without assuming financial values. Before dependent production actions, the owner supplies:

- Per-route/channel pricing policy, delivery estimate basis, FX where relevant, rounding and optional quantity tiers.
- Approved brand image presets and product reference-use permissions; supplier-specific missing/conflicting facts.
- Supported customer payment methods, invoice due/quote validity rules, tax/exemption workflow and sender branding.
- CJ automatic supplier-payment enablement/funding, spend/change limits and mixed-project release policy.
- Desired operational alert inbox and customer shipment-notification policy.

Confirmed September 21, 2026: Ashcroft retail customers request a quote first, then pay the finalized invoice. Immediate final-price retail checkout for Ashcroft is outside this release. House's accepted-quote-to-online-invoice-to-CJ-payment workflow is also part of the requested build, not an optional unspecified idea.

Provider API capabilities, environment keys/configuration and production routes must be verified during implementation. Do not hard-code unverified API versions or assert that a spec audit proves the live flow works.

## 10. Integrated implementation and verification order

1. Provider model, identity/migration rules, backend permissions and shared channel associations.
2. Atelier Ashcroft import/content/Image Studio, existing CJ linkage, and House owner-managed OTAPI/supplier-profile flow.
3. Independent pricing, dynamic destination previews, publication/unpublication and public variant consistency.
4. Versioned commercial quote editor and final invoice flow; test payment states without supplier spending.
5. Trusted paid-allocation dispatcher, CJ readiness/payment workers, Ashcroft manual tasks and owner-managed isolation.
6. CJ exception UI and safe mapping/remote-state recovery, including partial quantities and concurrency.
7. Preview deployment and end-to-end checks with fixtures/mocks/supported sandbox; controlled real integration validation under normal release procedures. Do not use live customer or supplier transactions as ordinary tests.

Release acceptance requires demonstrating all three end-to-end scenarios, exact 30-to-15-chair fulfillment, rejected/pending CJ publication blocking, House-only restriction, paired-channel atomic publication, stale invoice/duplicate webhook protection, mapping recovery before/after CJ payment, and no regression of existing retail flows.

This audit updates specifications only. It does not enable payments, publish products, submit sourcing, deploy code or place supplier orders.

# House of Louie Mae — three supplier routes, commercial quotes and invoice payments

September 21, 2026 · Workflow/design addendum · Proposed implementation, not deployed functionality.

Start implementation from [the master build specification](louiemae-commerce-master-build-spec.md). This document defines the three supplier routes and commercial payment workflow; section 17 defines the required CJ error-resolution interface.

This addendum expands `ashcroft-admin-build-spec.md`. The Ashcroft rules remain valid. The commercial invoice/payment design below replaces the earlier exclusion of a new commercial invoicing workflow. It does not authorize changing Ashcroft to automated supplier ordering or making independently sourced House products eligible for retail.

## 1. Confirmed direction

House of Louie Mae supports three explicit fulfillment routes. Louie Mae remains the customer-facing merchant in each case; the route determines how the purchased item is procured/delivered.

| Route | Product entry point | Sourcing | Destinations | After customer payment |
|---|---|---|---|---|
| CJ | Existing Louie Mae retail Import Studio | Existing CJ approval/rejection and verified variant-mapping process | Retail, House, or both once eligible | Automatically enter CJ fulfillment, including supplier payment when configured and ready |
| Ashcroft | Louie Mae admin's explicit Ashcroft workflow | No CJ sourcing | Retail, House, or both with separate estimates | Owner manually orders in Ashcroft dealer portal; Ashcroft fulfills |
| Owner-managed logistics | House admin only | No CJ sourcing and no Ashcroft association | House only | No supplier automation; owner arranges sourcing, freight and delivery independently |

Label the third option **Owner-managed logistics**, rather than “No fulfillment,” so staff understand that fulfillment is handled outside the integration. This is an internal label; the customer experience remains House-branded.

The usual retail import remains CJ-based, with Ashcroft as the explicit previously agreed exception. Supplier website and fulfillment route are separate fields: a 1688 URL imported in retail for CJ sourcing is different from a 1688 URL imported in House for owner-managed logistics.

## 2. Catalog model and entry controls

Extend the shared product model to support all three routes. Suggested fields:

- `supplierSource`: supplier/platform identity and source URL/IDs.
- `fulfillmentProvider`: `cj`, `ashcroft`, or `owner_managed`.
- `sourcingRequired`: explicit boolean governed by the route.
- `allowedChannels`: server-enforced channel set.
- Provider-specific verified variant mapping and source evidence.
- Independently configured retail and commercial pricing.

Atelier receives separate buttons for its normal import and Ashcroft import. House receives **Add existing product** and **Import owner-managed product**. Add existing product searches eligible shared CJ/Ashcroft products and adds a channel association without a new import or sourcing request.

Owner-managed records have `allowedChannels = [house]`. Retail publication and all CJ sourcing/retry/background dispatch endpoints must reject them server-side. A missing CJ variant is not proof that a product is owner-managed; it may be a CJ product still waiting for sourcing. Never infer the provider from missing fields.

If the same source URL exists under a different route, surface the possible match and require reviewed handling. Do not silently reuse a CJ-linked record for a House-only import or silently convert rejected CJ products to owner-managed logistics. A provider transition is an explicit future admin operation with mapping/pricing review; historic quotes/orders keep their original provider snapshot.

## 3. CJ import and dual publication

1. Operator imports through the existing retail Import Studio.
2. Existing name/description/image work proceeds; CJ sourcing runs as it does for the retail workflow.
3. Pending, rejected, incomplete mapping and ready states remain distinct.
4. House destination can be prepared as a hidden draft before sourcing finishes.
5. Publishing requires actual CJ fulfillment readiness, including the supplier product identity and all offered variant mappings. Approval by itself is insufficient.
6. Ready product offers **Publish to Louie Mae**, **Publish to House**, or **Publish to both**, reusing approved shared media/copy and separate channel prices.
7. Rejection keeps the product hidden under the CJ route; editing or retrying sourcing does not publish it automatically.

Only offered, mapped variants can be customer-selected. Mapping must preserve finish/size/color identity and corresponding images. Public prices remain channel-specific. Bulk commercial freight is calculated for the actual project quantity and address; it is not unit retail shipping multiplied by quantity.

Publication readiness is different from order readiness: publishing a chair does not establish availability or delivery capacity for 30 chairs. Confirm stock/production feasibility and delivery service for the actual order before invoicing and again before release where necessary.

## 4. House-only owner-managed import

1. Operator selects Import owner-managed product in House admin and pastes the supplier URL.
2. Use the existing OTAPI-backed import for supported 1688 products; generic supported URLs use appropriate source extraction.
3. Save supplier identity/contact/profile references, source product IDs, SKU/options, original currency/cost, minimum quantities and packaging evidence when available. Mark missing information instead of inventing it.
4. Generate an editable Louie Mae name and description from source evidence.
5. Let the operator select usable/approved images and map actual variant images to the correct options. AI environment generation is optional here, not a required prerequisite introduced by this addendum.
6. Configure an estimated commercial price, including an explicit FX input/date when needed and delivery exclusions/assumptions.
7. Review and publish only to House.

The catalog build ends at a publishable product with source/supplier evidence and a commercial estimate. It does not build freight booking, inspection, forwarding, supplier payment or warehouse automation for these products.

The same quote editor may be used when an inquiry arrives. The operator must establish logistics and final pricing before issuing a payable final invoice. If paid, the line stays owner-managed and does not create CJ/Ashcroft actions. An internal manual follow-up status is acceptable; it is not a fulfillment integration.

## 5. One continuous project record

Maintain one commercial project from customer selection through revisions, acceptance, invoice, payment and provider-specific fulfillment. Do not make the owner re-enter product data in separate systems.

Suggested House navigation: Catalog, Quote requests, Quotes & invoices, Orders, Suppliers. The existing request detail can become the project editor rather than introducing unrelated duplicate records.

The project holds customer/business/contact information, billing/shipping addresses, required date, delivery conditions, customer PO/reference, notes, line items, quote versions, Stripe invoice references and fulfillment groups.

Each line captures shared product and exact variant IDs, approved name/image/facts, provider route, supplier mapping, quantity, unit selling price, discounts, line total and relevant lead-time notes. Keep private supplier costs, margin and mappings out of customer views.

Service, delivery, installation or other approved project charges are explicit non-product lines. They must not be mistaken for CJ items. Delivery charges can be allocated internally to provider groups without being duplicated in the customer total.

## 6. Editable quote workflow: 30 chairs becomes 15

1. Customer selects a chair variant and quantity 30 in House and submits a project inquiry. Save the original request snapshot.
2. Operator opens it and chooses Prepare quote. The quote draft is prefilled from the inquiry.
3. Operator can change 30 to 15, change finish/variant, add other catalog items, remove lines, apply discounts, add delivery/service charges and update delivery details.
4. Every quantity/variant/address/service change invalidates dependent stock/freight/cost checks. Recalculate the complete proposed order rather than scaling the original shipping estimate.
5. Operator confirms product supply, current cost, delivery cost/service and achievable timeframe. Store assumptions and expiration/review times.
6. Send a customer-facing quote summary through the eventual backend send action or share a generated link/PDF in the owner's existing email process. No new email is sent merely by saving the draft.
7. Record the customer's acceptance against an exact quote version. An email confirmation may be recorded manually with date/note; an integrated acceptance link can be added later.
8. Operator chooses **Finalize & send payment invoice**. Preview recipient, itemized lines, address, delivery terms, total and intended post-payment routes first.
9. Customer pays online. Payment attaches to the final 15-chair quote version, not the original 30-chair inquiry.
10. Verified full payment releases only the final paid allocations into the appropriate provider workflow.

Keep Requested, Current quote and Final accepted quantities distinguishable in the history. Editing a customer request snapshot is not the same as creating a quote revision.

## 7. Payment recommendation: Stripe Invoicing

Recommended interface: the owner edits the quote in House admin and sends its finalized invoice from there; Stripe hosts the payment page. Stripe's documented hosted invoice page supports viewing invoice details, paying through enabled methods, and downloading invoice/receipt PDFs. It supplies an individual hosted URL and can send invoice email. [Stripe hosted invoice page](https://docs.stripe.com/invoicing/hosted-invoice-page)

Use the Stripe API to create the invoice from the approved version, then explicitly finalize/send it. [Stripe Invoicing API integration](https://docs.stripe.com/invoicing/integration)

Recommended first version:

- Local quote versions remain the source of editable project intent.
- Stripe invoices represent the fixed payment request for an approved version.
- Use `send_invoice` collection behavior rather than silently charging a saved payment method.
- Copy the hosted payment URL back into the project; store the invoice ID, number, status, totals, currency and accepted quote revision.
- Choose one invoice email sender, preferably Stripe for the first release, to avoid duplicate messages from Stripe and Resend. House admin can also offer Copy payment link.
- Show the operator Sent, Payment processing, Paid, Failed, Voided and Needs review from verified provider state.
- Restrict payment methods initially to those the account supports and the business chooses. Do not promise a specific fee or payment method without account verification.
- Confirmed by the owner September 21, 2026: require verified full customer payment before CJ ordering begins. Deposits or partial payments never release CJ orders in v1; any future deposit/installment workflow requires separately approved release rules.

A custom locked Checkout session could also collect a project total, but it adds custom invoice/document handling for this use case. Avoid a generic reusable Payment Link or editable storefront cart as the authoritative project payment request: the fixed quote revision, quantities, delivery price and provider allocations must remain bound together.

## 8. Changes after invoice creation

Before invoice creation, quote drafts are freely editable. After sending a payable invoice, a change creates a new quote version; it must not silently mutate the snapshot associated with the old payment link.

For v1, use a controlled unpaid-invoice cancellation/void-and-replacement workflow, supported by the current Stripe API and invoice state. Confirm the old invoice cannot still be paid before sending a replacement. Preserve both invoice references and version history.

A due date is not a hard payment-link cutoff or stock reservation. If the quote expires, actively stop collection/void the unpaid invoice using supported operations, or require revalidation before renewal. Do not assume the link becomes unpayable on the due date.

Reconcile payment-versus-revision races from server-retrieved Stripe state. If the prior invoice is already paid or a payment is processing, put the project into review rather than issuing another collectible request or releasing both versions.

After payment, changes use an explicit adjustment/refund/additional invoice workflow. Paid line quantities and their supplier submissions are immutable history. Refunds do not automatically cancel a CJ order already submitted; cancellation must be reconciled separately.

## 9. Verified payment to fulfillment

Use a signature-verified Stripe webhook, retrieve authoritative invoice/payment state and match it to the active project invoice and exact accepted version. A browser success screen, email reply, pending bank debit or manually checked “paid” box must not automatically spend supplier funds.

Stripe documents invoice payment events and notes that `invoice.paid` also includes invoices marked paid outside Stripe. Therefore the release rule must inspect payment evidence, full amount/currency and outstanding balance, not trust the event name alone. Manually recorded external payments require a separate deliberate release path. [Stripe post-payment event handling](https://docs.stripe.com/invoicing/integration#handle-post-payment-events)

Within one transaction, record the processed event/invoice payment, create or update the business order once, and enqueue unique provider-group jobs. Return promptly; CJ calls run in durable workers, not inside a long-running payment webhook. Duplicate and out-of-order events must not create duplicate orders, emails or supplier payments.

Before automatic CJ release, verify:

- Accepted paid quote version and complete matching payment evidence.
- No cancellation, refund or operational hold.
- Valid CJ mappings for the selected variants and quantities.
- Current stock/supply and appropriate shipping method for the complete destination/quantity.
- Current supplier cost/freight within owner-configured approved limits.
- CJ automation/payment configuration and sufficient available supplier funding.

Automatically continue when checks pass; otherwise show **Paid — needs fulfillment attention**, explain the exception and alert the operator. Do not ask for a routine extra click after every successful payment. Automated release must not silently increase the customer's charge or substitute variants/shipping outside the approved terms.

## 10. CJ supplier payment is separate

Customer payment into Stripe and payment to CJ are two different transactions. Do not assume Stripe automatically transfers invoice proceeds to CJ or that funds are available for supplier payment immediately.

The local project already contains CJ order creation, cart/payment steps and balance-payment controls. CJ documents separate order and balance payment endpoints. [CJ shopping/payment API](https://developers.cjdropshipping.com/en/api/api2/api/shopping.html)

For automatic fulfillment, the owner must configure and fund the supported CJ payment method. Insufficient funds or ambiguous payment results should pause/reconcile the existing CJ order rather than create a duplicate. Quantity 30 may require different shipping or supply arrangements than a single-item retail order; a sourcing approval is not confirmation of a bulk delivery commitment.

Configure per-order supplier spend limits and permitted cost changes before unattended commercial release. These are business settings to choose, not values supplied by this design. Paid-invoice success is not a claim of risk-free or irreversible payment; refunds/disputes retain their normal separate handling.

## 11. Mixed-provider projects

A single customer project may contain several provider types. Each paid line retains its provider snapshot and fulfillment allocation.

| Paid group | Internal action |
|---|---|
| CJ | Queue automatic CJ fulfillment/payment within approved policy |
| Ashcroft | Create manual dealer-order task; never submit to CJ or automate Ashcroft checkout |
| Owner-managed | Record paid project/manual follow-up; no supplier integration |

Customer invoice may combine the project when its scope, delivery charges and payment terms are confirmed. The backend splits it into provider groups with independent statuses/shipments. A project is not delivered merely because its CJ group shipped.

For a mixed project, require the operator to choose before invoicing whether groups may release independently or must wait for coordinated project readiness. Default coordinated readiness until explicitly approved; a paid-ready project can then release automatically under the selected rule. Do not silently ship one group early when the project needs coordinated arrival.

## 12. Existing code: reuse and required work

Reviewed local files:

- `convex/http.ts`: existing Stripe Checkout-completion handling and CJ handoff; no commercial invoice handling found in the inspected branch.
- `convex/orders.ts`: existing order schema/API is session-based; the create path inserts paid orders and must not be used directly as trusted invoice proof.
- `lib/cjFulfillmentReadiness.ts`: product/variant mapping and readiness checks available to reuse.
- `convex/cjDropshipping.ts`: order creation, inventory checking, payment/resume/reconciliation logic available as a foundation.
- `docs/CJ_OPERATIONAL_LAUNCH_RUNBOOK.md`: documents separate fulfillment and CJ balance-payment enablement; hosted settings were not verified in this review.

Required engineering changes:

1. Provider-aware shared catalog and House-only restrictions, with compatible linkage to existing CJ product IDs.
2. Independent commercial pricing and quantity/address-specific freight verification.
3. Versioned project quote editor and accepted quote snapshots.
4. Stripe invoice creation/finalization/send/status synchronization with idempotency.
5. Generalize payment/order identity beyond required Checkout session IDs; preserve legacy session references for retail orders. Do not invent fake session IDs for invoices.
6. Internal, authenticated/trusted order creation and protected customer/admin queries. Audit current order endpoint access before exposing commercial data.
7. Verified-paid dispatcher plus durable provider-group jobs; dedupe event, invoice and allocation separately.
8. Harden the existing Checkout path too so duplicated events cannot insert another order and an incomplete/asynchronous payment cannot trigger fulfillment. Invoice and Checkout events must converge on one trusted payment-to-order service without double-handling.
9. Supplier funds/quantity/freight checks and exception views appropriate to commercial volumes.
10. Provider-specific statuses while preserving a unified customer project view.

This is a reuse plan, not a statement that the current production system already satisfies these requirements. Do not change existing live payment/fulfillment configuration as part of writing this design.

## 13. Core records and state transitions

Add or extend: commercial project, immutable inquiry snapshot, quote draft/revisions, acceptance record, line/provider allocations, supply/freight check snapshot, Stripe invoice attempt/reference, payment evidence ledger, order/provider groups, durable fulfillment jobs and audit events.

Suggested states:

- Quote: requested → preparing → sent → accepted; revised/declined/expired as needed.
- Invoice/payment: not invoiced → creating → sent → processing → paid; failed/void/review alternatives.
- CJ group: waiting for payment → validating → queued → supplier order created → supplier paid → processing → partially shipped/shipped → delivered; attention/reconciliation states on exceptions.
- Ashcroft group: waiting for payment → needs dealer order → manually ordered → shipped → delivered.
- Owner-managed group: logistics to arrange → plan confirmed → paid/manual handling, with no automated supplier execution.

Do not use a single “confirmed” boolean for customer acceptance, payment and supplier submission. Customer acceptance can precede payment; payment can precede supplier confirmation.

## 14. Acceptance examples

- CJ pending/rejected product cannot publish as ready on House; fully mapped eligible product can publish to both without another sourcing request.
- Owner-managed 1688 import creates no CJ job under direct UI, API, retry or background paths; cannot publish to retail.
- Original 30-chair request is preserved; revised accepted 15-chair invoice creates exactly 15 units of CJ allocation.
- Changing variant, quantity or address invalidates freight/readiness checks and creates a new reviewed quote version.
- Added project fee or Ashcroft line is never serialized as a CJ SKU.
- Paying the correct invoice triggers one paid order and one CJ group dispatch, including after webhook replay.
- Wrong currency/amount/version, pending/partial payment, out-of-band marking or inactive invoice does not automatically release CJ.
- Voided/replaced invoices cannot create a second fulfillment allocation; payment/edit races enter review.
- Insufficient CJ balance pauses an existing order with a clear alert; funding/retry resumes it without duplicate purchase.
- Stock or freight change after payment creates an exception instead of silently spending beyond policy.
- Mixed projects release according to the preapproved coordination setting; Ashcroft remains manual and owner-managed remains external.
- Paid order changes/refunds preserve history and do not falsely report supplier cancellation.
- Public catalog/invoice responses contain no private supplier costs, credentials or another customer's project data.

## 15. Decisions still open

Confirmed payment rule (September 21, 2026): full customer payment before CJ ordering; no deposit-based release. Recommended implementation defaults: Stripe-hosted itemized invoice sent from House admin through Stripe; supplier exceptions pause and alert. Owner-managed products remain House-only as required.

Business configuration still needed: retail/commercial price policies, payment methods, quote-validity window, tax/exemption handling through the existing appropriate process, CJ supplier funding and spending limits, permissible cost changes, and mixed-project delivery coordination. Actual Stripe account availability/pricing and CJ operational readiness must be verified before launch.

## 16. Proposed build order

1. Shared supplier routing and dual publication, including House-only import restrictions.
2. Commercial project editor with quantity/variant changes, final pricing and freight evidence.
3. Stripe invoice integration and verified payment ledger; test without supplier orders.
4. Reuse/harden CJ workers behind the paid-group dispatcher; test with mocks/supported sandbox and explicit controlled release procedures.
5. Integrate Ashcroft manual task and owner-managed follow-up into the same project view.
6. Verify the complete 30-to-15-chair scenario, payment replays, mixed-provider isolation and failure recovery before production enablement.

## 17. CJ fulfillment exceptions: exact-item selection and safe resumption

This section incorporates the owner's latest requirement: the system normally uses the paid invoice's exact items automatically, but exposes a specific item/variant correction workflow when fulfillment fails. Customer payment, CJ order creation, CJ supplier payment and shipment are separate states.

### Required exception interface

Add a Needs attention view and a per-order Resolve CJ issue panel. Show:

- Customer project/invoice/version and verified customer payment state.
- Paid line ID, product name/image, exact option values and original ordered quantity.
- Remaining unsubmitted/unfulfilled quantity and every existing CJ allocation/order/shipment reference.
- Current CJ product ID, variant ID/SKU and verified option labels/image.
- CJ supplier payment state: not attempted, pending, failed, paid or uncertain.
- Readable error, failed step, last checked time, retry history and permissible next actions.

Actions depend on the error: Review matching variant, Refresh stock & delivery, Review cost difference, Recheck CJ order/payment, Retry failed step, Hold, or Record customer-approved change. Do not offer a generic unchecked “Force fulfill” action.

### Variant correction versus substitution

For a missing/wrong mapping before supplier submission, allow an authorized operator to search/select a real CJ product/variant, compare its labels and images with the paid line, and confirm that it represents the same purchased item. Fetch/verify the selected mapping server-side, refresh quantity-specific supply/freight/cost checks, and show the resulting submission preview.

An operator cannot satisfy identity checks simply by entering a valid CJ ID. A different color, size, finish, item or customer quantity is a substitution/change. Hold fulfillment and record customer agreement to a new quote/order amendment, including any additional payment/refund resolution, before release. Keep the original paid snapshot immutable.

Store a mapping correction as an audited fulfillment amendment: paid line reference, old/new mapping, verified matching attributes, reviewer, reason and timestamp. It does not rewrite the invoice. By default it applies to that order only; fixing the catalog mapping for future orders is a separate reviewed action and must not alter other historic orders.

### Stage-dependent recovery

| Current supplier state | Allowed recovery |
|---|---|
| No supplier order and definitely no submitted request | Correct an exact-item mapping, revalidate and resume the held allocation |
| Creation request timed out or supplier state unknown | Reconcile existing CJ order first; do not create another request blindly |
| CJ order exists but supplier payment not confirmed | Inspect current order; use a verified supported amendment/cancellation operation or manual supplier resolution before replacement; a local mapping edit does not amend CJ |
| CJ payment submitted with uncertain result | Query/reconcile the existing payment; do not blindly pay again |
| CJ payment confirmed | Inspect actual supplier order and fulfillment status; only use supported supplier amendment/cancellation with confirmed outcome; otherwise hold for manual resolution |
| Some units shipped | Preserve shipped allocations; review only remaining units; no re-fulfillment of shipped quantity |

The UI must never imply a supplier order is amendable after payment when the provider has not confirmed that capability/status. If it cannot be amended, explain the manual resolution path and keep the group on hold.

### Retry contract and concurrency

Proposed operations: `getFulfillmentException`, `previewMappingCorrection`, `applyFulfillmentAmendment`, `reconcileSupplierState`, and `resumeFulfillmentGroup`. All require authorized access; mutations require expected revision, allocation ID and idempotency key. Operator permissions for mapping repair and supplier-spend release must be enforced server-side.

Retry resumes the same logical paid allocation at its last verified safe step, using existing CJ order/payment IDs. Before each irreversible external operation, check current payment evidence, holds, allocation version and worker lease. Concurrent admin clicks or background retries must not duplicate quantities or supplier payments. An uncertain external outcome enters reconciliation rather than an unbounded retry loop.

Exceptions notify the owner once per meaningful new issue/state, with an in-app badge and configured alert; routine polling does not resend the same alert. Customer payment remains recorded as paid even when supplier fulfillment fails. A group's issue does not mark every project line failed; mixed-project coordination determines whether other groups may proceed.

### Required recovery acceptance tests

| ID | Scenario | Pass condition |
|---|---|---|
| R01 | Paid 15-chair invoice has valid mapping | Exact 15-chair variant automatically proceeds without reselection |
| R02 | Matching CJ variant mapping missing before submission | Authorized repair with comparison/evidence enables revalidated resumption |
| R03 | Selected replacement has different finish/size | Cannot pass as mapping repair; requires customer-approved amendment |
| R04 | Mapping changed locally after CJ order exists | No claim that remote order changed; reconciliation/amendment path required |
| R05 | CJ payment is confirmed but item needs correction | No duplicate purchase; supported supplier resolution or explicit hold |
| R06 | CJ payment/creation timeout then Retry | Existing outcome reconciled before another charge/order attempt |
| R07 | Two admins and worker retry simultaneously | One effective allocation dispatch; version/lease conflict prevents duplicates |
| R08 | 5 of 15 chairs already shipped | Remaining 10 tracked; shipped 5 never resubmitted |
| R09 | Supplier failure after successful customer payment | Paid state preserved with actionable fulfillment exception |
| R10 | Catalog mapping corrected for future sales | Historic invoice/paid allocation snapshots remain unchanged |

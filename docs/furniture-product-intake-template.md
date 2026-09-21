# House of Louie Mae — product and logistics intake

Planning template; no application or database changes made. Copy this record for each sellable variant. Unknown values stay blank, never zero. Attach evidence, source, verification date and reviewer to supplier claims and quotes. Public catalog fields must be separated from private sourcing and customer records.

## Product and variant
- Internal product ID:
- Internal variant SKU:
- Customer-facing name / category / description:
- Supplier ID and supplier SKU:
- Original product URL:
- Variant: finish / color / fabric / size:
- Product dimensions and measurement units:
- Seat height / table clearance / other functional measurements:
- Materials / construction / upholstery / care:
- Indoor or outdoor use:
- Intended commercial use and supporting evidence:
- Load rating and supporting evidence:
- Assembly instructions / estimated crew and time / required tools:
- Product photos / videos / drawings:
- Written permission to use supplied images and descriptions:
- Warranty and commercial-use exclusions:
- Known MOQ / order increment / restrictions to display:
- Catalog status: draft / information requested / ready for estimate / published / paused:

## Supplier (maintain once, link to many products)
- Legal business name / factory or trading company:
- Business address / factory location / pickup address:
- Contact name / email / phone / WeChat or platform account:
- Business registration verification / date:
- Export capability / exporter or export agent:
- Payment methods and agreed payment schedule:
- Bank beneficiary verification status (sensitive details stored separately):
- Defect, damage, missing-part and replacement policy:
- Inspection acceptance / sample process:
- Verification status / evidence / last review:

## Supplier offer (dated, versioned; do not overwrite history)
- Offer ID / supplier ID / variant SKU:
- Unit price / currency:
- Quantity brackets and price at each bracket:
- MOQ per model, finish and fabric / mixed-variant allowance:
- Standard-stock and custom-production lead times:
- Customization / tooling / sample / packaging costs:
- Incoterm and exact named place:
- Included and excluded services / domestic pickup or transport cost:
- Availability quantity and as-of date:
- Quote date / expiration:
- Source document:
- FX rate, date and USD-converted cost:
- Customer estimate formula: upper = 6 × approved USD source cost; lower = upper − 100 USD.
- Manual estimate override / reason / reviewer / date:
- Rule: block automatic publication if lower bound is nonpositive, costs are missing, or formula gives an unsuitable market price.

## Packaging (repeat for EVERY carton/crate type)
- Packaging profile ID / variant SKU:
- Package label and contents (e.g., carton 1 of 2, table top):
- Number of these packages / furniture units represented:
- Outer length / width / height and units:
- Gross packed weight and units / net product weight:
- Carton / crate / pallet / other:
- Stackable? Maximum stack height or load:
- Fragility / orientation / moisture protection / handling equipment:
- Pallet/crate dimensions and weights including packaging:
- Packaging photos / verified versus estimated measurements:
- Replacement-part package details, if available:
- Derived package CBM = length(m) × width(m) × height(m) × package count.
- Shipment CBM must use final packed shipment measurements; account for nesting, shared cartons and pallet overhang. Do not add carton volume to pallet volume when both describe the same cargo.

## Documents and product review
- Commercial invoice and packing-list capability:
- Country of origin:
- Supplier-suggested HS code:
- Broker-reviewed U.S. HTS classification / reviewer / date:
- Relevant test reports, certificates and labels / applicability review:
- Wood species / composite wood / upholstery or other relevant materials:
- Packaging-treatment documentation where applicable:
- U.S. commercial-use suitability review:
- Inspection scope / sample approval / photos / result:
- Warranty, replacements and damage evidence:
- Unknown or unresolved issues:

## Fulfillment eligibility (one record per variant and provider)
- Variant / provider / facility:
- CJ reason declined, if relevant: sourcing / MOQ / dimensions / weight / route / other:
- Route: project import / China stock / U.S. stock / supplier direct / MCF:
- Accepted dimensions, weights and packaging profile:
- Warehouse acceptance in writing / date / expiry:
- Supported destinations and service levels:
- External-carrier pickup permitted? Appointments and loading requirements:
- Minimum inventory / minimum monthly charges:
- Restrictions / evidence / approval status:

## Project and delivery requirements (separate from product)
- Project ID / customer name / email / phone / business:
- Delivery address and ZIP:
- Required-by date / flexible date range:
- Commercial or residential / dock / forklift / liftgate:
- Floor / stairs / elevator / doorway limitations / parking or loading restrictions:
- Building delivery hours / insurance certificate requirements:
- Service: curbside / threshold / room of choice / assembly / debris removal:
- Item variants / quantities / project notes:
- Submitted estimate snapshot and timestamp:

## Route quote (one record per shipment scenario and provider)
- Quote ID / project ID / provider / subcontractors:
- Origin(s) / exact receiving destination / final customer destination:
- Cargo quantities / packaging profile versions / total weight / CBM:
- Sea LCL / FCL / domestic LTL / dedicated truck / other:
- Origin pickup / consolidation / inspection / crating:
- Export handling / ocean freight / insurance:
- Brokerage / filings / bond / duties and taxes estimate:
- Destination terminal or CFS charges / unloading / trucking:
- Receiving / inspection / free storage period / ongoing storage:
- Picking / preparation / outbound handling:
- Interstate transportation / final delivery / assembly / debris removal:
- Extra fees: stairs, long carry, appointment, redelivery, peak, heavy-item equipment:
- Potential contingent charges and exclusions:
- Transit estimate and assumptions / quote expiration:
- Cargo coverage, liability limit, deductible and claim deadlines:
- Named party responsible for each handoff:
- Total / currency / tax basis / avoid duplicate charges bundled elsewhere:
- Allocation to project items by stated method; final customer quote remains versioned:

## Minimal backend records
Products -> Variants -> PackagingProfiles -> Packages.
Suppliers -> SupplierOffers -> Variant links (allow multiple suppliers per variant).
Providers -> Facilities -> VariantProviderEligibility.
Projects -> QuoteRequests -> QuoteItems (immutable submitted name, variant, quantity and estimate snapshot).
RouteQuotes -> RouteQuoteLines -> Project allocations.
Documents and VerificationEvents link to their owning records.
Future: PurchaseOrders, InventoryLots, StockMovements, Shipments and Claims.

Store money in minor units with currency, measurements with units, timestamps, source documents and version IDs. Enforce private access to supplier prices, banking data, customer addresses and internal quotes. Public catalog responses expose only approved fields. Save quote requests before queuing email; track delivery and retries to avoid lost or duplicate submissions.

## Readiness gates
- Ready to list: approved images, variant identity, description, dimensions, estimate, quantity restrictions and clear estimate-only copy.
- Ready for final delivered quote: supplier offer, packed measurements, project address/access requirements and current route quotes confirmed.
- Ready to purchase: customer acceptance, funding/payment terms, availability, required product/document review, packaging and named handoffs confirmed.

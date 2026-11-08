# Louie Mae and HOLM Delivery Tool Specification

Version 1.0 · November 8, 2026 · Implementation handoff

This specification defines a complete delivery service for Louie Mae retail and authenticated HOLM trade purchasing: product estimates, cart calculations, checkout, manual quotes, supplier shipment routing, tracking, returns, and reconciliation of actual shipping invoices. Customers see a clear delivery charge; the server uses verified product, supplier, carrier, pricing, and destination data to calculate it.

The final phase replaces the illustrative `/trade` savings calculator with calculations from approved v2 settings and actual approved product prices. Trade savings and retail-referral earnings remain separate activities.

**Status:** requirements and proposed implementation, not a statement that these features are live. Existing code is a foundation, not proof of an operational delivery service. No configuration approvals, carrier contracts, product publication, payments, or production data migrations are authorized merely by this document. Existing user authorization to build the requested system remains in effect; release depends on the concrete checks below.

## 1. Outcomes and governing rules

The finished system must:

1. Give a useful ZIP-based estimate on a product page and recalculate the entire cart at its actual destination.
2. Charge a defensible amount that accounts for freight, accessorial services, supplier fees, payment expenses, approved discounts, delivery allowances, commission commitments, and the product's assigned contribution floor.
3. Use one authoritative server calculation for retail, trade, saved projects, quotes, and checkout. No browser-only pricing formulas may determine amounts charged.
4. Handle mixed suppliers and multiple origins without pretending that separate shipments are a single carrier shipment.
5. Preserve approved retail and trade pack prices. The estimator must not silently raise merchandise prices or reduce promised commissions to make shipping work.
6. Route unsupported freight to a usable quote workflow instead of displaying $0, an invented rate, or an artificially capped charge.
7. Freeze the customer's accepted delivery charge at payment. Carrier overruns become an internal variance, not an automatic customer surcharge.
8. Keep enough evidence to reproduce every calculation and compare estimates with actual invoices.

Louie Mae is the retail sales channel. HOLM is the authenticated trade purchasing channel. Eligible retail referrals pay commissions through the shared partner program; trade purchases do not earn referral commissions.

## 2. Approved commercial direction and proposed defaults

| Topic | Required treatment |
| --- | --- |
| Zuo origin | Use verified assigned warehouse; California reference origin is ZIP 95206. Never silently substitute another warehouse. |
| Coverage | All 50 states can request service. Automatic supported lanes initially cover the contiguous US; Alaska and Hawaii have separate quote flows. |
| Automatic Zuo charge | $49.99 minimum, increasing by $10 to $199.99. Requirements above the ladder require a quote. |
| Product allocation | Retain $10 per physical product in the approved pricing model. One sellable pack can contain multiple physical products. |
| Actual dropship fee | Model the supplier's verified per-order fee separately. The present Zuo assumption is $10 per supplier order; verify billing scope and effective date. |
| Size allowance | Current model: small $15, medium $25, large $40, oversize $60, LTL $100 per physical product. Unknown size is not $0. These are internal planning allowances, not carrier charges. |
| Contribution floors | Preserve each SKU's approved policy: standard 20%, documented 18% exceptions, and approved 306-product 5% cohort. Do not extend a low-margin exception to other products. |
| MAP cohort | Preserve the 135 products' approved prices; an unresolved operating floor or supplier-policy hold still blocks automatic sale. |
| Zuo trade pricing | Use actual approved trade prices, normally reflecting 10% or a documented 5% exception. No general 25% override and no project stacking without explicit applicable authorization. |
| Existing Ashcroft rules | Preserve its approved product pricing and delivery rule until a reviewed migration explicitly replaces them. |
| Service | Proposed initial LTL service: supported curbside delivery, with exact carrier inclusions stated before payment. Parcel service must be labeled accurately rather than calling every shipment curbside. |
| Estimate validity | Proposed full-address estimate lifetime: 30 minutes, shortened by the earliest source/rate/quote expiry. ZIP estimates remain nonbinding. |
| Freight uncertainty reserve | Configurable and evidence-backed. A proposed 10% starting reserve may be simulated, but must not be presented as a supplier fee. |
| Oversize or large projects | Quote if shipment limits, carton data, pallet configuration, rates, service, economics, or destination are unsupported. A high order value alone is not a freight mode. |

The proposed defaults must appear as versioned settings. Previously approved business direction should be recorded with its existing evidence rather than repeatedly requesting approval. New service commitments, unsupported rates, unresolved cost facts, and genuinely undecided policies remain distinguishable from those approved directions.

### 2.1 Terms in plain language

**Freight cost** is what a supplier or carrier charges us to move the shipment. **Delivery charge** is what the customer pays. **Delivery allowance** is the planned room built into merchandise pricing to help cover freight. **Subsidy used** is the portion of that room the order can actually afford after costs and required contribution. These amounts are related but are not interchangeable.

The $10 product allocation does not mean every item costs $10 to ship. The supplier's $10 order fee is separate from parcel or LTL freight. A $315 minimum, if confirmed for a specific freight service, applies only under that service's documented conditions; it must never become a universal shipping charge for every Zuo item or every shipment below a weight threshold.

## 3. Current implementation and required changes

Code baseline inspected: repository main through commit `a788dd4dc920a0cb49996eca646fd385098a65e6`. Seed settings indicate intended defaults and approval states; they do not establish the current state of production configuration.

| Existing area | Evidence and remaining requirement |
| --- | --- |
| `lib/shipping/classify.ts` | Carton metrics and Ground/LTL/quote classification exist. Separate informational LTL reasons from blocking errors; add documented pallet, service and carrier capability rules. |
| `lib/delivery/engine.ts` | Contribution, allowance, subsidy, ladder and tax iteration exist. Replace embedded $10 values with versioned assumptions; allocate supplier fees by actual supplier order, not automatically once per shipment group. |
| `convex/dlvEngine.ts` | Resolves approved prices and creates groups. Add complete source/config version capture, precise cost handling, explicit supported supplier routes, fee scopes, and approved commission schedule resolution. |
| `convex/dlvEstimates.ts` | Customer-safe estimate responses exist. Add estimate ownership, guest capabilities, complete invalidation and secure retrieval. The current `get` function does not check ownership. |
| `lib/delivery/destination.ts` | Basic ZIP-region and PO-box checks exist. Prefix checks are not address validation. Its `addressKey` is normalized address text, not a cryptographic hash. |
| `components/delivery/ProductDeliveryEstimate.tsx` | ZIP/quantity form exists. Add stale-result handling, correct pack labels, quote CTA, accessible state transitions, and shared retail/trade support. |
| `convex/ordCheckout.ts` | Retail intent, recheck and payment snapshot foundation exists. Bind idempotency and estimate access to the buyer; compare the complete accepted breakdown, not only the grand total. Complete authenticated trade handoff. |
| `convex/ordQuotes.ts` | Admin quote versioning exists. Complete the customer request, notification, secure acceptance and quote-to-checkout journey. |
| `convex/ordFulfillment.ts` | Supplier child orders and shipment handling exist. Reconcile shipment groups with supplier orders, warehouse splits, invoiced freight and partial deliveries. |
| `convex/sysConfig.ts` | Approved configuration resolution and versioning exist. Add strict delivery schemas, complete effective-date behavior, validation, preview and impact reports. |
| `/trade` `TradeBand` in `trade/app.ts` | Uses a project-value slider, a generic trade multiplier and hardcoded project tiers. Replace claimed actual savings with approved SKU prices; keep hypothetical examples explicitly illustrative. |

Important implementation gaps:

- `classify()` includes normal LTL classification explanations in `reasons`; `groupFreight()` passes those into the delivery engine, where any reason currently blocks automation. A valid LTL shipment must not become quote-only merely because the supplier ships LTL.
- Current freight modeling uses weight-based zone rates for the whole classified group. That is not automatically valid for parcel minimums per package or pallet/class-based LTL. Carrier-specific rating adapters are required.
- Current source fingerprint does not fully cover cartons, stock, warehouse, rules, allowances, commissions, membership, discounts, credits, or address classification.
- Current customer shipment mapping matches Zuo supplier prefixes and can repeat lines across different origins. Map by exact group allocation instead.
- Current estimate persistence can construct an internal total using missing tax as zero. Unknown tax must remain unknown; no payable total is valid without resolved tax treatment.
- Current `createIntent` checks an existing idempotency key before validating ownership and request equivalence. A guessed/reused key must not reveal another buyer's order details or return a different request's result.
- Current inventory reservations record intent quantities but do not prove supplier stock is reserved. This limitation must be explicit in the stock strategy.
- Commission reserves currently reference a code constant. Approved v2 schedules and product eligibility must control the reserve; referral tracking must not change the delivery price.

## 4. Scope and user journeys

### 4.1 Product detail page

The selected variant and sellable-pack quantity feed the estimator. Show the physical quantity clearly: “Quantity 1 = 1 set of 2 chairs.” Reuse the product's actual minimum and increment; do not invent a universal quantity limit.

Inputs are ZIP code and quantity, with service options only when supported. ZIP accepts five digits and optionally ZIP+4 while preserving leading zeros. A remembered ZIP may prefill, but do not persist a full address in browser storage merely for convenience.

States: idle, validating, calculating, estimated, quote required, item unavailable, invalid input, service temporarily unavailable, and estimate stale. A variant, quantity, destination or service change invalidates the old result immediately. Ignore late responses to earlier requests.

Successful display: “Estimated delivery: $79.99,” service description, destination ZIP, and “For this item and quantity. Recalculated for your full cart and address before payment.” Do not imply that several product-page estimates should be added together.

Quote display: “This delivery needs a quote” plus a functioning button that carries the selected product, variant, packs, ZIP and service into the request. Missing stock or prohibited sale is “Currently unavailable,” not a shipping quote invitation that implies the item can be ordered.

### 4.2 Retail cart

One delivery summary calculates the complete cart. Show merchandise, authorized discounts, applied credit, delivery, tax status, and total when known. Unknown amounts display “Calculated after address” or “Quote required,” never $0 or “Free.”

Group details may expand below one delivery line: Shipment 1, Shipment 2, items, service and estimated timing when supported. Do not disclose supplier wholesale costs or internal subsidy calculations. Show split-shipment disclosure before payment.

If one group needs a quote, the entire current cart is not automatically payable. Retain all items. Offer “Request a delivery quote” and an explicit user action to remove quote-only items and recalculate. Never silently omit expensive or unavailable lines.

### 4.3 Full-address checkout

Collect and validate the full address, country, recipient contact details needed by the selected service, residential/business status, and delivery-access questions. Request liftgate/dock or appointment information only when relevant. A business name is not proof of a commercial dock.

Show address corrections for acceptance when they materially change the destination. Validate ZIP, city and state consistency. Service restrictions, special access and validated destination class must feed the final calculation.

Display the confirmed merchandise, delivery, taxes, credit and payable total with the actual service and shipment disclosure. Any material change requires explicit acceptance before payment, including offsetting component changes that leave the grand total unchanged.

### 4.4 HOLM trade cart and projects

Only an approved trade account receives private trade prices. Resolve membership, organization access and prices on the server. Use the same delivery service with trade net merchandise and zero purchase commission.

Small supported trade orders can use automatic delivery. Large or unsupported projects use quotes. Keep project merchandise discounts separate from delivery; any lower delivery result must come from the freight/economics calculation, not a generic order-value reward.

Save a project with a delivery scenario, but mark it stale when inputs expire or change. Saved estimates do not reserve stock or lock prices. Approved tax exemptions require validated certificate scope, destination, expiry and account association; a browser checkbox is insufficient.

### 4.5 Standalone estimator and admin simulator

A standalone customer estimator selects real published variants and quantities, then a ZIP or address. It cannot produce a trustworthy charge from order value alone.

An authenticated admin simulator may use draft products, proposed configurations, synthetic cartons or alternate rates. Label every result “Simulation — not orderable.” Simulation must not generate payable estimates, alter live quotes or export an unlabeled customer offer.

## 5. Required data and units

Use integer USD cents for stored monetary amounts, integer basis points for percentages, integer millimeters and grams for physical data, and explicit conversion provenance for supplier inches/pounds. Perform exact decimal arithmetic before final money rounding. Never round a fractional per-piece price and multiply it back to recreate an approved pack price.

| Entity | Required fields |
| --- | --- |
| Variant | Stable internal ID, supplier SKU, original supplier name, Louie Mae name, supplier ID, sellable pack ID, pieces per pack, minimum/increment packs, approved retail/trade price revision IDs, currency, category, eligibility and holds. |
| Cost revision | Exact wholesale value and unit basis; freight/duties/supplier fees and their unit scopes; confirmed-zero versus unknown; payment reserve; effective dates; source and verifier. |
| Carton type | Variant/pack identity, carton count per pack, exterior packaged dimensions, gross weight, supplier shipping method, stacking restrictions, fragile/nonconveyable flags where known, effective dates and evidence. |
| Pallet plan | Pallets, exterior loaded dimensions/weight, carton assignments, stackability, handling class and carrier-required freight class/NMFC or verified equivalent when applicable. Unknown required pallet data means quote. |
| Warehouse | Supplier, verified origin ZIP/address reference, stock source, dispatch/service capabilities, cutoff/timezone and effective dates. |
| Carrier rule | Carrier/service/account scope, origin/destination zones, limits, dimensional divisor, rating increments, base/minimum rates, accessorials, fuel, uncertainty treatment, currency, validity and source. |
| Supplier order policy | Charge type, amount, once-per-PO/per-shipment/per-piece basis, applicable origins and services, effective dates, and verified evidence. |
| Product economics | Approved contribution floor, overhead/processing/return assumptions, allowance per physical piece, handling allocation, commission eligibility and reserve policy, discount/MAP policy versions. |
| Destination | Validated country/state/ZIP/address reference, precision, residential/commercial class and confidence, access requirements, supported service region. |

Carton counts must describe one sellable pack. A set of two chairs might ship in one carton; do not multiply cartons by both pieces and packs. Product assembled dimensions never substitute silently for carton dimensions. Missing data blocks the affected method or product instead of becoming zero.

Discontinued, unavailable, unpriced, cost-incomplete or unresolved MAP variants remain retained records with appropriate purchase/referral holds. A freight quote cannot override a merchandise sale hold.

## 6. Versioned configuration

Extend the existing v2 registry rather than introducing unrelated browser constants. Reads use the approved record effective at calculation time. Record IDs, versions and effective intervals with every estimate. Invalid or missing configuration fails only the affected method, lane or feature.

| Configuration | Required contents |
| --- | --- |
| `pricingAssumptions/zuo-pricing-assumptions` | Processing, returns, overhead, supplier payment reserve, $10 per-piece allocation and size allowance map. No embedded replacement constants. |
| `deliveryLadder/delivery-ladder` | Explicit ordered tiers, minimum, automatic maximum, applicable supplier/rule scope and delivery processing rate. |
| `deliveryRule/zuo-95206-curbside` | Approved origin, service, supported destination scope, freight adapter, supplier fee policy reference. |
| `deliveryRule/mixed-zuo-ashcroft` | Supplier-specific aggregation and display behavior; explicit approval state. |
| `carrierRule/*` | Contracted/verified carrier rate versions and lane coverage. Use separate rules per origin/service where needed. |
| `estimatePolicy/estimate-policy` | ZIP/full precision behavior, validity, freshness requirements, retry/cache policy and invalidation rules. |
| `freshnessPolicy/freshness-default` | Stock, cost, MAP, carton and rate age limits, source outage behavior and supplier notice invalidation. |
| `commissionSchedule/commission-schedule` | Approved category/tier rates, explicit exceptions and applicable effective dates. |
| `tradeDiscountSchedule/trade-discount` | Supplier/SKU eligibility and limits. Actual prices still come from approved price revisions. |
| `projectDiscountPolicy/project-discount` | Approved thresholds, highest-tier selection, eligible subtotal basis, excluded-supplier treatment and floor checks. |
| Proposed new tax/service/fee policies | Tax provider and validated tax behavior, service descriptions, supplier fee scopes, accessorial policies, rate fallback limits. Add schema and tests before use. |

Configuration validation must reject negative rates, duplicate/unsorted ladder tiers, impossible dimensions, percentages outside permitted ranges, missing currency/basis, unsupported origin mappings, and invalid effective intervals. Every processing denominator must remain positive.

Publishing a future-effective version must not retire the currently effective version early. Define effective ranges transactionally, prevent overlapping active versions, and make rollback a new audited version rather than rewriting historical records. Preview the impacted lanes and sample baskets before activation.

## 7. Classification and freight rating

### 7.1 Per-carton metrics

Sort packaged dimensions so `L >= W >= H`:

```text
girth = 2 × (W + H)
lengthPlusGirth = L + girth
volume = L × W × H
dimensionalWeight = carrierRound(volume / approvedDimensionalDivisor)
parcelBillableWeight = max(carrierRoundedActualWeight, dimensionalWeight)
```

Carrier rounding rules and unit conversions are versioned. Validate dimensions and divisor before division; reject nonfinite, negative, zero or overflow results. Apply the carrier's package-level fees and minimums to each package as required by its contract.

Do not average cartons to determine eligibility. One over-limit carton can require a separate service even when the average carton is small. Do not apply parcel dimensional-weight rules to LTL unless that specific carrier tariff requires them.

### 7.2 Mode selection

Ground is eligible only if every package assigned to that shipment satisfies the chosen service limits and supplier routing rules. A supplier-marked LTL item is never silently downgraded.

Supported LTL requires a validated handling/pallet plan and an approved lane/service rate. LTL does not automatically mean quote-only. Truckload, unknown pallet fit, excessive floor space, unsupported oversize, restricted destinations and unapproved services do require quotes.

Separate output fields:

- `mode`: parcel, LTL, dedicated/truckload quote, or unsupported.
- `diagnostics`: explanations such as “Supplier requires LTL.”
- `blockingReasons`: missing data, unsupported lane, stale rate, missing service capability.

Only blocking reasons prevent automatic rating. Configure boundaries from verified carrier documentation; do not hardcode remembered carrier limits as permanent facts.

### 7.3 Shipment planning and grouping

Build supplier-order plans and shipment groups as separate entities. A supplier PO may have several shipments; several suppliers cannot share one PO. A group key includes supplier, warehouse/origin, destination, service, ship-ready window and compatible freight mode. Stable line allocations identify exact variants, packs and physical units assigned to each group.

Do not consolidate split origins, separate suppliers, incompatible services or backorders merely to reduce the calculated fee. A parcel/LTL mixed group can be consolidated only when the supplier and service explicitly support that plan; otherwise rate separate groups. Store the selected plan and rejected alternatives internally.

Allocate the actual supplier order fee once per supplier PO when that is its verified basis. A split into two shipment groups does not itself create a second supplier fee. If the supplier charges per shipment, represent that verified policy explicitly. Fee allocation totals must reconcile exactly to the assessed fee.

### 7.4 Rating adapters and fallback

Supported sources, in priority order configured per lane:

1. A valid current carrier/supplier quote matching exact shipment requirements.
2. An approved contract rate table with complete tariff and accessorial treatment.
3. An approved, calibrated estimation matrix within its supported scope and age limits.
4. Manual quote required.

A cheaper but stale or mismatched source is not a fallback. Do not buy labels or book freight while estimating. Live carrier requests run in server actions outside database transactions; transactions persist the verified result and snapshot after the external call.

Record base freight, minimum charge, fuel, residential, liftgate, limited-access/remote area, oversize, appointment and other applicable services separately. Identify whether each is already included in the supplier/carrier quote. Apply an uncertainty reserve once, to its documented base, never on top of another already-included reserve.

Distance alone is insufficient. ZIP zones and origins affect rate selection; actual carton/pallet data, service and accessorials determine shipment cost. Order value influences how much delivery the merchandise economics can support, not the carrier's physical cost.

### 7.5 Service and destination scope

Support US leading-zero ZIPs, residential/business validation and configurable remote/limited-access coverage. Alaska/Hawaii use separate quote lanes, never mainland rates. Territories, military addresses and PO boxes display supported alternatives or unavailable service according to verified carrier capability; asking for a quote is not a promise of deliverability.

Define parcel doorstep, LTL curbside, threshold/inside and white-glove services separately. Advertise only enabled services with documented inclusions. Assembly, stairs, room placement, debris removal and appointment windows must not be implied. Record required access acknowledgments before checkout. Multi-address orders are quote-only initially; the future data model must support child shipments by destination.

## 8. Delivery economics and allowance calculation

All equations below are internal. Prices shown to customers remain their approved merchandise prices and resulting delivery charge. Each model input must state its unit basis and whether already included elsewhere.

For line `i`:

```text
q_i = sellable packs ordered
u_i = q_i × physical pieces per pack
R_i = merchandise revenue after approved discounts and allocated store credit
C_i = exact landed merchandise cost, including applicable supplier payment cost
H_i = allocated actual supplier-order/handling fee
K_i = reserved eligible retail commission; 0 for trade purchases
V_i = other known expenses, including allocated fixed payment expense
p,r,o,m = processing, returns, overhead and assigned contribution floor rates
P_tax_i = allocated payment processing expense on tax collected

A_i = floor(R_i × (1 − p − r − o − m)) − C_i − H_i − K_i − V_i − P_tax_i
B_i = sizeAllowancePerPiece_i × u_i
      + max(0, handlingAllocationPerPiece_i × u_i − H_i)
U_i = min(A_i, B_i), provided A_i >= 0 and all required inputs are known
```

`A_i` is affordable freight support after protecting the contribution floor. `B_i` is the delivery-support budget in the approved pricing model. `U_i` is the permitted subsidy. Neither the size allowance nor the $10 allocation should also be deducted from `C_i` as an actual expense; that would count the same funding twice. Actual supplier fees are expenses and are deducted once through their assessed scope.

An allowance is not necessarily fully funded just because a spreadsheet contains it. The `min(A_i, B_i)` limit prevents promising more support than the line can afford. If `A_i < 0`, block automatic pricing and open an economics review; do not conceal an inadequate merchandise margin inside a higher shipping charge.

Use each product's assigned policy. Never lower the floor automatically because a distant destination is expensive. A manual exception needs its own authorized, versioned record and must still satisfy supplier policy.

For shipment group `g`:

```text
F_g = supported outbound freight + included accessorials + approved uncertainty reserve
U_g = sum of assigned line subsidies, allocated without duplication across groups
uncovered_g = max(0, F_g − U_g)
Q_g = ceil(uncovered_g / (1 − deliveryProcessingRate_g))
```

Money allocation uses integer cents and deterministic largest-remainder allocation with a stable ID tie-break. One piece/pack or line subsidy cannot be spent in two groups. Surplus in one supplier's group must not silently fund another supplier; any pooling policy requires explicit configuration and review.

### 8.1 Fees, tax, credit and commissions

Count a fixed processor fee once per payment, allocated across eligible lines or groups. Percentage processing applies to the actual charge base, including applicable delivery and tax; do not count it again in another reserve. A separate later payment or split payment requires its own verified fee treatment.

The approved 3% processing, 2% returns, 5% overhead and 3% supplier-payment reserves are modeled assumptions, not claims about actual vendor charges. Record actual rates when known. Unknown fixed fees/duties/fulfillment costs are not confirmed zeros.

Retail subsidy calculations reserve the maximum applicable, qualified commission obligation, including valid protected rates, using approved v2 settings. No referral click may make a customer's delivery more expensive. Explicitly noneligible products reserve zero; unknown eligibility does not silently become zero. Trade purchases reserve zero commissions.

Store credit reduces eligible merchandise according to the shared accounting policy; it is not a delivery discount and cannot pay delivery or tax under the retained program rules. Validate available credit and applicable supplier restrictions. Record its allocation once and reserve it atomically at checkout. Do not double-count its issuance cost and redemption cost without a documented accounting treatment.

Use a verified tax service or approved jurisdiction/product/service-specific tax rules. Missing tax treatment is unknown, not tax-free. Preserve exemption evidence. A broad state-rate placeholder may be used in a labeled simulation; it is not sufficient proof of an accurate payable tax amount.

## 9. Customer delivery ladder and worked examples

| Tier | Charge | Tier | Charge |
| --- | ---: | --- | ---: |
| 1 | $49.99 | 9 | $129.99 |
| 2 | $59.99 | 10 | $139.99 |
| 3 | $69.99 | 11 | $149.99 |
| 4 | $79.99 | 12 | $159.99 |
| 5 | $89.99 | 13 | $169.99 |
| 6 | $99.99 | 14 | $179.99 |
| 7 | $109.99 | 15 | $189.99 |
| 8 | $119.99 | 16 | $199.99 |

For supported Zuo groups, sum required customer contributions and select the smallest configured ladder amount covering that sum. Apply the ladder once to the Zuo cart portion, not once per item. Retain internal group allocations whose sum equals the customer charge. Allocate rounding surplus deterministically without hiding underfunded groups.

```text
ZuoRequirement = sum(Q_g)
ZuoCharge = first approved ladder tier >= ZuoRequirement
No matching tier = quote required
```

No automatic $199.99 cap absorbs arbitrary freight. A required $200.00 charge is quote-only, not $199.99. A zero uncovered requirement still yields $49.99 under the retained minimum unless an explicitly approved free-delivery policy applies. Retail promotions must never silently override that policy or supplier restrictions.

These are arithmetic fixtures, not carrier quotes:

| Supported freight F | Affordable subsidy U | Uncovered | Required at 3% delivery processing | Ladder result |
| ---: | ---: | ---: | ---: | ---: |
| $80.00 | $30.00 | $50.00 | $51.55 | $59.99 |
| $100.00 | $30.00 | $70.00 | $72.17 | $79.99 |
| $120.00 | $60.00 | $60.00 | $61.86 | $69.99 |
| $220.00 | $30.00 | $190.00 | $195.88 | $199.99 |
| $315.00 | $100.00 | $215.00 | $221.65 | Quote required |

An example $1,000 merchandise line with $500 landed cost, $10 actual supplier fee, $100 reserved commission, $0 other fixed expense, 3% processing, 2% returns, 5% overhead and a 20% floor has `A = $90` before tax processing. With one piece and a $60 size allowance, `B = $60 + max(0,$10−$10) = $60`; subsidy is $60. This is a synthetic line, not a real SKU approval.

For two physical products in one supplier order, the merchandise allocation is $20 while the assumed actual fee is $10. The remaining $10 can contribute to the delivery budget only if contribution supports it. Do not charge the supplier fee twice because two items are present.

Earlier California/Phoenix/New York numbers are planning examples until supported by a lane matrix. Do not publish a geographic price chart from those examples alone.

### 9.1 Mixed Zuo and Ashcroft carts

Recommended retained behavior: calculate the supported Zuo ladder portion and the approved Ashcroft portion separately, then show their sum as one delivery line with an optional shipment breakdown. For example, a hypothetical $79.99 Zuo charge plus a $100 Ashcroft rule produces $179.99 combined delivery.

The $199.99 limit applies to the Zuo automatic ladder portion; a combined supplier total may exceed it. That scope must be explicit in configuration and customer copy. Until the mixed-supplier rule is approved and tested, mixed carts require a quote. Do not cap the combined charge or apply Zuo allowances to Ashcroft.

### 9.2 Tax and delivery stabilization

Calculate taxes for the proposed delivery tier, update processing expense on that tax, then verify contribution and delivery again. Iterate upward across the finite configured ladder until the tier and tax basis stabilize, or route to quote. Bound the iteration by the ladder size plus a final verification pass; report nonconvergence rather than guessing.

Validate final inequalities in cents: delivery net of its allocated processing covers the chosen uncovered freight; each line still meets its assigned contribution floor; allocation totals reconcile. An unknown ZIP-only tax estimate must not be used to claim a final delivered total. At full address, the validated total is merchandise minus discounts/credit plus delivery plus tax.

## 10. Server pipeline and API contracts

### 10.1 Calculation sequence

1. Validate request shape, limits, identity and requested channel.
2. Load variants, approved listings, exact pack prices, quantities, stock and eligibility.
3. Resolve approved trade/project discounts and permissible credit once; reject unauthorized mechanisms.
4. Load current costs, cartons, warehouses and versioned policies. Record unknowns explicitly.
5. Validate destination and supported services.
6. Build supplier-order and shipment plans; assess fees once at their true scopes.
7. Classify packages/pallets; obtain valid rate evidence through the selected adapter.
8. Compute contribution, affordable subsidy, delivery ladder, tax and final validations.
9. Persist an immutable estimate snapshot with its complete dependency fingerprint and expiry.
10. Return a customer-safe result. Internal costing and restrictions remain admin-only.

### 10.2 Estimate request

Extend existing `dlvEstimates.estimate` rather than creating a second pricing authority:

```text
EstimateRequest
  requestId / idempotencyKey
  channel: retail | trade
  lines[]: productId, variantId, sellablePacks
  destination: postalCode, optional validatedAddressToken
  serviceCode, relevant access answers
  projectId? and expected project revision?
  useAvailableCredit: boolean
  guestCapability? (server-issued; never a caller-chosen authorization identity)
```

Do not accept authoritative costs, prices, percentages, membership, exemption claims, freight, margins or commission rates from the client. Unknown fields are rejected or explicitly ignored with safe telemetry. Client-side display calculations are not authoritative.

### 10.3 Customer response

```text
EstimateResponse
  estimateId, revision, requestId
  status: estimated | confirmed | quote_required | unavailable | invalid_input | temporarily_unavailable
  precision: zip | full_address
  merchandiseMinor, discountMinor, creditMinor
  deliveryMinor: integer | null
  taxMinor: integer | null
  payableTotalMinor: integer | null
  deliveryService: code, customer label, inclusions, exclusions
  shipmentGroups[]: opaque groupId, item allocations, service, supported timing
  createdAt, expiresAt, stale: boolean
  customerReasonCodes[], nextActions[]
  splitShipmentDisclosure, estimateCaveat
```

`confirmed` means a valid full-address estimate, not payment or a carrier booking. `payableTotalMinor` is null unless every required component is known and valid. Do not leak warehouse addresses, supplier identity where private-label confidentiality applies, contract rates, cost revisions, margins, commission reserves or administrative hold details.

### 10.4 Other required endpoints

| Operation | Contract and authorization |
| --- | --- |
| Get estimate | Owner or valid scoped guest capability only; returns customer-safe snapshot and expiry. |
| Recalculate | Creates a new revision; returns old/new component differences and explicit acceptance requirement. |
| Request quote | Persists exact selected lines, destination, service, contact, request reason and consent to contact about that request. Does not imply payment consent. |
| Get/accept quote | Correct buyer/organization; valid unexpired version; acceptance is audited and bound to the exact revision. |
| Create checkout | Requires accepted full snapshot, authorization, stock/credit rechecks and request-bound idempotency. |
| Admin explain | Authorized staff only; returns internal calculation, sources, fees, assumptions, flags and audit references. |
| Admin simulate | Proposed configurations allowed with simulation status; cannot be passed to checkout. |
| Admin reconcile | Links carrier/supplier invoices to shipment/order allocations, with append-only adjustments and reason. |

### 10.5 Errors and graceful fallback

Use structured codes such as `CARTON_MISSING`, `RATE_STALE`, `LANE_UNSUPPORTED`, `SUPPLIER_METHOD_CHANGED`, `ECONOMICS_REVIEW`, `TAX_UNRESOLVED`, `ESTIMATE_EXPIRED`, `PRICE_CHANGED`, `TRADE_APPROVAL_REQUIRED`, `ADDRESS_REVIEW`, and `CARRIER_UNAVAILABLE`. Map to safe customer language and an actual next action.

User-correctable input errors stay beside the field. Temporary carrier failures offer retry or quote without discarding the cart. A product sale hold offers removal or support, not a misleading payable delivery quote. Unexpected failures log a correlation ID and never show internal stack traces.

## 11. Persistence and estimate invalidation

Extend `dlvEstimates` and existing order tables; add dedicated plan/rate/invoice entities where required. Do not store carrier credentials in snapshots.

An estimate stores owner organization/user or hashed guest capability, normalized destination reference and protected digest, channel, exact line/pack allocations, service/access answers, approved discounts and credits, customer totals, internal model, source provenance, carrier quote IDs, supplier-order plan, shipment groups, configuration versions, code/schema version, issue and expiry timestamps, and state.

Hash a canonical structure covering all dependencies, not just IDs. It includes product/variant price and cost revisions, precise quantity basis, carton revision, warehouse, stock observation/reservation, product policy/holds, allowance, fee schedule, carrier rule/quote, tax result, commission-reserve policy, membership, discount approval, credit allocation, destination classification and service.

Invalidate on any relevant change, withdrawal or expiry. Configuration/version changes unrelated to the cart must not invalidate it unnecessarily. A price increase, service change or meaningful total change must be visible; do not silently accept it on behalf of the customer. A supplier notice can invalidate affected lanes/SKUs immediately.

ZIP and full-address cache entries have different precision and keys. Cache only within source/quote validity. Share only public, nonpersonal lane information across users; trade prices, credits, exemptions and private projects are account-scoped. Proposed defaults: 5-minute ZIP cache and 30-minute full estimate maximum, subject to the source-expiry minimum. Document final approved values in configuration.

## 12. Payment and stock controls

An estimate does not reserve supplier stock. At payment initiation, refresh availability from the best supported source and enforce stock unit basis. Internal reservations must subtract other valid holds atomically when a reliable quantity feed exists. If only binary availability exists, identify the route as unconfirmed supplier inventory and use the approved manual confirmation/quote policy rather than claiming a guaranteed reservation.

Checkout binds the estimate to the authenticated buyer or secure guest capability. Compare channel, cart, destination, service, discounts, credit, tax, shipment terms and total. Accepting the total alone is insufficient if service or components changed.

Scope idempotency by buyer/capability and operation; bind it to a canonical request digest. The same key and same request returns the same intent; the same key and a different request fails. Retrieval must not bypass ownership checks. Payment session creation uses an external idempotency key derived from the intent.

Freeze an immutable accepted snapshot, reserve credit/inventory where supported, and create a payment session for exactly that snapshot. Only a verified, deduplicated payment event marks the order paid. Redirects do not. Handle late payments, mismatched totals, duplicate webhooks, session-creation uncertainty and stock conflicts through an operations exception queue. Never retry an uncertain charge blindly.

Expiry releases only unpaid reservations. Paid orders keep their accepted prices and delivery charge even when configuration changes. Preserve financial obligations if automation is disabled. A payment provider outage must not erase a quote, cart, accepted snapshot or paid event.

No real test payments, transfers or payouts, and no alternative payment-testing method without the user's authorization. Build fixture tests and read-only verification; identify any payment-verification gate still awaiting a permitted method.

## 13. Manual freight quote workflow

Customer request collects the exact project/cart, pack quantities, verified contact, destination and special access/service needs. Preserve the cart and provide a request reference and response expectations based on actual support capacity; do not invent a guaranteed response time.

Statuses: requested, needs information, sourcing rates, ready for review, sent, accepted, expired, declined, superseded, converted to order, cancelled. Staff ownership, timestamps, communication history and the next action are visible internally.

Staff obtains a supplier/carrier rate and records its scope, expiry, services, included charges and exclusions. Validate merchandise cost, MAP, permitted discount mechanisms and margin separately; a freight quote does not clear those holds. Quote-only freight can be priced above $199.99, clearly disclosed before acceptance.

Each customer quote is an immutable version containing products/packs, approved merchandise prices, project discount, credit assumptions, delivery, tax or explicitly unresolved tax status, service, destination, validity, stock caveat and terms. Unresolved payable tax blocks payment even if the customer can review the merchandise/freight proposal.

Acceptance authenticates the customer or uses a strong scoped expiring token. Any later change creates a new version and requires acceptance again. Staff may record offline acceptance only through a separately authorized role with evidence. A free-text `acceptedBy` value is not proof of customer consent.

Revalidate before converting to payment. Bind the resulting order to the accepted quote version; never edit that version in place. Customer-requested service/address changes after payment require an explicit reviewed adjustment workflow. Carrier overruns alone do not authorize another charge.

## 14. Fulfillment and customer communications

After verified payment, create a parent customer order and supplier child orders. Allocate every ordered physical unit exactly once, using pack-safe handling and shipment references. Zuo children go only to the Zuo fulfillment route; Ashcroft children go only to Ashcroft. EDI, when enabled later, sends only the appropriate supplier child order and uses idempotent purchase-order identities. Keep manual fulfillment as an explicit controlled route, not an automatic duplicate fallback after an uncertain EDI send.

Supplier orders can have multiple shipment records and tracking numbers. One delivery does not mark the parent order delivered while other units remain outstanding. Display partial shipment and partial delivery accurately. Distinguish warehouse processing time from transit time; show only supported ranges and disclaimers.

Required disclosure before payment, on the success page, confirmation email and order-status page:

> Your order may arrive in separate shipments. We’ll share tracking for each shipment as it becomes available. The delivery charge shown at checkout covers the delivery service you selected.

For known splits, use definite wording: “Your order will arrive in separate shipments.” Customer-requested later changes are governed by the accepted service/returns policy; do not dilute the promise with an undisclosed post-payment freight adjustment.

Confirmation includes all items, accepted merchandise/delivery/tax totals, service and contact details. Shipment messages identify only the shipped items and their tracking. Delay, delivery exception, damage and cancellation messages have appropriate support actions. Notification deduplication prevents duplicate emails from webhook retries.

## 15. Returns, cancellations and actual freight reconciliation

Before launch, record supplier-specific cancellation cutoffs, damage reporting, return authorization, restocking and return freight policies with their approved customer-facing wording. Do not infer Zuo return terms from Ashcroft.

Partial cancellation/refund calculations use the frozen line, tax, credit and delivery allocations. Refundable delivery depends on the approved policy, fulfillment state and cancellation cause; do not automatically refund all delivery or retain all delivery. Do not increase the remaining order's already-paid delivery charge simply because a line was cancelled. Reverse or adjust commission on refunded eligible merchandise according to the shared ledger rules.

Reconcile every supplier/carrier invoice to the relevant supplier order and shipment. Track base freight, fuel, accessorials, supplier order fee, duplicate fees, reclassification, damage/redelivery, customer-caused approved adjustments and credits separately. A split shipment can have several invoices; match by supplier/carrier reference and amount without importing duplicates.

Store estimated freight, estimated subsidy, customer delivery revenue, actual supplier fee, actual freight, actual payment expense, contribution variance and explanation. Compute a complete order contribution using actual expenses; the internal subsidy allocation is not an additional cash expense to deduct again.

Rate calibration is reviewed, not self-published. Compare estimates with invoices by origin, ZIP zone, mode, size/pallet class, service, supplier and residential/accessorial profile. Propose revised rates/reserves with sample counts and impact reports; preserve historical estimates and paid order terms.

## 16. Admin and operations features

The admin delivery console must provide:

1. Rate and service registry with version history, evidence, effective/expiry dates, approval state, lane coverage and rollback.
2. SKU/carton completeness queue, pack-basis conflicts, unknown costs, changed supplier methods and stale inventory/MAP/cost sources.
3. Quote queue with staff assignment, customer information requests, carrier evidence, margin explanation, approval and secure sending.
4. Estimate inspector showing exact inputs, origin/destination classification, carton/pallet plan, fees, allowances, commission reserve, contribution, chosen tier and reasons alternatives failed.
5. Scenario comparisons for the same real basket across ZIPs, services, retail/trade prices and approved/proposed rate versions. Synthetic scenarios are visibly labeled.
6. Invoice import/manual entry, duplicate checks, variance dashboards and controlled adjustments.
7. Coverage and reliability dashboard for all 50 states, with Alaska/Hawaii separately reported and unsupported lanes visible.
8. Customer-safe preview of product, cart, quote and confirmation copy.
9. Flags to disable a lane, service, supplier or automatic checkout without disabling tracking, quote access or fulfillment of paid orders.
10. Export of internal pricing/delivery records with explicit units, source versions, timestamp and simulation/actual status. Customer exports exclude internal costs.

Role boundaries: support views customer-safe estimates and quote status; operations manages shipment plans and rate evidence; pricing/finance reviews costs and economics; authorized approvers publish policy/rate changes; engineering manages integrations and deployments. All mutations enforce server-side permissions and audit actor, reason and before/after version references.

### 16.1 Internal pricing and delivery record

For every variant, export supplier SKU/name, Louie Mae name, physical pieces per pack, wholesale unit/pack basis, MAP basis/evidence, approved retail/trade pack prices, permitted discounts, contribution policy, overhead/expense assumptions, $10-per-piece allocation, size allowance, carton metrics, warehouse, mode eligibility, commission category/rate eligibility, holds, image reference and source revision dates.

Do not assign one universal delivery fee to a product. Store a delivery profile and scenario estimates tied to origin, destination, quantity, service and rule version. The cart result is authoritative because consolidation, accessorials and allowance affordability can change it.

## 17. Security, privacy, accessibility and performance

Estimates, projects, quotes, checkout intents and invoices require object-level access checks. Organization roles cannot read another organization's trade terms. Guest tokens must be server-issued, high-entropy, scoped, expiring and stored hashed. A freely chosen visitor ID is an analytics hint, not authorization or sufficient abuse protection.

Use server-side rate limits combining account/session and trusted request context; rotating a caller-supplied visitor ID must not evade them. Bound line count, pack quantities, carton expansion, request size and external API spend. Proposed initial synchronous limit is 30 distinct lines; larger projects enter a background/manual quote flow while retaining every item. Never silently truncate a project.

Carrier credentials remain server-side. Validate external endpoints, redirects, timeouts and payload schemas. Do not put full addresses, guest tokens, supplier costs or carrier credentials in analytics, error URLs or public logs. Use encrypted storage/access controls for address and invoice data, protected digests for comparison, and a documented retention/deletion policy that preserves required financial history.

Meet keyboard, focus, screen-reader and responsive requirements: labeled inputs, text errors, live result announcements, visible loading state, no color-only status, and usable layouts at 320px width. Currency displays use cents where relevant; calculations never depend on animated displayed numbers. Changes cannot leave an apparently current old price on screen.

Proposed performance targets: cached estimates under 500ms p95, matrix-backed estimates under 2s p95, live-carrier estimates under 8s p95 with a visible pending state and controlled timeout. These are build targets to measure, not customer delivery-time promises. Use bounded retries with jitter for transient failures; never retry validation/authentication errors or book shipments during retry.

## 18. Final phase for the trade calculator

This phase is separate from freight rating but must consume the same authoritative prices, policy versions and delivery result.

### 18.1 Approved configuration and genuine savings

Replace the `/trade` generic multiplier and hardcoded `PROJECT_TIERS` with a safe server response derived from effective approved `tradeDiscountSchedule`, `projectDiscountPolicy`, `commissionSchedule` and actual variant prices. Do not expose the unrestricted admin configuration endpoint to the browser.

For a real selected project:

```text
retailComparison = sum(current published retail pack price × packs)
approvedTradeSubtotal = sum(current approved trade pack price × packs)
baseTradeSavings = retailComparison − approvedTradeSubtotal
projectSavings = approvedTradeSubtotal − approvedFinalProjectMerchandise
totalMerchandiseSavings = baseTradeSavings + projectSavings
effectiveSavingsPercent = totalMerchandiseSavings / retailComparison
```

Only compare identical variants, pack quantities and currency. No MSRP or invented inflated retail comparison. A missing retail listing means the comparison is unavailable for that line, not $0 savings. Show how many lines have a valid comparison and do not present a partial saving as whole-project savings.

Project-tier qualification uses an explicit approved basis. Recommended default: eligible trade merchandise subtotal before the project discount, excluding delivery, taxes and credit; excluded suppliers such as nonstacking Zuo neither receive that discount nor count toward its threshold. This basis must be recorded because the older whole-project logic may differ. Apply only the highest qualifying tier, not both 3% and 5%. Per-line MAP, mechanism and margin rules still control the actual discount. Show “up to” only where a genuine constraint can reduce it, and show the actual final price before ordering.

If no project policy is approved, show actual base trade savings and “Project pricing requires review”; do not borrow proposed tiers. When qualifying settings are approved, exact $10,000 and $25,000 boundaries are inclusive under the retained proposal. No Zuo project stacking is introduced by this calculator.

Delivery and tax are displayed separately from merchandise savings. An optional delivered-total comparison requires valid estimates for both channels with the same items, destination and service; otherwise leave it unavailable. Do not assume retail and trade delivery costs are equal.

### 18.2 Referral earnings remain a separate scenario

Display a distinct panel: “Estimated commission if your client buys eligible products at Louie Mae retail.” Never add this amount to savings on the trade purchase or imply both rewards apply to one transaction.

Use the partner's server-resolved shared tier, explicit categories, eligible SKU exception rates and applicable rate protection. Lighting is décor. For each eligible line, calculate on expected retail merchandise after authorized discounts and credit, excluding tax and delivery. Do not predict future tier upgrades from a hypothetical slider purchase; use the actual tier and clearly label optional scenarios.

Current approved seed schedule, to be read from effective settings rather than embedded in UI:

| Tier | Furniture | Décor and lighting | Clothing |
| --- | ---: | ---: | ---: |
| Base | 10% | 8% | 5% |
| Active | 12% | 9% | 6% |
| Top | 15% | 10% | 7% |
| Elite | 18% | 12% | 8% |

Earnings estimates do not create ledger entries, lock rates beyond valid attribution rules or promise payout. Missing eligibility or a missing retail destination means “Not currently eligible,” not a hidden base-rate fallback. Actual partner ledger and payout rules remain authoritative.

A public project-value slider cannot claim actual savings without a product basket. Either replace it with “Build a project to see your savings,” or label a deliberately chosen example basket and its assumptions. Public visitors must not gain private trade prices or account-specific rates through the example endpoint.

## 19. Acceptance tests and reference cases

Tests must exercise the shared backend and UI integration, not duplicate formulas in a disconnected test calculator. Use fake carrier responses and synthetic addresses/rates for deterministic fixtures. Approved contract examples and real invoice samples supplement, rather than replace, fixture tests.

| ID | Scenario | Required result |
| --- | --- | --- |
| DEL01 | One pack contains two pieces in one carton | Quantity, carton count, cost and allowance use correct distinct bases. |
| DEL02 | Several cartons, one exceeds Ground limits | No average-based Ground approval; correct supported LTL/quote result. |
| DEL03 | Supplier-mandated LTL with valid pallet/rate | LTL can return an automatic estimate; diagnostic reason is not a blocker. |
| DEL04 | Supplier method or origin changes | Old estimate invalidates; unsupported new origin routes to quote. |
| DEL05 | Same supplier PO split into two groups | Per-PO fee assessed once; piece subsidy allocated once. |
| DEL06 | Carrier charges per-package minimum | Each package is rated correctly; group minimum does not undercount. |
| DEL07 | Exactly 4,999 / 5,000 / 19,999 / 20,000 cents required | Results $49.99 / $59.99 / $199.99 / quote. |
| DEL08 | Freight fixtures in section 9 | Exact listed cents and ladder outcomes. |
| DEL09 | Zero uncovered freight | Retained $49.99 minimum, unless separate approved policy applies. |
| DEL10 | High freight exceeding ceiling | No silent $199.99 cap. |
| DEL11 | Negative contribution or unknown essential expense | No automatic sale; precise internal review reason. |
| DEL12 | Referral versus direct retail arrival | Same price/service/cart has the same delivery charge. |
| DEL13 | Trade purchase | Approved trade prices and zero purchase commission. |
| DEL14 | Zuo plus Ashcroft | Approved separate rules aggregate once; missing mixed rule routes to quote. |
| DEL15 | Multiple Zuo origins | Exact group membership; no duplicated item display or subsidy. |
| DEL16 | AK, HI, leading-zero ZIP, invalid ZIP, PO box and military | Correct region/service handling and safe user action. |
| DEL17 | ZIP-only tax unknown | No final payable total or implied $0 tax. |
| DEL18 | Full-address tax changes the required tier | Stable correct tier and processing reserve; bounded nonconvergence handling. |
| DEL19 | Exemption valid, expired or wrong organization | Only eligible verified exemption changes tax. |
| DEL20 | Price, quantity, address, service, credit or config changes | Old estimate invalidates; material changes require acceptance. |
| DEL21 | Same total but different service/tax/delivery breakdown | Reacceptance required. |
| DEL22 | Older async response arrives last | It cannot replace the newer estimate. |
| DEL23 | Carrier timeout, stale cache or missing lane | Supported fallback or quote; no invented rate. |
| DEL24 | Unsupported/unavailable line in mixed cart | No silent omission or partial payable total. |
| SEC01 | Another user's estimate/quote/intent ID | Access denied with no information leakage. |
| SEC02 | Rotated visitor ID, spoofed trade role, prices or exemption | Server authorization/rate controls remain effective. |
| SEC03 | Same idempotency key with different request/buyer | Rejected; no previous buyer details returned. |
| PAY01 | Duplicate/out-of-order webhooks or late payment | One financial outcome; correct exception handling. |
| PAY02 | Expired unpaid intent | Credit/inventory holds released; paid obligations preserved. |
| FUL01 | Mixed supplier paid order | Every unit routes once; Zuo route contains no Ashcroft items. |
| FUL02 | One of multiple shipments delivered | Parent remains partially delivered. |
| FUL03 | Actual freight higher than estimate | Internal variance only; no automatic extra customer charge. |
| RET01 | Partial cancellation/refund | Frozen tax/credit/delivery allocations reconcile; no hidden repricing. |
| CFG01 | Future version, rollback, overlap, missing approved policy | Correct effective version; no early gap or proposed-policy leak. |
| ADM01 | Duplicate invoice or adjustment retry | No double actual expense or ledger movement. |
| TRD01 | Actual retail/trade pack prices differ from generic 25% | Savings use exact approved values. |
| TRD02 | $10,000/$25,000 boundaries and excluded Zuo lines | Approved threshold basis and highest-only tier; no prohibited stacking. |
| TRD03 | Missing approved project configuration | Base trade savings can show; no invented project discount. |
| TRD04 | Lighting and mixed category referral basket | Effective category-specific rates; no trade commission. |
| TRD05 | Missing retail comparison or ineligible referral SKU | Explicit unavailable/partial state, not fabricated savings/earnings. |
| MIG01 | Approved 803-product packet | Prices, exact pack quantities, images, holds and original supplier identifiers preserved through migration. |
| UX01 | Keyboard, screen reader, 320px width, retry and quote CTA | Complete usable flow without hidden or stale totals. |

Golden tests include standalone items, two-piece sets, multiple cartons per pack, mixed Ground/LTL, multiple suppliers, remote destinations, high value/low volume, low value/high volume, sofa/sectional, and truckload requests. Rounding tests check exact reconciliation, safe integer limits and deterministic allocations.

## 20. Observability and operating targets

Measure estimate latency and success/quote/error rates by supplier, origin, destination zone, mode and service. Track stale-source blocks, missing cartons, invalid tax, price-change frequency, checkout estimate mismatches, abandoned quote requests, paid-order exceptions, freight variance, contribution-floor breaches, duplicate invoice prevention and configuration changes.

Separate expected quote-only traffic from operational failures. A large furniture project needing a quote is not a carrier outage. Dashboards report sample counts and data age; a small number of invoices must not be presented as reliable nationwide accuracy.

Proposed initial alerts: any price/paid-total mismatch or duplicate charge attempt immediately; repeated authorization failure spikes; carrier error rate above 10% over 15 minutes with at least 20 attempts; p95 latency above target for 15 minutes; any invoice that pushes an order below its assigned contribution floor; overdue manual quotes relative to the approved service target. Tune thresholds with actual volume and store them as reviewed settings.

Ops reviews the first 20 completed shipments for every pilot mode/lane grouping, then reviews weekly until the estimates are stable. That is an initial review cadence, not permission to expand nationwide after only 20 orders. Expand based on coverage, actual error distribution, service reliability and margin evidence.

## 21. Implementation phases and release gates

| Phase | Deliverables | Exit evidence |
| --- | --- | --- |
| D1 Data and policy audit | Verified pack/carton/origin data, fee bases, service scope, current pricing and cost completeness. | Per-SKU/lane readiness report; unknowns retained as holds. |
| D2 Settings and security | Typed/versioned delivery settings, effective-date correctness, ownership/capability controls, request-bound idempotency. | Configuration and access-control tests pass. |
| D3 Core engine and adapters | Correct classification, rate sources, PO/group fee allocation, subsidy, ladder, tax stabilization and safe fallback. | Golden cases and economics invariants pass. |
| D4 Product and cart UX | Shared estimator, correct quantities, stale-state handling, shipment disclosure and usable quote entry. | Retail and trade browser journeys pass without payment. |
| D5 Quote and checkout integration | Secure customer quote acceptance, full-address confirmation, exact snapshot, stock/credit handling, authorized payment verification. | Complete permitted end-to-end evidence; no unresolved payable-total errors. |
| D6 Fulfillment and reconciliation | Supplier splits, manual routes/EDI boundaries, tracking, partial returns, invoices and variance queue. | Split-order, retry, cancellation and invoice fixtures pass. |
| D7 Trade calculator alignment | Approved v2 tiers/rates, actual SKU savings, distinct referral scenario and delivery integration. | TRD01–TRD05 pass; no private-price leak or misleading combined reward. |
| D8 Pilot and expansion | Shadow comparisons, approved lane pilot, monitoring, rollback rehearsal, operating ownership. | Actual freight/service evidence supports each enabled expansion. |

Deploy changes behind scoped flags, using existing `DELIVERY_AUTOMATION_ENABLED`, `RETAIL_ZUO_CHECKOUT_ENABLED` and trade flags where appropriate. Add per-supplier/lane/service controls and a trade-calculator flag rather than only a global switch. Keep EDI disabled until its onboarding and uncertain-send recovery are independently verified.

Shadow mode computes and logs without changing current customer totals. Simulation uses proposed rules but cannot create payable estimates. Pilot exposes only reviewed SKUs/lanes/services. Do not turn on every priced SKU because the importer succeeded; product economics, availability, policies and service coverage remain separate gates.

Before release, record the deployed commit, schema/config versions, migration backup, package parity report, approved lane/rate evidence, browser verification, permitted payment evidence, return/service copy, operator ownership and rollback steps. Use normal CI deployment to avoid overwriting concurrent platform work with an older local baseline.

Rollback disables new estimates/checkout for affected routes, retains accepted/paid snapshots and queues, and keeps fulfillment, tracking, refunds and customer quote access working. Do not roll back by deleting product history, paid orders, invoices or financial records.

## 22. Decisions to record and definition of done

The build should proceed with explicit proposed defaults while unresolved production inputs are collected. Do not infer carrier prices, confirmed-zero costs or supplier exceptions from a willingness to launch.

| Decision or evidence | Recommended treatment |
| --- | --- |
| Actual carrier rates and lane coverage | Start with verified supported lanes and services; quote the rest. |
| LTL service and accessorial inclusions | Approve exact curbside/liftgate/residential scope before advertising it. |
| Supplier fee scope across splits | Verify once-per-PO versus shipment; represent that distinction explicitly. |
| Mixed supplier ladder scope | Preserve Ashcroft fee plus Zuo ladder, one displayed total; clearly scope the $199.99 maximum. |
| Missing tax/fixed costs | Resolve with verified service/configuration; never substitute zero. |
| Freshness and validity | Record approved limits; estimate expiry cannot outlast its underlying source/quote. |
| Project qualification basis | Approve eligible merchandise basis and excluded-supplier treatment; no automatic Zuo stacking. |
| Returns and service changes | Publish supplier-appropriate terms and explicit post-payment change process. |
| Production payment verification | Use only a permitted method; preserve the user's restrictions. |

The tool is complete when customers can obtain a supported estimate, understand service and split shipments, accept an accurate delivered total or request a real quote, and receive an order routed and tracked correctly; operations can reproduce the estimate and reconcile its actual cost; and every enabled route has passed the required evidence gates. A working form, an imported workbook, a passing build, or a configured API key alone is not completion.

### Source references

This spec supplements `docs/louiemae-production-catalog-delivery-partner-spec.md` and the repository `docs/production-v2/` implementation, domain, acceptance and release documents. Existing component/function names above are integration points; proposed contracts and fields must be implemented and tested rather than assumed present.

Migration protection: [PR 242](https://github.com/monicaestimon-ctrl/louiemae2/pull/242). The 803 records were verified as staged, not purchasable, after that deployment. This specification does not change that production state.

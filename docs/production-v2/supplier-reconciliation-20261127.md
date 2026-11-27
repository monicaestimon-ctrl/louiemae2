# Supplier reconciliation — November 27, 2026

The owner explicitly authorized provisional treatment of Zuo on-hand inventory as available-to-order individual pieces, pending supplier clarification. This supersedes the earlier requirement to wait for that clarification before implementing provisional stock. It does not authorize inventing counts, changing observation dates, combining warehouses, or representing the assumption as supplier confirmation.

## Inventory implementation

An approver can record `catStock.recordEvidence.provisionalAcceptance` with an owner authorization reference and the exact imported inventory observation ID. It is Zuo-only, retains `kind: on_hand` and `confirmed: false`, requires the current CA or FL count for the assigned warehouse, and requires individual-piece units. Whole purchasable packs are rounded down. Existing freshness, pack, warehouse fingerprint, reservation and other qualification gates remain applicable. Newer/conflicting source observations withdraw the accepted observation. A new source requires another explicit acceptance; there is no blanket future-feed override.

This change alone does not assign warehouses, accept production records, publish sale offers, change prices or enable checkout. Restoration of previously excluded/discontinued products and reconciliation of paid-order inventory remain separate reviewed operations.

## Pricing and supplier separation

The production source snapshot contained 803 Zuo variants. Of 644 with a positive MAP amount and known unit basis, no saved approved retail or trade price was below the recorded pack MAP. The other 159 lack a comparable MAP floor and are not certified by this comparison. Saved prices are not equivalent to currently qualified sale offers. None of the 306 public planning products had a below-MAP retail price in that snapshot.

Ashcroft's official FAQ (https://ashcroftfurniture.com/pages/faq, reviewed November 27) states wholesale plus 20% MAP for online advertising using its name/logo. Apply that floor conservatively to both channels rather than assuming a private-label exemption. It specifies no drop-ship fee, except $50 per pallet for palletized shipping; freight remains separate. Do not apply Zuo's $10-per-order fee to Ashcroft or infer pallet counts from item counts.

Read-only production comparison of 79 Ashcroft retail listings and their administrative HOLM price calculations found no price below that 120% supplier-cost floor, including the deepest configured project calculation. The legacy authenticated HOLM catalog read returned no current offers; the administrative calculation is not evidence that trade shopping is operational. Supplier cost freshness and full program economics remain separate checks.

Zuo's saved MAP policy prohibits online coupons and does not count shipping or tax toward merchandise MAP. Its separate drop-ship document uses an older different multiplier; use documented per-SKU MAP amounts rather than silently choosing a generic multiplier. Nothing found establishes a blanket below-MAP trade exemption. The owner's current direction is to remain above MAP in both channels, with trade below retail where funded, and no coupons.

Recorded and read back two production policy entries: Ashcroft's documented MAP standard, and Zuo standard trade offers subject to ordinary MAP. The latter relies on the saved policy permitting dealer prices above MAP; it is not a special trade exemption. The shared server MAP checks remain mandatory. Coupons, project-promotion stacking and credit are not authorized by that entry. This resolves the generic trade-policy register gap without enabling checkout. Receipt: `map-policy-reconciliation.json` alongside the other private audit files.

The approved Zuo expense model includes processing, returns, overhead, supplier-payment reserve, handling and embedded delivery allowances. Ashcroft has a separate implemented v2 economics engine, but its `ashcroft-pricing-assumptions` configuration was not present in the production registry audited today. Legacy Ashcroft pricing is not proof that the full common expense model has been activated. Its own freight and selling-unit basis must be retained when activating that model. Unknown landed-cost components must not be relabeled supplier-confirmed zero simply because a reserve exists; record any owner-authorized assumption distinctly.

Private operational receipts: `outputs/fedex-sandbox-verification/supplier-map-audit.json`, `ashcroft-map-audit.json`, `ashcroft-current-offers.json`, and `sales-activation-audit.json` in the main workspace. These contain dealer costs and are not public assets.

## Supplier clarification draft (not sent)

Please confirm whether the Zuo CA_QTY and FL_QTY inventory columns represent pieces or packs and whether they are available to order or physical on-hand before allocations. Please also confirm our inventory-update delivery and frequency, and whether your EDI offering supports inventory updates. We currently receive Ashcroft's daily email separately and want to keep each supplier's source clearly identified.

## Remaining release work

After this change passes review/CI, deploy and record named source-bound provisional Zuo stock acceptances using current files and assigned origins. Complete cost-component reconciliation and Ashcroft expense configuration, recompute funded retail/trade prices with MAP floors, then publish and activate eligible offers. Full checkout, tax/webhook and paid-lifecycle verification is still outstanding; no claim of a completed launch is made here.

## November 27 production qualification and checkout activation

The source refresh completed for 744 matched Zuo variants using the November 27 authorized FTP files. Original source files, modification times and SHA256 hashes are retained privately. Unmatched, discontinued and stock-excluded records were not silently restored. Ashcroft's separate active-only November 27 attachment was imported and read back: 424 supplier SKU quantities, with its original observation time and selling-unit basis.

For the included Zuo ground candidates, operations assigned the documented Stockton origin and preserved fresh carton dimensions and weights. Stock acceptance is tied to each exact CA on-hand observation, retains `confirmed: false`, and records the owner's provisional individual-piece instruction. FL counts are not pooled. Nine pieces of pilot SKU111182 permit four complete two-piece packs; a request for five packs was rejected by production.

Domestic Zuo acquisition costs were reconciled against the 2026 wholesale terms: FOB Stockton warehouse prices are the acquisition basis. The recorded zero amounts mean no additional acquisition duties, inbound freight or per-pack fees above that domestic basis; they do not assert that upstream expenses do not exist. Outbound freight and the documented $10 per-order fee stay in delivery. Approved handling, processing, supplier-payment, returns and overhead reserves remain. These findings do not apply to China direct-container orders or Ashcroft.

The pilot and 238 additional candidates passed current cost/MAP and funded existing retail/trade pricing checks without changing their approved prices. Of those additional candidates, 101 passed delivery qualification and publication; 137 retained delivery holds. All 137 held candidates were also checked against ZIP90210; none additionally qualified. A held sample returned a real FedEx account estimate of $473.28 to ZIP90210, above what the approved allowance and customer delivery tiers can fund. No allowance, reserve or price was changed to force qualification.

A production readback verified 102 qualified products visible in both retail and HOLM, and all 102 available on retail. Anonymous/unverified HOLM prices remained private. Publication, delivery automation, retail Zuo checkout and trade checkout switches are enabled; each transaction still checks current source evidence, inventory, economics, permissions, destination and tax. Referral generation, commission accrual, creator enrollment, credit and payout execution remain disabled.

Stripe's live account reports charges enabled, Tax active and an active Texas sales-tax registration. The store's missing `taxProviderPolicy/delivery-tax` was configured using Stripe's production tax-code catalog: tangible goods for furniture/decor, clothing and footwear for clothing, and associated shipping. No tax registrations or exemptions were added. The approved policy retains provider-generated tax evidence with 15-minute validity.

Pilot acceptance on production revision `25f8dad596f71b196c302e3d01cfcf59708e965a`:

- All ten benchmark destination ZIPs returned nonbinding parcel estimates using current Adelaide cartons.
- The live retail full-address estimate returned $458.06 merchandise + $69.99 delivery + $0 tax = $528.05 for the New York sample, consistent with configured registrations.
- A live unpaid Stripe Checkout session matched that accepted total exactly. It was expired without payment; the real expiration webhook moved the backend intent to `expired`. No card charge, refund, payout or supplier dispatch occurred.
- The Texas sample returned $458.06 merchandise + $59.99 delivery + $42.74 tax = $560.79. Browser verification on the real product page confirmed the same $59.99 ZIP estimate, successful add-to-cart, and the cart's matching $560.79 pay button. The button was not clicked.
- An over-stock request was rejected, Alaska required a quote, and the unverified admin account was denied trade checkout. This is permission-boundary evidence, not verified-member shopping acceptance.

Private receipts are in `outputs/production-access-audit-20261127/`: `pilot-qualification.json`, `zuo-cohort-qualification.json`, `qualified-public-readback.json`, `tax-policy-activation.json`, `checkout-provider-readiness.json`, `checkout-session-verification.json`, `checkout-boundary-verification.json`, `pilot-texas-verification.json`, `browser-pilot-check.json` and `ashcroft-stock-refresh.json`. These files contain operational details and must not be published as site assets.

### Remaining acceptance work

1. Complete Ashcroft's independent expense configuration, current cost evidence, canonical publication and funded retail/trade price review. Refreshing stock alone does not complete its v2 qualification. The saved October 20 dealer pricing packet explicitly excludes overhead, returns and the supplier-payment reserve from its contribution figures, and describes freight as category allocations from two destination samples rather than nationwide SKU quotes. Reconcile those omissions against the approved expense model before using the old margins as qualification evidence; preserve selling-unit freight allocation and avoid a second legacy merchandise gross-up.
2. Complete verified-member HOLM shopping, project and mixed-supplier checkout acceptance. The available admin login is not a verified trade member in the current server check; do not bypass that requirement.
3. Review the remaining delivery-held and noncandidate catalog records with their explicit reasons. Unsupported automatic rates require a confirmed quote; no nationwide automatic-coverage claim is made.
4. Maintain daily stock refresh and source-bound provisional acceptance. Today's acceptance does not authorize automatically accepting every future feed; stale or contradictory evidence still withdraws sale availability.
5. Finish public operator/program terms, enrollment/referral/commission/credit/payout activation, permitted paid-lifecycle verification, and final stable-release accessibility/performance/operations checks against the full specification. Historical passing tests are not blanket production acceptance.

This is a recorded production milestone, not a declaration that the full launch specification is complete.

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

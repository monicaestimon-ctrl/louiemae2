# Approved Ashcroft offer and checkout integration

## Explicit publication boundary

Existing Ashcroft listings remain legacy base prices until deliberately published by the catalog review workflow. The additive `pricingMode: approved_v2` listing field means the snapshot contains the final approved merchandise amount. Retail cards/detail, catalog reads, HOLM prices, delivery and checkout agree on that provenance. It is included in discovery projection dependencies and publication rollback snapshots. Public product and variant IDs remain the existing legacy IDs; canonical records stay internal.

The admin publication panel can prepare an existing Ashcroft product for review using its displayed revision and a review note. Preparation creates metadata in manual/category review, never cost, image, price or stock approvals. Canonical identities must already exist and match the existing listing. Category review, cost evidence, margin policy, approved channel prices, image rights/variant matching and current independent inventory remain required. Lighting must be decor. Ashcroft uses the documented per-selling-unit delivery model instead of fabricated carton or warehouse evidence. Publication rechecks final content/rate identity and all selected channels atomically. Failure rolls back both listings. Rollback restores pricing provenance as well as content and amounts.

## Retail and trade readers

A current approved offer requires an unambiguous canonical legacy identity, current supplier economics, matching approved channel amount, exact SKU and minimum/increment, and current feed capacity after internal commitments. Both channels require the delivery automation control. Retail also requires the historical `RETAIL_ZUO_CHECKOUT_ENABLED` control because it gates the shared v2 retail endpoint; trade requires its existing trade checkout control and verified membership at checkout. Stale, ambiguous or missing records fail closed. Candidate prices never authorize a sale. HOLM shows actual approved trade amounts rather than calculating the legacy universal discount.

Saved product serialization preserves checkout mode. A changed mode invalidates cart review even when the price is numerically unchanged. Approved Ashcroft carts use v2 checkout, and the old retail snapshot endpoint rejects them server-side. The legacy HOLM quote endpoint similarly directs these offers to the current project/delivery flow. Mixed legacy/unsupported project entries keep the existing explicit quote behavior. The project interface consumes each product's current checkout mode.

## Delivery and contribution

Ashcroft retains its independent category freight model and per-item customer delivery. Its scenario input binds current cost, policies, commission reserve and effective windows. Resolved lines retain cost/price IDs, feed identity, supplier-specific assumptions and expiry. Trade uses no referral commission. Approved project reductions use the existing v2 schedule and economic floor; Zuo never stacks them.

After discounts and credit, recheck MAP/mechanism eligibility and contribution. The internal base already includes modeled outbound freight less net customer delivery, so freight must not be added a second time. Actual tax-processing expense is included once address-bound tax evidence exists. An unfunded basket requires review instead of silently raising the accepted merchandise price or reducing promised commission. Ashcroft freight/subsidy is separately visible internally, while the customer receives the established combined delivery total and split-shipment terms.

## Acceptance and remaining rollout

Mocked integration covers approved retail/trade publication, stable IDs, final prices without double gross-up, independent delivery, trade membership denial, missing-cost withdrawal, disabled checkout, excessive-credit rejection, stock withdrawal, legacy endpoint rejection and rollback provenance. Existing Zuo publication and checkout suites remain required. Cart tests cover changed checkout mode; admin tests bind preparation to the displayed revision and note.

This implementation does not approve production supplier evidence, install Ashcroft pricing assumptions, enable financial flags, submit payments or establish end-to-end real payment acceptance. Apply verified records and approved settings, review the pilot images and economics, then follow the existing release checklist. SKU price/referral approval controls and remaining program/ledger/Lighthouse acceptance gaps remain tracked separately.

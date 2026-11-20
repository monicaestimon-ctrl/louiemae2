# Ashcroft delivery policy and estimate versioning

Ashcroft retains its existing category-based per-item delivery rule from `lib/retailLaunch.ts`. It does not use the Zuo $49.99–$199.99 ladder. A mixed cart adds the independently calculated shipment-group charges once, subject to the approved mixed-cart rule.

The v2 estimator reads the active `deliveryRule/ashcroft-launch` record when any Ashcroft line is present. The supported engine is `ashcroft_per_item`, with source `lib/retailLaunch.ts retailDelivery()`. A missing, expired, proposed-only or incompatible record requires a delivery quote; Zuo-only carts do not depend on that record. Staff proposed-configuration simulations remain explicitly separate from customer estimates.

The rule's ID, version, value and expiry participate in the estimate source hash, and its version is retained in the internal estimate record. Changing the approved rule invalidates the previous checkout estimate through the existing source-hash check. Estimate expiry is capped by the Ashcroft policy expiry, including ZIP-only and mixed-cart estimates. An approved configuration cannot silently substitute another formula.

## Existing amounts and model limits

| Category | Modeled supplier freight per item | Customer delivery per item |
| --- | ---: | ---: |
| Sectional | $459 | $99 |
| Sofa | $349 | $79 |
| Bench | $119 | $29 |
| Accent chair | $199 | $49 |
| Dining table | $299 | $79 |
| Dining chair / stool | $99 | $29 |
| Ottoman | $169 | $39 |
| Lighting | $40 | $19 |

The merchandise calculation remains `base price + modeled freight / 0.941 - customer delivery`, rounded upward to a dollar price ending in 9. It preserves the prior modeled contribution dollars under the existing 2.9% processing and 3% reserve assumptions; it does not guarantee an 18–20% margin after all commissions and overhead. Category freight values come from the retained October 19 Texas/Florida dealer samples, not nationwide carrier quotes. No additional $10 Zuo allocation is silently applied to Ashcroft.

The current price/margin scenario audit and supplier source documents are retained privately outside the repository. Any future price adjustment must use the full approved expense and commission scenario. Unknown fees and unavailable stock remain distinct from confirmed zero expenses and sellable inventory.

## Verification and rollout

Regression coverage verifies unchanged bench fees multiplied by quantity, version/hash changes, expiry, missing/proposed/expired/incompatible policy behavior for Ashcroft-only and mixed carts, and unaffected Zuo-only estimates. Existing mixed-cart tests continue to require mixed-policy approval and sum charges once. Tests use isolated fixture inventory and mocked financial providers.

This correction requires the backend deployment; a frontend deployment alone does not establish completion. It does not enable flags, publish products, change prices, extend inventory freshness, or execute financial tests. The seeded Ashcroft v1 policy already has approved status. V2 automatic service scope and commercial product qualification remain separate rollout requirements.

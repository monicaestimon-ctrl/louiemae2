# Ashcroft retail launch

Retail checkout uses published Ashcroft commerce listings only. Other suppliers and clothing remain Coming Soon. Supplier listings marked out of stock, plus known missing/sold-out SKUs, cannot create a payment session. Commercial quotes are unchanged.

## Pricing

Prices preserve existing merchandise contribution dollars, with a freight allowance added after the merchandise markup: existing price + supplier freight / 0.941 - customer delivery, rounded upward to a price ending in 9. The factor allows for the established 2.9% processing and 3% reserve assumptions. This preserves contribution dollars, not margin percentage. Values are calculated from the stored base price, so redeployment does not compound increases.

| Category | Observed supplier freight | Customer delivery per item |
| --- | ---: | ---: |
| Standard / power sofa | $349 | $79 |
| Sectional | $459 | $99 |
| Bench | $119 | $29 |
| Accent chair | $199 | $49 |
| Dining table | $299 | $79 |
| Dining chairs / barstools / counterstools / stools | $99 | $29 |
| Ottoman | $169 | $39 |
| Lighting (two styles checked) | $40 | $19 |

Single-item dealer checkout samples matched between the owner's authorized Texas and Florida destinations on October 19, 2026. These are category allowances based on representative samples, not a nationwide or every-SKU freight guarantee. Economy was the offered service. Do not promise inside delivery, assembly, or a guaranteed arrival date. Dealer screenshots and exact addresses remain outside the repository.

## Payment and fulfillment

The backend calculates prices and delivery, saves an immutable checkout snapshot, and sends its reference to Stripe. The signed paid webhook validates totals and records the original supplier SKU plus customer delivery details. Ashcroft orders bypass CJ and are placed manually by the owner after real payment. Admin orders display the supplier SKU.

Production must use live Stripe credentials and a live signed webhook for real orders. Verification during staging found an existing test key; live account setup is being checked before domain promotion.

## Validation

Frontend and Convex type checks, catalog-writer verification, production build and client-secret scan passed. Full suite passed 712 tests initially; four load-related timeouts passed on focused rerun (20 tests). The final pricing/checkout/homepage group passed 32 tests. Backend dry-run and deployment confirmed no removed indexes. Live production API returned authoritative catalog prices and created an unpaid Stripe test session; no payment or dealer order was placed.

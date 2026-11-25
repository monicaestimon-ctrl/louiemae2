# Launch completion ledger ? 2026-11-24

Full completion requires merged code, deployed configuration and observed production acceptance. Passing fixture tests are not operational evidence.

## Current release

Remote main is `0d9c468bbe4402a128694bd2383f0b72b89cf044` (PR 372), verified against origin on November 24. Root checkout is preserved. Shipping follow-up uses `codex/zip-delivery-estimator`.

## Sequence and remaining work

| Step                | Status                                      | Required evidence / next action                                                                                                                                                                       |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shipping accounting | Existing implementation; acceptance pending | Replay actual selected cartons, supplier groups, allowances, fees, reserve and tier boundaries; verify allowance deducted once.                                                                       |
| Rate coverage       | Incomplete                                  | Ten exact benchmark ZIPs are not nationwide coverage. Select authenticated rate source, verify billable cartons and residential/accessorial inputs, compare against benchmarks and supplier invoices. |
| Product estimator   | Implementation in this branch               | Debounced ZIP/quantity recalculation, retained ZIP, stale-response rejection, manual retry, permanent nonbinding disclosure. Test and deploy before marking complete.                                 |
| Catalog             | Incomplete; last audit historical           | Re-read qualification counts; resolve each selected product or record explicit unavailable reason. Do not equate physical stock to confirmed selling units.                                           |
| Settings            | Incomplete; last audit historical           | Reconcile active versions and pending proposals; activate only supported scope.                                                                                                                       |
| Shopping            | Incomplete                                  | Guest/retail/trade cart and project flows, supplier separation, tax, address changes, stock changes, frozen payment and fulfillment verification.                                                     |
| Partners            | Incomplete                                  | Enrollment, terms, referrals, commissions, credits, Connect and payout lifecycle evidence.                                                                                                            |
| Release             | Incomplete                                  | Frontend/backend receipts, accessibility, Lighthouse, monitoring, rollback and permitted financial verification.                                                                                      |

## Shipping source decision

The saved Zuo Drop Ship Policy recommends FedEx/UPS estimates using origin 95206, cartons, weight and distance. It states Zuo prepays freight and passes its discounts through on the shipment invoice. The actual drop-ship fee is $10 per order, not per carton. Its $315 standard-pallet example must not silently become a current nationwide tariff.

Official FedEx Rates and Transit Times documentation supports origin/destination estimates with public list or account-specific rates and surcharges. Freight uses a separate LTL API and enabled freight account. A live public quote can provide a better current benchmark than ten stored ZIPs, but cannot be labeled Zuo's negotiated invoice rate. Credentials and rating-account applicability still need inspection; no live provider connection has been established in this branch.

Sources reviewed November 24:

- https://developer.fedex.com/api/en-us/catalog/rate.html
- https://developer.fedex.com/api/en-us/catalog/ltl-freight.html
- Private saved source: `outputs/zuo-dealer-documents-2026-11-05/extracted/Drop Ship Policy.txt` in the root checkout (not published with this document).

Prefer a supplier-compatible live rating source. If using public rates, retain modeled/benchmark provenance and calibrate against actual invoices. Do not interpolate unsupported ZIPs from ten samples or use map distance alone as a tariff. Keep supplier fees/reserves/embedded allowances in the existing shared server accounting, not the rate adapter or browser.

No flags, merchandise prices, checkout eligibility or production data are changed by this UI increment. Nationwide rate integration and full launch remain outstanding.

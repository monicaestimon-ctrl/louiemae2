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

## Production follow-up after PR 373

- PR 373 merged as `bf375ee587f96a2bcd3962fcd31fd9203b452ea8`. Vercel production deployment `dpl_3tHA5ZUsKkchdv2fXGAUircj9SKn` is Ready, assigned to the public domains; public build-info matches the merge commit. Home, trade and shop returned HTTP 200. These HTTP checks do not certify complete shopping flows.
- Product estimator tests: 19 passed. Subsequent modeled-parcel, engine and checkout regression run: 113 passed.
- Read-only production inspection found no FedEx, UPS, Shippo, EasyPost or freight credential names in Convex, Vercel production settings or the inspected local environment files. A provider account question is pending; no secret values were printed.
- Active carrier configuration remains version 2, ten exact modeled ZIPs, 10% uncertainty reserve and $10 supplier order fee. Estimate validity is 30 minutes. No approved versions exist for the Zuo curbside delivery rule, delivery controls or delivery monitoring policy.
- Eleven proposed configuration records remain. These are not eleven missing policies: the old proposed freight record coexists with the newer approved version and must not replace it.
- Current catalog tables contain 803 product metadata records and 882 variants. Counts do not establish publication or checkout eligibility.
- Individual configuration approval was found to allow a superseded proposal to retire a newer approved version. The follow-up change adds the same latest-version safeguard already used by atomic delivery approval, before any record retirement or audit writes. Tests cover both a newer approved policy and a newer pending proposal, and confirm the latest proposal remains approvable.

Full launch is still incomplete. Provider connectivity, catalog qualification, configuration activation and end-to-end operational verification remain required.

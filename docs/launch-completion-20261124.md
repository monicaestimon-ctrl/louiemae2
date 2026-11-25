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

## November 25 configuration and catalog reconciliation

PR 374 is merged as `5b9dea86957a266823f03c56ee7395feed9b6880`; production frontend commit matched and Convex deployment succeeded. Individual approvals now reject superseded versions. The follow-up register UI labels those old proposals, excludes them from the actionable count and release selection, and disables individual approval while retaining rejection/history access.

Read-only catalog census at 2026-11-25T07:04:26.635Z: 803 product metadata records, all imported drafts; 882 variants; availability is unknown for 660, out of stock for 205, discontinued for 17. There are no canonical retail mapping records. These counts concern the canonical catalog, not every legacy storefront listing. Per-variant dispositions were saved privately in `outputs/production-access-audit-20261125/catalog-disposition.json` in the root checkout.

Next catalog actions: verify staged canonical identities through the existing guarded publication action; reconcile the 803 mapping holds; finish exact-SKU image/rights review, current selling-unit stock evidence, channel price/commission qualification and supplier-specific delivery. Do not blanket-clear the 882 manual holds. The 62 absent-source/carton records and five method-change records require individual source reconciliation.

### Zuo integration lead

The owner is creating a FedEx account. Zuo's own June 18, 2025 article explicitly mentions tailored FTP, EDI and API integrations: https://zuomod.com/why-live-customer-service-and-local-sales-reps-matter-more-than-ever-in-furniture-especially-for-hos/ (reviewed November 25, 2026). This establishes an integration lead, not evidence of a live shipping-quote endpoint.

Ask Zuo whether its dealer integration returns pre-order freight quotes for SKU quantities and destination ZIP, whether quotes use dealer-account rates, include residential/liftgate/fuel/accessorial charges, and provide a quote ID, expiry and response time suitable for checkout. Request supported EDI transaction sets or API documentation and sandbox access. Order acknowledgements, shipment notices or invoices alone do not establish live quoting. Invoice freight can support later calibration. No supplier message has been sent and EDI remains disabled pending documented capability and onboarding.

## Canonical identity reconciliation preparation

PR 375 production frontend now reports `db620f782b9d510f901a0b7c53ae75ef7d8b7805`.

The November 25 production identity preflight identified 576 Zuo variant candidates from current staged product/SKU/pack/draft identity. Another 227 variants remain outside this batch: 226 excluded or missing staged products and one additional discontinued variant. These are preliminary identity candidates, not approved or purchasable products. The private candidate list is `outputs/production-access-audit-20261125/canonical-identity-candidates.json` in the root checkout.

`catPublication:reconcileStagedIdentity` is an internal, deployment-only maintenance operation with explicit product and variant IDs. Default calls are dry runs. It reuses the staff identity verifier, validates supplier/SKU/pack/draft identity and active mapping conflicts, and reports the product revision and number of mappings to create. Commit calls must include `commit: true` and the reviewed `expectedRevision`. Each call accepts 1?50 distinct variants of one product and commits atomically. The audit actor is explicitly `deployment:catalog-identity-reconciliation`, not an impersonated staff account.

After merge/deploy: run the candidate manifest through server dry runs, retain failures per variant, compare returned revisions with the manifest, then commit the verified records through the same operation. Read back mappings, remaining holds and publication state. Mapping reconciliation must not change stock, cost, media rights, commissions, stage, flags or listings. Preserve unavailable and excluded records until their own evidence gates pass.

## Production qualification review after PR 376

PR 376 merged as `1adc38b2de5af1d35a21f3318a21dfc776c2861d` and frontend/backend deployment were verified. All 576 identity candidates passed server dry runs with matching revisions and committed successfully. Readback confirmed 576 active mappings, no unrelated variant changes, unchanged product metadata/listings and 227 remaining mapping holds.

The mapped cohort already has 576 retail approvals, 576 trade approvals and 576 cost revisions; none has a confirmed stock revision. The actual media table (`catMediaAssets`) contains 576 assets for these products: 517 verified and 59 pending. Verified assets carry a separate unresolved publication-rights basis; image verification is not a supplier license.

The saved Zuo Welcome Packet's Advertising Products section requires written request and retailer authorization before online use of supplier intellectual property. Do not clear MEDIA_RIGHTS from image availability alone. All 576 current cost revisions leave duties, inbound freight and supplier fees unconfirmed; no zero expense was inferred.

Ran the existing `catStock:refreshPage` production workflow. Readback cleared 91 outdated COST_STALE holds in the mapped cohort, added the 576 cost-completeness holds that current evidence requires, and retained all 576 identity mappings. Remaining mapped-cohort exceptions include 136 MAP applicability holds, 134 MAP floor holds, 59 source/carton/media/stale-cost holds and three shipping-method changes. Per-variant evidence and receipts are retained in the private November 25 audit folder.

### Independent catalog freshness monitoring

The hourly catalog refresh previously shared the owner-paused `BACKGROUND_MONITORING_ENABLED` switch with CJ pricing/product-health monitoring. `CATALOG_FRESHNESS_ENABLED` is now an optional override: unset preserves the old behavior, true registers only the catalog refresh independently, and false pauses that refresh. It does not enable checkout, supplier synchronization, CJ monitoring, publication or financial jobs.

After merge, set `CATALOG_FRESHNESS_ENABLED=true` on `prod:diligent-jay-261` and deploy the reviewed release to register the hourly job. Keep `BACKGROUND_MONITORING_ENABLED` unchanged. Verify the deployed cron configuration and retain the flag readback. To roll back this schedule, set the catalog flag false and redeploy. The one-time freshness refresh has already run; do not confuse this with hourly monitoring activation, which is still pending this release.

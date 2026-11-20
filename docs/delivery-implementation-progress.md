# Delivery implementation and release evidence

Updated 2026-11-09. Read with [the full specification](louiemae-delivery-estimator-end-to-end-spec.md), [the phase ledger](delivery-goal-phases.md) and [release runbook](delivery-release-runbook.md). The original implementation evidence below is retained as a dated baseline; subsequent deployment receipts and remaining work are tracked in the phase ledger.

## Status

The delivery engine, customer/staff interfaces, tax adapter, quote workflow, checkout protection, reconciliation and approved-price trade calculator have been merged and deployed, followed by the fixes recorded in the phase ledger. PR 272's frontend and Convex production deployments are verified. Deployment is not rollout activation or an operational completion certificate: catalog evidence, current carrier coverage, visual/rights review and permitted payment verification remain required. No live test payments, transfers, payouts or bulk catalog activation occurred. Production media preparation completed for 577 included sources with zero processing errors; 226 excluded/no-source records were skipped, and preparation does not approve images for sale.

The actual 803-product packet replay passed all 20 catalog tests, preserving prices, packs, images, identifiers and holds. Migration parity is not current supplier-stock or carrier-coverage verification.

## Implementation map

| Area | Files and behavior |
| --- | --- |
| Policy | `lib/config`, `sysConfig`: typed versions, future dates, approval roles, disabled proposed scope, supplier fee basis, project eligibility basis. |
| Engine | `lib/delivery/engine.ts`, `lib/shipping/classify.ts`, `dlvEngine`: per-carton classification, verified origin/rate evidence, parcel minima, conservative pallet model, fee allocation, contribution-limited allowance, exact ladder, bounded tax iteration. |
| Estimates/checkout | `ProductDeliveryEstimate`, `CheckoutV2`, `dlvEstimates`, `dlvSecurity`, `ordCheckout`: pack validation, address/phone, guest capability/account ownership, source expiry, throttles, duplicate prevention, frozen payment inputs, stale-response protection. |
| Quotes | `DeliveryQuoteRequest`, `DeliveryQuoteStatus`, `dlvOperations`, `dlvManual`, `ordQuotes`: persistent requests, duplicate-safe retries, private recovery, assignment, information requests, confirmed freight/tax, versioned acceptance, secure payment preparation. |
| Trade | `TradeDeliveryCalculator`, `dlvTradeCalculator`, `dlvProjectPricing`: actual approved pack prices, shared checkout/project helper, Zuo exclusions, separate retail-referral scenario, v2 effective commissions. |
| Fulfillment | `ordPayments`, `ordFulfillment`: verified event processing, paid exceptions, supplier/origin/service children, split disclosures, frozen tax/delivery allocation. |
| Tax | `dlvTaxActions`, `dlvTax`, `dlvTaxExemptions`: address-bound calculations, verified organization exemption, line taxes, durable sale reporting, reviewed refund reconciliation. Adjustments do not issue payment refunds. |
| Admin | `DeliveryOperations`, `DeliveryDiagnostics`, `DeliveryActualCosts`, `dlvAdmin`: queue, coverage, readiness/export, inspector, proposed-policy simulation, invoice evidence and sample-count calibration. |
| Access | `dlvAccess`: canonical admin first; delivery staff roles; explicit role map fails closed. Existing admins remain owners only while no map is installed. This does not replace all legacy platform permissions. |
| Actual costs | Append-only invoices/statements; unknown expenses stay unknown; new evidence invalidates final status; negative/below-floor reviews; no customer recharge. |

The $10 merchandise allowance per physical piece is distinct from the supplier's actual per-order fee. Subsidy is a use of merchandise contribution, not a second invoice expense. Partial returns preserve cents and separate shipping tax.

## Local evidence

- Final full suite: 154 files; 1,025 passed, four timed out, one optional packet test skipped. All four timeout files passed when rerun with one worker (17/17 tests), including migration, inventory targets, money precision and import UI. The full-suite command itself did not exit successfully; the targeted rerun resolved its failures. Localhost socket and security tests passed in this final full run.
- Final checkout rerun after actual-floor/schema fixes: 28/28. Focused engine 12/12, config 5/5, security 5/5 and UI 3/3 passed. The focused run's checkout failures were corrected and rerun.
- Actual packet replay: 20/20, including all 803 records.
- Final general and strict Convex type checks passed. Repository lint passed excluding two pre-existing untracked operational scripts that are not in this PR; existing warnings remain. Repository-secret scan passed for 1,102 tracked files, catalog guard covered 58 entry points and append-only guard passed for 156 Convex files. Final build and CI results are recorded with the PR.
- Production build included environment/client-secret checks; existing large-chunk warnings remain.
- Chrome exercised the actual PDP delivery component with mocked hooks: keyboard ZIP/pack submit, $79.99 fixture result, stale-price removal, Alaska quote fallback, consent validation, saved request and 320px layout. No real provider/customer/payment connection; not a live browser-to-Convex or screen-reader certification.
- No real test payments/transfers/payouts or alternative remote payment testing. Financial tests are in-process fixtures.

## Acceptance traceability

IDs refer to specification §19. Fixture evidence is not provider certification; grouped scenarios share the listed test suites.

| IDs | Evidence / boundary |
| --- | --- |
| DEL01–06 | Checkout/engine pack minimums, fee allocation, parcel minima, LTL/origin gates. Real multi-origin and pallet evidence required for pilot. |
| DEL07–10 | Engine exact boundary, monotonic and worked-example tests; no cap above $199.99. |
| DEL11–15 | Mixed suppliers, negative/unknown economics, approved trade and nonstacking fixtures; commission reserve independent of referral arrival. SKU readiness remains separate. |
| DEL16–19 | Destination, full-address tax and organization/expiry/revocation exemption fixtures. Actual tax registrations and lanes unverified. |
| DEL20–24 | Source changes, same-total/different-breakdown, missing lanes/costs and stale UI response tests. Provider latency/failure behavior needs deployed evidence. |
| SEC01–03 | Capability/account denial, spoofed prices/trade, basket throttles, request-bound idempotency. Trusted perimeter/IP controls require deployment configuration. |
| PAY01–02 | Duplicate/late/mismatched events and expired reservations in-process; no live payment verification. |
| FUL01–03 | Supplier split, partial shipment/cancel, Zuo-only handoff, invoice variance fixtures; real acknowledgement/tracking unverified. EDI disabled. |
| RET01 | Frozen allocation and sequential cent tests. Provider tax reversal remains reviewed external work, separate from cash refund. |
| CFG01 | Future-date/overlap/proposed-policy tests. Rollback needs deployment rehearsal. |
| ADM01 | Invoice retry/conflict, credit note and actual-cost tests; tax evidence closes matching review items. |
| TRD01–05 | Approved-price/project/Zuo tests; category seeds and lighting migration. Production trade browser journey remains required. |
| MIG01 | All 803 actual packet records replayed with identities/holds preserved. |
| UX01 | Three component tests and Chrome keyboard/320px fixture. Screen reader and deployed complete journeys remain unverified. |

## Production gates

1. Dated account-specific rates, lane/service/pallet/accessorial evidence, origin, supplier fee basis, fixed payment costs and freshness. Public freight examples are not contracted nationwide rates.
2. Approved tax codes/registrations/provider readiness and organization exemption evidence. No fixture code becomes approved policy.
3. Current SKU cost/MAP/mechanism, stock, cartons, price and commission coverage. Held variants remain blocked.
4. Reviewed staff map and hosting perimeter controls. Application budgets cover account/basket/global usage, not trusted IP identity.
5. Deployed notifications/private recovery, service/return copy, keyboard/screen-reader and permitted payment verification. Existing payment-testing restrictions remain.
6. Named owners for quotes, invoice/tax reconciliation and queues. Spec carrier-error/p95/SLA thresholds are proposed operating targets, not active alerts.
7. Real pilot invoices before expanding lanes. Passing fixtures cannot prove nationwide accuracy.

## Provider references

[Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create) requires at least 30 minutes of session lifetime. The frozen intent/session uses 35 minutes with setup headroom; source-bound estimate validity remains separate. [Idempotent retries](https://docs.stripe.com/api/idempotent_requests) require identical parameters.

Tax uses [calculations](https://docs.stripe.com/api/tax/calculations/create) and [sale transactions](https://docs.stripe.com/api/tax/transactions/create_from_calculation). [Partial reversals](https://docs.stripe.com/api/tax/transactions/create_reversal) need reviewed allocation, not an inference from cash refunded. No remote provider calls were exercised here.

## Phase 6n — explicit modeled parcel rating

Owner direction: initial normal-order delivery uses approved estimates from the saved supplier documents and public benchmarks; exact account-specific destination rates are not required. They remain planning estimates, not contracted carrier quotes.

Carrier settings now distinguish supplier rates from modeled parcel tables. The modeled table records its source hash/date and rates by zone and whole billable pound, with explicit carton count, longest/second-longest side, girth, volume and actual-weight limits. Each carton is rated separately, dimensional weight still applies, and the uncertainty reserve is applied once. Source validity dates, destination controls, supplier methods, funded subsidy, margin floors, payment expense and the customer delivery ladder remain enforced by the existing engine.

Missing zones/weights, LTL, oversized cartons and unsupported shipments require a quote. The modeled path never falls back to supplier rates or treats a planning table as a confirmed LTL price. The runtime table must be approved and populated separately; this code does not invent or activate national rate coverage.

Validation: existing checkout suite and config tests; modeled parcel unit tests for independent carton rounding, dimensional weight, unsupported counts/dimensions/weights/zones, supplier LTL and provenance validation; integration test for uncertainty reserve and source expiry.

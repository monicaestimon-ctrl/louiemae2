# Legacy retail supplier-cost eligibility

Ashcroft's legacy retail catalog, product detail, saved-cart review and authoritative checkout snapshot must agree that each offered variant has a valid positive supplier cost and an explicit currency conversion. USD requires a conversion of 1. Missing, nonfinite, nonpositive or unsupported converted costs must not become a zero expense or an implied 1:1 conversion.

Keep the product record and its listing content. Withdraw purchase eligibility and reject new checkout snapshots before inserting an order snapshot or reserving credit. Recheck the stored fulfillment variant on the server; a browser's previous catalog response does not override the current guard. Existing paid orders and historical earned commissions retain their recorded terms.

This narrowly scoped guard verifies presence and numeric validity. It does not certify supplier invoice freshness, all duties and fees, modeled delivery coverage, referral profitability or the complete v2 margin policy. Those remain separate audit and migration requirements. It does not change prices, stock, rollout flags or supplier fulfillment.

Isolated regression evidence covers missing fulfillment, zero cost, invalid USD conversion, current positive inventory, storefront and legacy catalog consistency, saved-cart withdrawal, snapshot rejection without a new record, and the existing mocked checkout, store-credit and commission suites. A passing mock is not a production payment test.

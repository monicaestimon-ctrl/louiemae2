# Trade services without a purchasable catalog

The Hub and trade application are independent entry routes, like account and staff management. A cold visit to `#hub` or `#trade` resolves account identity without subscribing to the product catalog. Existing catalog draft owners remain mounted but suspended while an independent route is open; viewer changes still discard the prior viewer's state.

The Hub skips private quote/application reads for anonymous visitors and offers sign-in with a Hub return destination. Signed-in visitors receive explicit loading, bounded query-failure and manual retry states. Unresolved reads are not presented as an empty quote history. Account navigation and catalog recovery both link to the Hub. Trade applications skip their private application query until signed in.

Trade benefit copy describes eligible approved prices and project savings, not a universal discount on every piece. This routing change does not approve memberships, alter supplier evidence, enable checkout, make unavailable products purchasable or activate financial execution.

Validation uses isolated identity/query fixtures and actual routing/UI code: cold empty-catalog Hub access, no catalog subscriptions, anonymous private-query exclusion, saved quote display, loading/retry, role loss, responsive layout and accessibility. The existing draft-preservation tests include Hub and application transitions. Real authenticated production acceptance remains separate.

# CJ pricing review

CJ pricing review and recurring margin monitoring, September 23, 2026.

The CJ settings page now contains a paginated list of approved products with a CJ catalog link, original source link, and a price review for each sellable mapped variant. Refresh queries CJ catalog prices and one-unit U.S. freight estimates. It records the origin, carrier, returned tax/clearance fees, and timestamp. Missing data remains unavailable and blocks publication. Estimates are not guaranteed customer-address freight or net profit; unquoted fees, processing, advertising, and returns are excluded.

The current formula remains 2 × CJ variant item cost + quoted shipping + returned fees, using the existing .99 rounding. Refresh applies this automatically only to unlocked hidden/next-launch products, updating each variant's price adjustment. It preserves live and locked prices. Publication requires every sellable variant to match a complete quote for the current CJ product, checked within 24 hours, and retail at least the current formula's result. Individual publishing, launches, and the shared retail publishing path enforce the check. Existing live listings are not automatically unpublished.

The durable sourcing queue no longer passes retail price as CJ's target purchase price. Old prepared requests are sanitized before sending and their stored payload/hash are updated. Previously accepted requests are not resubmitted or rewritten.

Validation: pricing-policy, persistence, legacy-target, and React screen tests; existing sourcing and pricing tests; TypeScript check; production build and client-secret check. No real supplier quotes or account data were fetched in these tests. A live check is required after deployment, including checking the generated CJ listing links and returned inventory origins.

Sources:
- https://developers.cjdropshipping.com/en/api/api2/api/logistic.html
- https://developers.cjdropshipping.com/en/api/api2/api/product.html

Automatic monitoring checks up to 10 oldest-due approved products every 15 minutes, targeting a daily check per product (up to 960 per day). Calls share the existing CJ request limiter. Per-product leases avoid concurrent refreshes. Background monitoring does not change retail prices. Increases, decreases, missing quotes, low pricing, and request failures create persistent dashboard alerts. Acknowledgment is separate from pricing readiness. These are in-app alerts, not email or push notifications.

The last complete quote is retained as a comparison baseline through partial failures. Fresh failed checks block publication even if an older quote exists. Existing accepted sourcing tickets are left intact; the purchase-target fix applies to future sends, including queued prepared attempts.

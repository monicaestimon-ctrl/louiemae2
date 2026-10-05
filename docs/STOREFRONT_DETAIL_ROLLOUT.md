# Full selected-product detail prerequisite

`products.getStorefrontDetail` reads one product, applies the existing storefront
visibility/fulfillment/inventory rules, and returns the public field allowlist
with the complete description, images and customer options. Supplier payloads,
source URLs, private CJ identifiers and mapping evidence remain excluded.
Invalid or retired configured IDs return null. Existing `get`, list and search
contracts keep their current limits.

The store modal requests detail only for an opened product. Loading, deleted and
unavailable products have explicit states, with a close action. Variant selection
stores an ID and resolves it against current detail, so price updates apply and
deleted/out-of-stock options cannot remain a stale cart selection. Featured page
sections resolve their configured product ID independently of a catalog page.
The homepage's static sample product cards retain their existing behavior.

Deploy the backend before its frontend consumers. This prerequisite does not
require catalog activation and does not replace either full catalog subscription.
It adds a selected-record read; savings depend on the later compact-reader cutover.
That cutover must preserve whole-catalog search/filter semantics, editorial
selections, complete descriptions/options, inventory and checkout behavior.

Validate after service restoration: open a visible product with many options,
select an option, update its price/stock from another admin session, verify the
cart state, close/reopen, hide/delete a product, and view a featured product
outside the first catalog page. Live authenticated checks remain pending while
the Convex team is disabled.

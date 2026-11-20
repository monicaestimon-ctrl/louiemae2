# Public product document handoff

The controlled production run 44046790703 retained useful server HTML, but product routes were not interactive at the audit boundary. Their scores therefore did not meet the readiness acceptance gate.

The server now includes a short-lived public product snapshot from the same anonymous detail query used to render its HTML. The client can render that product immediately while establishing its live subscription. This is data reuse, not a substitute for a live availability check at checkout.

## Data and failure contract

- Explicit allowlist: public identity, name, description, category, collection, retail price, images, stock, variants, public fulfillment provider and delivery fee. Never serialize supplier costs, trade prices or fulfillment mappings.
- Escape script boundaries; limit the document payload to 256,000 characters, 100 images and 1,000 variants. Invalid data uses the ordinary live-query path.
- Require matching product identity, schema version, JSON script type and a timestamp less than 30 seconds old. Reject future timestamps beyond five seconds of clock skew.
- Use the snapshot only while the matching live query is pending. A live missing-product result, transport failure, query timeout or expired snapshot removes the purchase-ready fallback. Fresh live data always wins.
- Remove the snapshot on navigation to another product or page and on application failure. Variant selection remains explicit; invalid variants never substitute another option.
- Keep no-store server responses and existing server-side checkout validation. No inventory, price, commission or supplier qualification rules change.

## Verification

Unit tests cover public-field serialization, unsafe script text, stale/malformed/mismatched data, live withdrawal, subscription failure, expiry and API output. Browser checks cover server-only HTML, interactive handoff, missing products and invalid variants. A local desktop Lighthouse diagnostic reached ready state at audit completion with four scores of 100. This is diagnostic evidence only: the pinned repeated production suite must run after release, with all results retained and readiness still required.

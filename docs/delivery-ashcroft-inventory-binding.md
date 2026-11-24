# Ashcroft inventory-bound delivery estimates

This phase strengthens the existing Ashcroft per-item delivery path. It does not activate HOLM trade checkout or qualify canonical costs/prices.

## Server behavior

- V2 estimate resolution requires a current Ashcroft inventory feed. The legacy no-feed availability fallback is insufficient for a new v2 estimate.
- Resolve quantity at the calculation timestamp. Missing SKU, expired/future feed and insufficient quantity reject the line. Minimum and increment are enforced in selling units, without multiplying a set by guessed physical contents.
- Include feed identity, content hash, effective timestamps, the selected SKU quantity, listing revision, option, fulfillment row and retained delivery rule in the line dependency hash.
- Cap both Ashcroft-only and mixed-cart estimates by the earliest line evidence expiry, in addition to policy and tax expiry. A refreshed source invalidates the old dependency hash even when the public delivery charge is unchanged.
- Resolve category explicitly from product metadata and listing text. Lighting is décor for newly resolved transaction snapshots. Unknown categories require review; historical earned commissions and accepted snapshots are not rewritten.
- Preserve Ashcroft's existing per-item customer delivery formula and merchandise pricing. Zuo's allocation and delivery ladder are not substituted.

## Acceptance

Mocked integration tests cover inventory absence, expiry, future dates, missing SKU, insufficient quantity, changed source hashes, mixed-cart expiry, selling-unit minimum/increment and lighting classification. No real order, payment, transfer or payout is used for validation.

Remaining work includes the supplier-specific cost/economics adapter, deliberately approved canonical channel prices, actual trade/project pricing, activation and authorized checkout lifecycle verification. Identity preparation alone is not approval of any of these.

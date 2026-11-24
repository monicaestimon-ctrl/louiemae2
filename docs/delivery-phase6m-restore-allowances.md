## Phase 6m — preserve delivery allowances during staged import

The original staged migration retained retail/trade prices but assigned UNKNOWN to every parcel product. That disconnected approved per-piece delivery allowances from their pricing model.

The converter now maps the packet's explicit allowance values ($15/$25/$40/$60/$100) to the existing approved allowance classes. This is a pricing allocation, not a shipping-service decision: actual cartons and supplier shipping method still determine parcel/LTL/quote routing.

An internal deployment-admin reconciliation restores missing classes from the exact hash-bound preserved source. It requires exact SKU/pack identity, checks the allowance against current approved pricing assumptions, supports dry run and safe retries, and refuses to overwrite a different known class. It preserves prices and all publication, stock, rights and freight holds; economics must be requalified afterward.

Validation includes conversion coverage for every approved allowance, invalid-input rejection, production-style dry run/retry/source-change safeguards, and preservation of approved price revisions and unrelated gates.

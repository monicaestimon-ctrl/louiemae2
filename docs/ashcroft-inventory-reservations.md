# Ashcroft inventory reservations

The v2 delivery and checkout path reserves Ashcroft selling units against its independently dated inventory feed. This does not reserve stock with the supplier and does not enable trade checkout or publish an offer.

## Source and quantity rules

Require the exact Ashcroft supplier/product/legacy-variant/SKU identity, selling-unit pack marker, current feed and valid nonnegative whole-unit count. A missing SKU is unknown. Explicit out-of-stock or discontinued status blocks a new purchase. Do not invent a warehouse or multiply a set into physical pieces. Zuo retains its warehouse/pack/available-to-sell model.

A new Ashcroft reservation records its supplier SKU, selling-unit inventory basis and feed ID. Estimate calculation and checkout intent creation subtract other unexpired held quantities and all unreconciled consumed quantities. The serializable checkout mutation performs the current read and inserts its hold together. Retrying the same intent does not consume another unit. Expired unpaid holds stop consuming capacity; paid obligations do not expire merely because the original checkout window passed.

## Payment and recovery

A verified payment event rechecks current supplier identity, original hold quantity/basis, expiry and the current feed after excluding only the paid intent's own holds. Missing stock, stale evidence or conflicting commitments creates a paid-order exception; it does not create supplier orders, repeat a payment or discard the paid demand. Duplicate events retain one exception/obligation. Missing historical holds are preserved with unknown scope and require explicit recovery rather than guessed evidence.

Recovery of the original paid order retains the existing exact-payment, no-prior-handoff, customer-agreement and fresh operator-confirmation checks. It additionally checks Ashcroft's dated inventory after other commitments. Only that reviewed recovery may fill the missing selling-unit basis. When another consumed historical row lacks a source basis, reviewed recovery may conservatively deduct its quantity only if its immutable paid intent proves the exact Ashcroft product, SKU and positive selling-unit count. It does not repair or release that other row. Ordinary sale estimates still fail closed until its review is resolved. Accepted prices and delivery totals remain unchanged.

## Supplier-allocation reconciliation

A newer feed alone cannot release paid inventory. An approver must select the current feed, provide evidence and a note, and confirm that its count already includes the exact allocation. The server requires a newer source than the original hold, a source at or after payment, a completed parent order, and recorded supplier handoff/acknowledgement for the full allocation. A stale selected feed or changed retry is rejected. Reconciliation operates on the entire consumed reservation group for the same intent and variant. The group quantity must exactly match the original paid lines and full acknowledged allocation; all group rows are reconciled atomically. For historical rows without an original feed, the original paid snapshot must prove their identity and selling-unit quantity; the current post-payment source and acknowledgement are still required. Missing original feed fields remain missing, with the reviewed reconciliation source recorded separately. Successful reconciliation stores the feed reference and audit event once. An out-of-stock state cannot prevent reconciliation of an otherwise documented paid obligation.

The admin panel labels Ashcroft quantities as selling units, identifies the current feed, preserves unsaved notes on updates and requires review again if the feed/allocation changes. Other suppliers retain warehouse-stock revision selection.

## Verification and boundaries

Deterministic tests cover competing carts, retries, unpaid expiry versus consumed demand, missing holds, unknown historical basis, stock drops and source expiry during payment, duplicate events, feed refresh without acknowledgement, authorization, reconciliation idempotency and stale admin forms. Payment/supplier operations are mocked. No actual payment or supplier order is submitted by these tests.

This phase does not switch the legacy retail checkout to v2, activate trade purchasing or establish final product qualification. Approved offer provenance, supplier-specific basket economics, publication and the remaining release gates still precede activation.

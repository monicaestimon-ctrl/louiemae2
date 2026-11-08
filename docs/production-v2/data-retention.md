# Data retention and privacy (v2 S38, v2 §21)

| Data | Tables | Purpose | Retention | On account deletion |
| --- | --- | --- | --- | --- |
| Orders, order lines, supplier orders, shipments | `ordOrders`, `ordOrderLines`, `ordSupplierOrders`, `ordAllocations`, `ordShipments*`, `orders` | Fulfillment, tax and accounting | 7 years after payment (tax and accounting) | Name, email and address are replaced with a tombstone after the legal period. Amounts are kept. |
| Commission and credit ledgers | `ldg*`, `holmCommissions`, `holmCredits` | Financial records owed to partners | 7 years after the last event | Kept, linked to an anonymized beneficiary |
| Payout attempts and bank observations | `ldgPayoutRuns`, `ldgTransferAttempts`, `ldgBankPayouts` | Reconciliation | 7 years | Kept (no bank details are ever stored, only Stripe ids) |
| Referral clicks | `prgReferralClicks`, `holmClicks` | Attribution within 30 days, then disputes | 13 months, then deleted. Visitor ids are stored only as one-way hashes. | Click rows linked to the account are deleted |
| Attribution snapshots | `prgAttributionSnapshots` | Proof of the rate paid | Kept with the order | Kept, with no PII |
| Memberships, terms acceptances, organizations | `prg*` | Program administration and proof of consent | While active, plus 7 years for acceptances | Profile text and URLs are deleted. Acceptance rows are kept. |
| Payment events | `sysPaymentEvents` | Durable processing and audit | 2 years | Kept (payloads hold no card data) |
| Audit events | `sysAuditEvents` | Who changed what | 7 years | Kept |
| Notifications outbox | `sysNotifications` | Delivery and retries | 1 year | Deleted |
| Supplier package files | not stored. Only checksums are kept in `data/` | Import evidence | Kept outside the repository by operations | n/a |

Partners receive only what they need. They see privacy-safe order references (the last four characters of the order number), dates, rates and amounts, and never a buyer's name, email or address. These views are tested in `components/__tests__/ProgramHubV2.test.tsx` and `convex/securityV2.test.ts`.

Privileged actions are audited. A ledger adjustment at or above the threshold needs a second admin. Payout beneficiary changes happen only through Stripe Connect onboarding, so Louie Mae never sees bank details.

Consent: the referral click is recorded on the server. A first-party identifier is stored in the browser only when consent allows (`attributionPolicy.consentUnknownAllowsStorage`, decision D-13).

The deletion jobs for the retention periods above are a runbook task for operations. They aren't automated in this build.

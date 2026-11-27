# Ashcroft expense configuration

The owner directed on November 27, 2026 that both suppliers include the already approved expense model while retaining separate fees and delivery systems. Ashcroft's implemented selling-unit engine still lacked its production configuration.

`scripts/v2/activate-ashcroft-expenses.mjs` reads the active approved common expense amounts and prepares a separate Ashcroft record. It copies the supplier-payment reserve (3%), processing (3%), returns (2%) and overhead (5%) rates. It allocates the common $10 handling amount per Ashcroft selling unit; a supplier set is one selling unit. It additionally allocates $0.30 fixed processing per selling unit conservatively, rather than assuming each unit is a separate payment. These are internal operating allowances, not claimed supplier charges. The retained Ashcroft category freight model already funds outbound delivery; Zuo size allowances and its drop-ship fee are not copied.

The funded universal trade discount is zero: actual approved trade prices may still be lower than retail, subject to the separate trade schedule, MAP and margin checks. This setting does not promise every item a fixed discount.

Run from the repository root with an admin secret file and a fresh private receipt path for each invocation; the default is a read-only dry run. Receipt creation is exclusive and updates use the same open descriptor, preventing overwrite through an existing file or link. Add `--apply` to propose and approve the checked record. Existing Ashcroft configuration causes a stop for review, including after a partial run; do not blindly rerun or create duplicate proposals. The receipt retains the proposal ID for inspection. Never commit credentials or private receipts.

This operation does not approve supplier costs, assign margin policies, change prices, publish products or activate checkout. Those gates remain separate. The November 27 authenticated dealer review captured current product pages; accept a cost only when the displayed source URL and SKU match, and preserve actual observation times. Sold-out and incomplete evidence remain held. No supplier orders or customer payments were made.

Validation before activation: production-authenticated dry run, configuration parser validation and focused ESLint. Production approval must be followed by readback and then product-specific economics/checkout acceptance; a successful configuration write is not launch completion.

## November 27 activation receipt

The production record was proposed, approved and read back successfully. No product prices, publication or checkout flags were changed by this operation. The private receipt is `ashcroft-expense-config-activation.json` in the production-access audit output directory.

Sol review: one round with `gpt-6.2-sol`; the allocation matched the existing engine. Finding S1 (receipt path aliases could overwrite credentials) was fixed with exclusive creation and descriptor-based writes. Local regression checks rejected the same path, an existing receipt and a hard link to a dummy credential without modifying any fixture bytes. Focused ESLint and the corrected production dry run passed. No review usage was returned. No findings remain open after the focused fix; no second reviewer was started for this small finding.

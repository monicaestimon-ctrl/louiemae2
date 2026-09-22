# Shared commerce implementation and release checklist

Updated September 21, 2026. This records implemented behavior, not a declaration that every item in the master specification is complete. The master requirements remain in `louiemae-commerce-master-build-spec.md` and its linked specifications.

## Release state

The first implementation is local. No production application deployment, real customer invoice, supplier order, dealer purchase, email delivery, or paid image generation has been performed during this build. Existing workspace changes were retained.

**Release branch reconciliation:** this feature now sits on the latest `origin/main`, preserving the existing Klaviyo waitlist tables and indexes. The earlier stale-checkout index deletion warning has been addressed in the release branch; validate the deployment plan again before release.

Shared publication and invoice sending are separately gated by server environment variables and default to disabled. Existing CJ retail checkout remains in place. Do not enable the new production gates based only on compilation or mocked tests; complete the staging acceptance below first.

## Implemented paths

| Path | Entry | Publication | After verified invoice payment |
| --- | --- | --- | --- |
| Ashcroft | Atelier → Ashcroft & publishing destinations → supplier URL | One reviewed record, independent retail and House estimates, selected destinations | Manual dealer-order task. Owner places the order with Ashcroft; Ashcroft fulfills. Never CJ. |
| CJ | Existing retail import/sourcing workflow → link in shared studio | Source must be fulfillment-ready with matching variant IDs/SKUs. House uses the commercial snapshot. Retail keeps its existing product card and checkout. | Refresh stock, verify exact quantities/mappings, enforce delivery approval and supplier-spend ceiling, create/pay through existing CJ pipeline when enabled. |
| Owner managed | House admin → Shared catalog & owner-managed imports → supplier URL | House only; retail publication rejected on the server | Owner procurement/logistics task with supplier reference, tracking, notes, and progress. No supplier API ordering. |

Both admin portals expose the same shared library and project queue. The provider is fixed at import and cannot be changed by editing a draft. Reimporting the same normalized source opens the existing record without overwriting owner edits. Ashcroft URLs cannot be routed through owner-managed intake.

The older House product/request interface remains available to preserve existing records. There is no silent migration of old furniture products or quotes. New three-provider work should use the shared catalog and Project quotes & fulfillment tabs.

## Product and imagery workflow

1. Import the URL. Ashcroft intake reads product-specific JSON for identity, source images, and variants, plus the product page's Features and Shipping Dimensions panels. A read-only check of the supplied Lore listing confirmed six images and one variant; its JSON alone omits the technical features.
2. Review source facts and conflicts. Ashcroft public prices are deliberately not treated as dealer costs. Enter the actual cost and any currency conversion before using the price calculator. Markup and gross margin are separate calculations; no unapproved percentage is assumed.
3. Generate name/description if desired. Jobs are persisted before provider calls, retain model/instructions/results, and require owner acceptance. Source text is treated as evidence rather than instructions.
4. For Ashcroft, confirm reference-use rights, select one supplier camera angle, and generate its environment. Preserve the photographed product, orientation, material, geometry, and angle. Review each candidate for accuracy. The first accepted image becomes a setting reference for later views. Repeat for the angles needed to show the whole product; the workflow does not invent unseen product geometry.
5. Accepted candidates enter the draft gallery. Source references remain separate. Ashcroft source image URLs cannot be published directly from the reference gallery. Owner-managed products can select supplier images for review when permitted. Variant image URLs can be assigned separately.
6. Review copy, facts, gallery, variants, minimums, increments, and both destination estimates. Save, then publish selected destinations. Draft changes do not replace House or Ashcroft retail snapshots until publication.

CJ retail is an explicit integration exception: the existing retail product remains authoritative for its name, description, gallery, and retail prices. Use **Refresh from retail product** to update its shared extension, preserving matched House estimates. Retail publication rejects stale content/prices instead of producing a second retail listing. House can use its own reviewed commercial snapshot. Changes to CJ readiness or mappings hide affected shared listings until reviewed.

Image generation uses the existing Gemini integration with a configurable image-capable model. It uses brand instructions and reference editing, not a fine-tuned Louie Mae model. No JEV integration is included; its intended product/API has not been identified. Requests are limited to 12 per product per day. Private candidate preview is authenticated; candidates acquire listing URLs when accepted. An uncertain generation must be dismissed/reviewed before a new request. This is a request limit, not an actual currency-denominated provider budget.

## Quote, invoice, and fulfillment workflow

1. Customer selects exact variants/quantities and provides contact information, destination, and timing. The server reloads current published data, validates minimums/increments, calculates authoritative estimates, and stores the original selection. Customer payloads do not set prices or supplier mappings.
2. The request is saved before owner/customer notification jobs are queued. The admin shows notification state and a retry control. Provider idempotency is used; old uncertain deliveries are held for manual reconciliation.
3. Owner edits quantities, removes/adds published variants, sets per-line prices, delivery, tax, address, and customer-facing notes. Saving creates a new revision and invalidates previous acceptance/readiness.
4. Owner records customer acceptance of the saved revision and confirms supply, timing, delivery, and tax. CJ additionally requires a named logistics service, maximum supplier charge, and approval expiry within seven days.
5. **Send / reconcile itemized invoice** creates and emails a Stripe Hosted Invoice link. Invoice creation/line writes/finalization use revision-specific idempotency keys. Existing lines are checked before retrying. Sending requires explicit due-day configuration. Customer card payment is the first supported payment method.
6. A signed `invoice.paid` webhook re-fetches the invoice and its actual online payments. The correct project, revision, currency, total, successful payment intent, customer, and non-reversed charge must match. An out-of-band paid marker, partial payment, or duplicate allocation does not release fulfillment. The owner can also request a server-side payment recheck.
7. Confirmed by the owner September 21, 2026: verified full customer payment is required before CJ ordering begins. Deposits or partial payments do not release an order. Verified full payment atomically creates one fulfillment group per provider. Webhook replay does not create another set. Customer payment and CJ supplier payment are tracked separately.
8. CJ refreshes inventory and checks the paid quantity for the selected variant. Disabled automation, insufficient stock, expired approvals, mapping drift, delivery-service changes, uncertain supplier outcomes, and supplier costs over the approved ceiling require attention. Existing retail CJ retry controls also enforce saved commercial limits. A timeout holds the group for reconciliation.
9. The owner can review same-item mappings before any supplier attempt, adopt the current verified mapping for that same original variant, renew delivery/cost approval, and retry. This does not permit silent product substitutions or changing paid quantities/prices. Once an attempt exists, use CJ Control Room and reconcile its supplier order/payment before retrying. An uncertain creation without a supplier order ID blocks automatic recreation.
10. Mixed-provider projects hold CJ release until the owner explicitly confirms delivery coordination and allocates the CJ portion of the customer delivery charge. Only CJ merchandise and that delivery allocation reach CJ's retail-value checks; project-wide tax stays on the project invoice. Ashcroft and owner-managed groups always remain manual. Record the supplier order reference, shipment details, and progress after arranging fulfillment.

Unpaid invoices can be voided and the quote reopened for a new revision/acceptance. Paid quotes are not silently rewritten. Signed refund/dispute events verify the charge with Stripe and hold the project and linked commercial CJ order. A hold does not cancel a supplier order already in progress; supplier cancellation/refund reconciliation remains an owner task.

## Configuration still required

All secrets belong in the Convex server environment, not `VITE_` variables. Examples are in `.env.example`.

| Setting/decision | Current implementation |
| --- | --- |
| `COMMERCE_PUBLISHING_ENABLED` | Must be `true` to publish shared listings; leave disabled until staging acceptance. |
| `COMMERCE_INVOICES_ENABLED` | Must be `true` to send new invoices. Verification, reversal holds, and voiding remain available for existing invoices when sending is disabled. |
| `COMMERCE_INVOICE_DUE_DAYS` | Required integer 1–30; owner must choose terms. |
| Stripe secret and webhook secret | Reuses existing integration; staging must use test credentials and signed events. Subscribe to `invoice.paid`, `charge.refunded`, and `charge.dispute.created`, retaining existing Checkout events. |
| `CJ_AUTO_FULFILLMENT_ENABLED`, `CJ_AUTO_BALANCE_PAY_ENABLED` | Both must be enabled and the supplier account funded for automatic commercial supplier payment. Keep off during UI/import testing. |
| Admin allowlist | Reuses `CJ_ADMIN_EMAILS` / `ADMIN_EMAILS` and existing authenticated sessions. |
| Gemini | Server `GEMINI_API_KEY`, optional text model, explicit `COMMERCE_IMAGE_MODEL`. Actual account/model availability and paid output quality are not verified by this build. |
| Request email | `RESEND_API_KEY`, `FURNITURE_QUOTE_EMAIL`, verified `FURNITURE_EMAIL_FROM`. |
| House starting estimates | Owner-confirmed September 21, 2026: supplier unit cost converted to USD, then up to $50 ×6; over $50–$75 ×4.5; over $75–under $175 ×4; $175–under $250 ×3; $250+ ×2. Apply floors of $300, $337.50, $700, and $750 as each subsequent tier begins, so increasing cost never lowers the estimate. Round converted cost and resulting estimate to cents. Existing retail pricing remains separate. |
| Ashcroft retail purchasing | Confirmed by the owner September 21, 2026: quote first, then pay the finalized invoice. Implemented. CJ retail checkout is unchanged. |
| Tax and delivery | Reviewed owner-entered invoice charges. No automatic freight guarantee, automated tax calculation, or tax-advice engine. |
| Visual presets and rights | Initial warm, neutral Louie Mae direction plus editable instructions; final approved preset library/reference permissions remain owner decisions. |

## Required before claiming production readiness

House pricing is implemented in the shared studio's **Apply House tiers & minimum prices** action. Known positive-cost owner-managed imports with a confirmed FX rate receive the starting estimate on import. Ashcroft requires actual dealer cost entry; missing costs or FX are not guessed. Existing saved/published prices and quotes are not bulk-rewritten. The minimum-price policy deliberately creates plateaus: $60 cost → $300 estimate; $200 → $700; $250–$375 → $750; $1,000 → $2,000. It is a whole-cost tier policy with floors, not a progressive marginal markup.

Bulk, higher-quantity, and higher-invoice-value commercial discounts are custom adjustments to the final quote supported by actual supplier cost, delivery, fees, and profitability review. There is no automatic percentage discount or automatic quantity threshold. The existing editable quote unit prices support those adjustments before customer acceptance/invoicing. The starting-estimate floor does not prohibit an intentionally reviewed final-quote discount. Delivery and tax remain separate.

- Deploy the additive Convex schema/functions and matching frontend to an isolated staging environment. Review the existing unrelated workspace changes before any deployment. Do not deploy this entire working tree blindly.
- Verify both authenticated admin routes, unauthorized access rejection, import retry, same-URL deduplication, source-detail completeness, variant image matching, gallery review, and independent publication/unpublication in the actual backend.
- Run one Ashcroft and one owner-managed import with live source access. Test OTAPI credentials and actual configured-variant data. No chosen product was saved to the deployed catalog during this build.
- Generate and inspect an authorized 3–4-view sample with the selected paid image model. Approve product fidelity and the actual brand setting. Set a provider-level spend cap before scaling generation.
- Test Stripe invoice creation, email delivery, interrupted creation/line-write recovery, payment links, webhook replay, partial/out-of-band payment, expired/unpaid invoice voiding, refund/dispute holds, and wrong-revision rejection with test payments.
- Test CJ account permissions, stock refresh, 15-versus-30 quantity handling, quoted logistics names, supplier payment ceiling, duplicate/replayed events, insufficient balance, timeout reconciliation, order tracking, and the account's actual bulk-shipping support. A supplier order should only be submitted in an approved testing arrangement.
- Validate operational reconciliation for refunds, supplier cancellation, lost invoice-creation responses, paid substitutions, and partial shipments. These remain manual exceptions. The current manual progress control is per provider group, not a per-line shipment-allocation system. A full paid-amendment/credit-note wizard, automated supplier cancellation, advanced freight planning, and migration of legacy House records are not implemented in this slice.
- Verify the production route map: the root currently serves the prelaunch site, while the main retail app is a separate existing entry. The House route must serve its built application and the retail launch route must actually expose the new furniture section when enabled.

No test result below should be interpreted as a live supplier payment, real invoice/email delivery, or complete staging end-to-end verification.

## Validation record

Results are recorded after the final local checks in this task. The test suite covers supplier separation, duplicate payment prevention, exact paid quantities, stale edits, access controls, customer requests without client prices, and successful online-payment verification versus unsupported/reversed payments. Browser smoke testing of the compiled root/prelaunch and House design-preview shell found no reported browser errors; authenticated new-admin and paid integrations still require staging.

- Full test run: **454 tests passed across 66 files**.
- Root TypeScript and the stricter Convex TypeScript checks: passed.
- Production Vite build and client-secret scan: passed. The existing large admin bundle still produces a size warning.
- Full ESLint: checked before release; existing repository warnings remain. The full suite includes reversal holds and true invoice quantities/unit prices.
- Earlier Convex dry run passed schema validation on the original checkout. The release branch preserves the upstream Klaviyo schema, but a fresh local dry run could not authenticate (401). The authenticated CI deployment must be checked before claiming release success.
- Source verification: the supplied Ashcroft Lore URL returned product JSON with six images and one variant; Features and Shipping Dimensions are extracted separately from page tabs.

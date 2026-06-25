# CJ Fully Hands-Off Fulfillment Plan

Verified against official CJ Dropshipping developer documentation on 2026-06-25.

Official docs referenced:

- API introduction: https://developers.cjdropshipping.cn/en/api/introduction.html
- Product synchronization process: https://developers.cjdropshipping.cn/en/api/start/Products-Synchronization-Processing.html
- Order synchronization process: https://developers.cjdropshipping.cn/en/api/start/Orders-Synchronization-Processing.html
- API V2.0 index: https://developers.cjdropshipping.cn/en/api/api2/
- Shopping/order APIs: https://developers.cjdropshipping.cn/en/api/api2/api/shopping.html
- Logistics/tracking APIs: https://developers.cjdropshipping.cn/en/api/api2/api/logistic.html
- Webhook integration: https://developers.cjdropshipping.cn/en/api/start/webhook.html
- Webhook setting/subscription APIs: https://developers.cjdropshipping.cn/en/api/api2/api/webhook.html

## Current State

- Stripe checkout creates a Louie Mae order in Convex.
- If order items have CJ identifiers, the Stripe webhook calls the CJ order creation path.
- The current CJ order payload creates a CJ order record, but it does not complete the full paid fulfillment flow.
- Pricing now uses the requested formula:
  - Source/direct URL product price is multiplied by `1.4` to estimate CJ product cost.
  - The estimated CJ product cost is multiplied by `3`.
  - Shipping is added after the markup calculation.
- Existing CJ cron jobs and webhook handlers provide partial sourcing/tracking support. CJ webhook signatures and duplicate `messageId` claims are now protected; topic-level idempotency still needs hardening.

## CJ Flow Required For Hands-Off Fulfillment

Based on CJ's documented order synchronization flow, a fully automated order should perform these steps:

1. Confirm the local product maps to a CJ product, CJ variant, and CJ SKU.
2. Confirm available warehouse inventory for the requested quantity.
3. Confirm a valid CJ logistics option and freight cost for the customer's address.
4. Create the CJ order with a fulfillment-eligible payment type.
5. Add the created order to CJ cart.
6. Confirm the cart.
7. Generate the parent/payment order.
8. Pay the order, normally through the balance payment API for automation.
9. Store CJ order IDs, parent order IDs, payment IDs, tracking IDs, costs, and fulfillment statuses.
10. Receive and verify CJ webhook events for product, stock, order, sourcing, and logistics updates.
11. Reconcile tracking/status with scheduled polling so missed webhooks do not break fulfillment.

## Safety Decision

The live balance payment call can spend funds from the connected CJ account. Code should support full automation, but production should only enable automatic payment when all of these are true:

- `CJ_AUTO_FULFILLMENT_ENABLED=true`
- `CJ_AUTO_BALANCE_PAY_ENABLED=true`
- `CJ_ADMIN_EMAILS` is set in Convex to a comma-separated list of admin emails allowed to run manual CJ retry/resync actions.
- CJ API credentials are live and verified.
- CJ balance funding, product mappings, and logistics settings have been tested with a low-value order.
- Webhook signature verification is enabled.

If automatic balance payment is disabled, the app should still create the CJ order, add it to cart, generate the parent/payment order, and store the payment URL/IDs so the order can be paid manually from CJ.

## Implementation Checklist

### Phase 0 - Pricing Foundation

- [x] Update imported/direct URL price estimation so source price is multiplied by `1.4` for CJ cost estimation.
- [x] Update retail pricing so shipping is added after product markup instead of being multiplied.
- [x] Add pricing tests that lock the requested formula.
- [x] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 1 - Fulfillment Configuration And State

- [x] Add explicit CJ automation environment flags.
- [x] Add typed fulfillment state fields to local orders:
  - CJ order ID
  - CJ parent/payment order ID
  - CJ payment ID/pay ID
  - payment URL
  - auto-payment attempted timestamp
  - CJ payment status
  - CJ fulfillment status
  - latest CJ error
  - retry/idempotency metadata
- [x] Add admin-visible diagnostics for whether automation is ready.
- [x] Add tests for disabled, manual-payment, and live-payment configurations.
- [x] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 2 - CJ API Client Hardening

- [x] Create a small typed CJ API client around existing token handling.
- [x] Centralize request timeout, response parsing, and error formatting.
- [x] Add helpers for:
  - `createOrderV2`
  - `addCart`
  - `addCartConfirm`
  - `saveGenerateParentOrder`
  - `payBalanceV2`
  - order detail/status lookup
  - logistics/tracking lookup
  - real-time inventory lookup
- [x] Add tests for success, CJ business errors, malformed responses, and network failures.
- [x] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 3 - Order Fulfillment Orchestration

- [x] Replace the current create-only CJ path with an idempotent fulfillment workflow.
- [x] For each Stripe-paid order:
  - [x] validate address and country code
  - [x] validate product and variant mappings
  - [x] quote freight
  - [x] create CJ order
  - [x] add CJ order to cart
  - [x] confirm cart
  - [x] generate parent/payment order
  - [x] optionally pay via balance API when live automation is enabled
  - [x] persist every external ID and status transition
- [x] Validate inventory before CJ order creation.
- [x] Reject unsigned Stripe webhook requests before creating local/CJ fulfillment orders, except behind an explicit non-production test flag.
- [x] Ensure retrying the workflow cannot double-pay or duplicate fulfillment.
- [x] Add tests for partial failure and retry from each major step.
  - [x] Cover terminal/in-flight CJ states that must block re-entry.
  - [x] Cover step-order resume decisions for order creation, cart, confirmation, payment generation, and paid states.
- [x] Open PR #50, run CodeRabbit CLI, resolve issues, merge.

### Phase 4 - Webhook Security And Idempotency

- [x] Verify CJ webhook signatures in the `/cj/webhook` HTTP handler using HMAC-SHA256 and the CJ `openId` value as the signing secret, as documented by CJ.
- [x] Reject missing or invalid signatures before JSON parsing when `CJ_WEBHOOK_VERIFY_SIGNATURE` is enabled.
- [x] Store processed webhook IDs and atomic processing claims.
- [x] Make webhook handlers idempotent for product, stock, order, sourcing, and logistics events.
  - [x] Prevent exact duplicate `messageId` deliveries from running side effects concurrently.
  - [x] Harden each topic handler against out-of-order updates and equivalent payloads with different message IDs.
- [x] Ensure the endpoint returns `200 OK` quickly for valid events.
  - [x] Route asynchronous sourcing price refresh through durable retries and product-level failure reporting.
- [ ] Add tests for valid signature, invalid signature, duplicate event, and unknown topic.
  - [x] Lock the HMAC-SHA256 Base64 signature helper against CJ's documented sample.
  - [x] Cover monotonic ORDER/LOGISTIC status resolution for duplicate and out-of-order webhook messages.
  - [x] Cover CJ webhook payload parsing for valid and invalid request bodies.
  - [ ] Add Convex HTTP handler tests for valid/invalid webhook requests.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 5 - Product Mapping And Inventory Readiness

- [x] Add product readiness checks before a product can be considered fulfillment-ready.
- [x] Require each sellable variant to have CJ product ID, variant ID, and SKU.
- [x] Add a real-time inventory refresh path.
- [x] Show missing CJ mapping/inventory issues in admin tools.
- [x] Prevent or clearly flag checkout for unmapped/unavailable CJ items.
- [x] Add tests for mapped, unmapped, low-stock, and unavailable variants.
  - [x] Cover mapped, unmapped, unavailable/out-of-stock, missing variant, and invalid quantity readiness cases.
  - [x] Cover low-stock and insufficient CJ inventory readiness cases.
- [x] Open PR #46, run CodeRabbit CLI, resolve issues, merge.

### Phase 6 - Tracking, Reconciliation, And Customer Updates

- [x] Reconcile CJ order status and tracking through both webhooks and scheduled polling.
- [x] Store tracking carrier, number, URL, latest status, and last sync timestamp.
- [x] Trigger customer-facing order status updates when tracking is available.
- [x] Add manual admin retry/resync actions.
- [ ] Add tests for webhook-first, cron-first, and delayed-tracking flows.
  - [x] Cover CJ documented order status mapping and cron-first `trackInfo` reconciliation.
  - [x] Cover saved-order retry payload validation for missing shipping/CJ mappings.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 7 - Operational Launch Checklist

- [ ] Update environment variable documentation.
- [ ] Add a dry-run procedure for a test order.
- [ ] Add a live launch checklist for CJ balance funding and webhook registration.
- [ ] Run full test suite, type check, lint, and production build.
- [ ] Open final PR, run CodeRabbit CLI, resolve issues, merge.

## Definition Of Done

The backend is fulfillment-ready when:

- Every published product has valid CJ product/variant/SKU mappings.
- Checkout refuses or flags items that cannot be fulfilled by CJ.
- Stripe-paid orders automatically enter the CJ fulfillment workflow.
- CJ cart confirmation and payment-order generation are automated.
- Balance payment is automated behind explicit production flags.
- CJ webhook signatures are verified.
- Tracking updates sync back to Louie Mae without manual work.
- Failures are visible in admin diagnostics and can be retried safely.
- Tests cover pricing, fulfillment orchestration, webhook verification, inventory readiness, and tracking reconciliation.


# CJ Fully Hands-Off Fulfillment Plan

Verified against official CJ Dropshipping developer documentation on 2026-06-24.

Official docs referenced:

- API introduction: https://developers.cjdropshipping.com/en/api/introduction.html
- Product synchronization process: https://developers.cjdropshipping.com/en/api/start/Products-Synchronization-Processing.html
- Order synchronization process: https://developers.cjdropshipping.com/en/api/start/Orders-Synchronization-Processing.html
- Shopping/order APIs: https://developers.cjdropshipping.com/en/api/api2/api/shopping.html
- Webhook integration: https://developers.cjdropshipping.com/en/api/start/webhook.html

## Current State

- Stripe checkout creates a Louie Mae order in Convex.
- If order items have CJ identifiers, the Stripe webhook calls the CJ order creation path.
- The current CJ order payload creates a CJ order record, but it does not complete the full paid fulfillment flow.
- Pricing now uses the requested formula:
  - Source/direct URL product price is multiplied by `1.4` to estimate CJ product cost.
  - The estimated CJ product cost is multiplied by `3`.
  - Shipping is added after the markup calculation.
- Existing CJ cron jobs and webhook handlers provide partial sourcing/tracking support, but the webhook endpoint still needs signature verification and idempotency hardening.

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
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 2 - CJ API Client Hardening

- [ ] Create a small typed CJ API client around existing token handling.
- [ ] Centralize request timeout, response parsing, and error formatting.
- [ ] Add helpers for:
  - `createOrderV2`
  - `addCart`
  - `addCartConfirm`
  - `saveGenerateParentOrder`
  - `payBalanceV2`
  - order detail/status lookup
  - logistics/tracking lookup
  - real-time inventory lookup
- [ ] Add tests for success, CJ business errors, malformed responses, and network failures.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 3 - Order Fulfillment Orchestration

- [ ] Replace the current create-only CJ path with an idempotent fulfillment workflow.
- [ ] For each Stripe-paid order:
  - validate address and country code
  - validate product and variant mappings
  - validate inventory
  - quote freight
  - create CJ order
  - add CJ order to cart
  - confirm cart
  - generate parent/payment order
  - optionally pay via balance API when live automation is enabled
  - persist every external ID and status transition
- [ ] Ensure retrying the workflow cannot double-pay or duplicate fulfillment.
- [ ] Add tests for partial failure and retry from each major step.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 4 - Webhook Security And Idempotency

- [ ] Verify CJ webhook signatures using HMAC-SHA256 and the CJ `openId` value as the signing secret, as documented by CJ.
- [ ] Reject invalid signatures in production.
- [ ] Store processed webhook IDs or stable event fingerprints.
- [ ] Make webhook handlers idempotent for product, stock, order, sourcing, and logistics events.
- [ ] Ensure the endpoint returns `200 OK` quickly for valid events.
- [ ] Add tests for valid signature, invalid signature, duplicate event, and unknown topic.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 5 - Product Mapping And Inventory Readiness

- [ ] Add product readiness checks before a product can be considered fulfillment-ready.
- [ ] Require each sellable variant to have CJ product ID, variant ID, and SKU.
- [ ] Add a real-time inventory refresh path.
- [ ] Show missing CJ mapping/inventory issues in admin tools.
- [ ] Prevent or clearly flag checkout for unmapped/unavailable CJ items.
- [ ] Add tests for mapped, unmapped, low-stock, and unavailable variants.
- [ ] Open PR, run CodeRabbit CLI, resolve issues, merge.

### Phase 6 - Tracking, Reconciliation, And Customer Updates

- [ ] Reconcile CJ order status and tracking through both webhooks and scheduled polling.
- [ ] Store tracking carrier, number, URL, latest status, and last sync timestamp.
- [ ] Trigger customer-facing order status updates when tracking is available.
- [ ] Add manual admin retry/resync actions.
- [ ] Add tests for webhook-first, cron-first, and delayed-tracking flows.
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


# CJ Admin Control Room And Silent Risk Monitor

Verified against official CJ Dropshipping developer documentation on 2026-06-26.

Official CJ references:

- API introduction: https://developers.cjdropshipping.cn/en/api/introduction.html
- Product synchronization process: https://developers.cjdropshipping.cn/en/api/start/Products-Synchronization-Processing.html
- Order synchronization process: https://developers.cjdropshipping.cn/en/api/start/Orders-Synchronization-Processing.html
- API V2.0 index: https://developers.cjdropshipping.cn/en/api/api2/
- Shopping/order APIs: https://developers.cjdropshipping.cn/en/api/api2/api/shopping.html
- Logistics/tracking APIs: https://developers.cjdropshipping.cn/en/api/api2/api/logistic.html
- Webhook integration guide: https://developers.cjdropshipping.cn/en/api/start/webhook.html
- Webhook setting/subscription APIs: https://developers.cjdropshipping.cn/en/api/api2/api/webhook.html

Related Louie Mae docs:

- [CJ_FULLY_HANDS_OFF_FULFILLMENT_PLAN.md](./CJ_FULLY_HANDS_OFF_FULFILLMENT_PLAN.md)
- [CJ_OPERATIONAL_LAUNCH_RUNBOOK.md](./CJ_OPERATIONAL_LAUNCH_RUNBOOK.md)
- [CJ_ADMIN_OPERATOR_GUIDE.md](./CJ_ADMIN_OPERATOR_GUIDE.md)

## Goal

Create two admin pages that make CJ fulfillment easy to understand and operate without knowing the backend code:

1. **CJ Control Room**: the everyday order fulfillment dashboard.
2. **Silent Risk Check**: the safety dashboard for failures that can happen quietly in the background.

The UI should keep the Louie Mae admin aesthetic: dark glass, soft cream text, bronze accents, floating panels, calm spacing, and simple wording.

## CJ Workflow To Track

Every CJ order should be visible through these plain-English steps:

1. **Paid on Louie Mae**
   - Stripe has confirmed the customer paid.
   - The order is ready for fulfillment review.
2. **Product connected to CJ**
   - Every item has a CJ product ID, variant ID, and SKU.
   - If this fails, the order cannot be safely sent to CJ.
3. **Stock checked**
   - CJ inventory was refreshed for the selected product and size.
   - If stock is low or unavailable, the order needs review before payment.
4. **Shipping checked**
   - CJ freight/logistics was checked for the customer's address.
   - If no valid shipping option exists, the order needs review.
5. **CJ order created**
   - The Louie Mae order has been submitted to CJ.
   - The CJ order ID should be stored locally.
6. **CJ cart confirmed**
   - CJ accepted the order into the fulfillment cart and confirmed it.
7. **Payment order created**
   - CJ generated the parent/payment order.
   - This is the stage before paying CJ.
8. **Paid in CJ**
   - The order was paid through CJ balance, or it is waiting for manual payment if balance automation is disabled.
9. **Waiting for tracking**
   - CJ is processing the order and tracking is not available yet.
10. **In transit**
    - Tracking exists and the package is moving.
11. **Delivered**
    - CJ or carrier tracking says the package was delivered.

## Control Room Features

### Top Summary

- **Orders needing review**
  - Shows orders that cannot continue without action.
  - Useful because it gives the operator one number to clear.
- **CJ balance status**
  - Shows whether balance payment is ready, blocked, or unknown.
  - Useful because automatic payment fails if the CJ account is not funded or the balance API is not ready.
- **Automation status**
  - Shows whether fulfillment, balance payment, webhook verification, and admin access are configured.
  - Useful because one missing environment variable can stop hands-off fulfillment.
- **Tracking health**
  - Shows how many paid CJ orders still have no tracking after a normal waiting window.
  - Useful because delayed tracking is expected, but stale tracking needs attention.

### Order Pipeline

Each order row should show:

- Customer name and order total.
- Louie Mae order status.
- Current CJ step in plain English.
- CJ order ID and parent/payment order ID when available.
- Payment status.
- Tracking number and carrier when available.
- Last update time.
- The next best action.

Helpful filters:

- Needs review
- Ready for CJ
- Waiting for CJ payment
- Waiting for tracking
- In transit
- Delivered
- Failed or stuck

### Simple Action Buttons

Buttons should be shown only when they are useful for the current order state.

- **Retry CJ order**
  - Runs the safe retry flow for an order that failed before CJ payment.
  - Useful because it avoids manually creating duplicate CJ orders.
- **Sync tracking**
  - Calls `syncOrderTracking` for one selected order only.
  - Useful when CJ has shipped but Louie Mae has not updated yet.
- **Sync all tracking**
  - Calls `syncTracking` for all active CJ orders.
  - Useful for a daily cleanup pass.
- **Refresh inventory**
  - Refreshes CJ stock for the product.
  - Useful before retrying or approving an order.
- **Open CJ order**
  - Opens the CJ order/payment page when a URL or ID exists.
  - Useful when manual CJ review is needed.
- **Mark reviewed**
  - Clears a non-blocking warning after the operator has checked it.
  - Useful so the same warning does not keep looking new.
- **Add note**
  - Adds an internal note for context.
  - Useful for handoffs and future review.

## Silent Risk Monitor Features

Silent risks are problems that may not look like an obvious failed order but can still block fulfillment.

### Risk Cards

- **Webhook not updating**
  - CJ has not sent recent webhook updates, or webhook setup is missing.
  - Action: configure webhooks, check webhook URL, run tracking sync.
- **Order stuck between steps**
  - The order has not moved for longer than the expected window.
  - Action: retry CJ order, sync tracking, or mark reviewed after checking CJ.
- **CJ payment not complete**
  - The payment order exists but CJ is not paid.
  - Action: check balance, open CJ payment, or retry payment only when safe.
- **Missing tracking**
  - CJ order is paid/processing but no tracking exists after the normal delay.
  - Action: sync tracking or open CJ order.
- **Inventory changed after payment**
  - Stock was healthy at checkout but later becomes low, unknown, or unavailable.
  - Action: refresh inventory, contact CJ, or review the order.
- **Product mapping missing**
  - Product, variant, or SKU mapping is missing.
  - Action: fix product mapping before retrying fulfillment.
- **Customer email update risk**
  - Tracking or status email failed, was skipped, or cannot be confirmed.
  - Action: resend customer update after the correct tracking data is present.
- **Refund review**
  - The customer was refunded/cancelled locally, but CJ fulfillment may already be active.
  - Action: review the CJ order before assuming fulfillment stopped.
- **Duplicate protection warning**
  - The system detects a retry or webhook sequence that could duplicate work.
  - Action: inspect order IDs and retry only through the safe admin button.
- **Cost changed**
  - CJ cost, freight, or landed cost changed enough to affect margin.
  - Action: review pricing and decide whether to continue.

### Job And System Health

The risk page should also show:

- Last Stripe webhook received.
- Last CJ webhook received.
- Last tracking sync.
- Last inventory refresh.
- Last pricing refresh.
- Current automation flags.
- Number of unresolved critical risks.
- Number of warnings reviewed today.

## Backend Implementation

### Read Models

Add dedicated admin read models so the UI does not duplicate fulfillment logic:

- `cjControlRoom.getOverview`
- `cjControlRoom.getOrders`
- `cjControlRoom.getOrderDetail`
- `cjRiskMonitor.getSummary`
- `cjRiskMonitor.getRisks`
- `cjRiskMonitor.getSystemHealth`

These should return plain, UI-ready labels such as "Waiting for CJ payment" instead of requiring the React components to interpret raw CJ statuses.

### Action And Audit State

Add or wrap actions for:

- `retryOrderFulfillment`
- `syncOrderTracking`, which refreshes one selected order only
- `syncTracking`, which refreshes all active CJ orders
- `refreshInventory`
- `configureWebhooks`
- `testConnection`
- `markRiskReviewed`
- `addFulfillmentNote`

If a button can spend money, duplicate fulfillment, or change customer-visible state, it must be guarded by admin access and clear state checks.

### Tables

Add a dedicated durable audit table for `markRiskReviewed` and `addFulfillmentNote`.
This is required so reviewed warnings and operator notes survive page refreshes and do not reappear as new risks.

- order ID
- risk key
- severity
- action type
- reviewed by
- reviewed at
- note
- created at

This keeps "reviewed" warnings separate from the actual order fulfillment state.

## Frontend Implementation

### Page 1: CJ Control Room

Route through the existing admin panel tab system.

Core layout:

- Header with "CJ Control Room" and automation state.
- Four summary cards.
- Filter tabs.
- Order pipeline table/cards.
- Right-side detail panel for the selected order.
- Action row with safe, state-aware buttons.

### Page 2: Silent Risk Check

Route through the same admin panel.

Core layout:

- Header with "Silent Risk Check".
- Simple status sentence: "Everything is moving" or "X items need review."
- Critical risk cards first.
- Warning cards second.
- System health timeline.
- Buttons for the next safe action.

## PR Checklist

### PR 1 - Plan And Scope

- [x] Add this implementation plan.
- [x] Run `npm run type-check` when practical.
- [x] Run CodeRabbit CLI on the committed diff.
- [x] Open a ready-for-review PR.
- [x] Merge after review is clean.

### PR 2 - Backend Read Models

- [x] Add control room summary and order pipeline queries.
- [x] Add risk monitor summary and risk list queries.
- [x] Add tests for status labels, severity ordering, and stuck-order detection.
- [x] Run type check and targeted tests.
- [x] Run CodeRabbit CLI.
- [x] Open and merge PR after review.

### PR 3 - Audit State And Safe Actions

- [x] Add reviewed risk/note storage if needed.
- [x] Add mutations for marking risks reviewed and adding internal notes.
- [x] Keep money-moving actions guarded by existing CJ admin access checks.
- [x] Add tests for permissions and duplicate-safe retries.
- [x] Run CodeRabbit CLI.
- [x] Open and merge PR after review.

### PR 4 - CJ Control Room UI

- [x] Add admin nav item.
- [x] Build summary cards, filters, order list, detail panel, and action buttons.
- [x] Use simple labels instead of backend terms.
- [x] Verify mobile and desktop layout.
- [x] Run type check/build.
- [x] Run CodeRabbit CLI.
- [x] Open and merge PR after review.

### PR 5 - Silent Risk Check UI

- [x] Add admin nav item.
- [x] Build critical risk cards, warning cards, system health, and action buttons.
- [x] Keep wording simple enough for non-developers.
- [x] Verify mobile and desktop layout.
- [x] Run type check/build.
- [x] Run CodeRabbit CLI.
- [x] Open and merge PR after review.

### PR 6 - Final Operational Polish

- [x] Add empty states and loading states.
- [x] Confirm all actions show success/error feedback.
- [x] Confirm every backend failure path appears somewhere in admin.
- [x] Update launch runbook with the new pages.
- [ ] Run full tests, lint, type check, and build.
- [ ] Run CodeRabbit CLI.
- [ ] Open and merge final PR after review.

## Definition Of Done

This work is complete when:

- A retail operator can see every CJ order from customer payment through delivery.
- Orders needing attention are clearly separated from orders moving normally.
- Silent failures are surfaced in the risk monitor.
- Every visible action button maps to a safe backend action.
- Money-moving automation remains protected by explicit production flags and admin access.
- The admin panel shows what to do next without requiring API knowledge.
- Tests, type check, build, CodeRabbit CLI, GitHub PR review, and merge are complete for every PR slice.

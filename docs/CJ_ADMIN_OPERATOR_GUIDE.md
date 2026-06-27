# CJ Admin Operator Guide

This guide is for the person managing Louie Mae orders day to day. It explains what to check, what each button means, and when a CJ order needs human attention.

Official CJ references verified for this workflow:

- API introduction: https://developers.cjdropshipping.cn/en/api/introduction.html
- Product synchronization process: https://developers.cjdropshipping.cn/en/api/start/Products-Synchronization-Processing.html
- Order synchronization process: https://developers.cjdropshipping.cn/en/api/start/Orders-Synchronization-Processing.html
- Shopping/order APIs, including balance payment: https://developers.cjdropshipping.cn/en/api/api2/api/shopping.html
- Logistics/tracking APIs: https://developers.cjdropshipping.cn/en/api/api2/api/logistic.html
- Webhook guide: https://developers.cjdropshipping.cn/en/api/start/webhook.html
- Webhook setting/subscription APIs: https://developers.cjdropshipping.cn/en/api/api2/api/webhook.html

## The Two CJ Admin Pages

### CJ Control Room

Use this page for normal order management.

It answers:

- Which paid orders are ready for CJ?
- Which orders are waiting for CJ payment?
- Which orders are waiting for tracking?
- Which orders are already in transit or delivered?
- Which order needs a person to review it before moving forward?

### CJ Risk Check

Use this page to catch quiet background problems.

It answers:

- Did CJ webhooks stop updating?
- Did tracking sync stop running?
- Is a product missing CJ mapping?
- Is inventory low, out, or unknown?
- Is an order stuck between CJ steps?
- Is there a refunded or cancelled order that might still be active in CJ?

## Daily Routine

1. Open **CJ Risk Check** first.
2. If there are critical risks, fix those before trusting hands-off fulfillment.
3. Open **CJ Control Room**.
4. Start with the **Needs review** filter.
5. For each blocked order, read the plain-English next action.
6. Use the safest matching button: retry, sync, inventory, payment, or note.
7. Click **Sync all** once after reviewing active orders.
8. Add notes when you make a decision that someone else may need later.
9. Mark a warning reviewed only after you checked it.

## Button Meanings

| Button | What it does | Use it when |
| --- | --- | --- |
| **Test CJ** | Checks whether Louie Mae can contact CJ with the current credentials. | You suspect the CJ API key, account, or connection is broken. |
| **Sync all** | Asks CJ for updates on all active CJ orders. | You want fresh tracking/status for the day. |
| **Inventory** | Refreshes CJ stock information. | A product may be low, out, unknown, or stale. |
| **Retry** | Runs the safe CJ retry flow for one order. | An order failed before completion and the page says retry is the next action. |
| **Sync** | Refreshes tracking/status for one selected order. | One order looks stale or tracking is missing. |
| **Payment** | Opens the CJ payment page when available. | CJ created a payment order but automatic payment did not finish. |
| **Track** | Opens the tracking page when available. | You want to inspect the carrier tracking directly. |
| **Action** | Runs the safest action for that specific risk. | A risk card gives you a fix button and the next action makes sense. |
| **Reviewed** | Records that a person checked the issue. | The warning is understood and does not need to keep showing as new. |
| **Note** | Saves an internal note. | You made a decision, contacted CJ, or need to explain what happened. |

## Status Meanings

| Status | Simple meaning |
| --- | --- |
| **Needs review** | The order is blocked until a person checks something. |
| **Ready** | The order is paid and ready for CJ processing. |
| **Payment** | CJ has the order or payment order, but payment still needs to finish. |
| **Tracking** | CJ is paid or processing, but tracking is not saved yet. |
| **In transit** | Tracking exists and the package is moving. |
| **Delivered** | Tracking says the package was delivered. |
| **Stuck** | The order has been in one step too long. |
| **Critical** | Stop and fix this before assuming fulfillment is working. |
| **Warning** | Check this soon. It may not be blocking yet, but it can become a problem. |
| **Info** | Helpful background information. |

## Risk Meanings

| Risk | What it means | What to do |
| --- | --- | --- |
| **CJ API key missing** | Louie Mae cannot call CJ. | Add or fix `CJ_API_KEY` in the production environment. |
| **CJ fulfillment automation is off** | Paid orders will not fully flow to CJ by themselves. | Confirm launch settings before enabling hands-off mode. |
| **CJ webhook URL missing** | CJ cannot send updates back to Louie Mae. | Set `CJ_WEBHOOK_URL`, then run webhook setup. |
| **Webhook not updating** | CJ updates may not be arriving. | Run **Test CJ**, configure webhooks, then **Sync all**. |
| **Product mapping missing** | A product, size, SKU, or CJ variant is not connected. | Fix mapping in CJ Settings before retrying the order. |
| **Missing shipping address** | CJ cannot quote or ship without the address. | Fix the customer/order address before retrying. |
| **CJ payment not complete** | CJ has not been paid for that order yet. | Check CJ balance or open the CJ payment page. |
| **Missing tracking** | CJ is processing but Louie Mae has no tracking yet. | Use **Sync** or **Sync all**. If it stays missing, check CJ directly. |
| **Inventory low/out/unknown** | The item may not be available at CJ. | Refresh inventory and review before retrying. |
| **Refund review** | Louie Mae may show cancelled/refunded, but CJ may still be processing. | Open CJ and confirm the CJ order is stopped if needed. |
| **Duplicate protection warning** | A retry or webhook sequence may repeat work. | Use only the admin retry button. Do not manually duplicate the CJ order. |
| **Cost changed** | Product cost or shipping changed enough to affect margin. | Review pricing before continuing with that product/order. |

## CJ Balance In Simple Terms

CJ balance is the prepaid money inside the CJ account. When automatic balance payment is enabled, Louie Mae can submit the CJ payment step through CJ's documented balance-payment flow.

Automatic payment is only safe when:

- The CJ account has enough balance.
- `CJ_AUTO_BALANCE_PAY_ENABLED=true`.
- Fulfillment automation is already ready.
- The dry-run/live test order passed.

If the balance is too low, orders may be created in CJ but wait at the payment step.

## Things The Admin Panel Cannot Fix By Itself

- It cannot fund the CJ balance.
- It cannot fix a disabled CJ account or missing CJ account permissions.
- It cannot invent missing CJ product IDs, variant IDs, or SKUs.
- It cannot guarantee CJ cancels a supplier order after a local refund unless CJ confirms it.
- It cannot force a carrier to provide tracking before CJ/carrier has one.

When one of these happens, the page should still show the risk so it is not silent.

## Safe Launch Rule

Do not treat the site as fully hands-off until:

- CJ credentials are live.
- Webhooks are registered and verified.
- Stripe live webhooks are configured.
- Every sellable CJ product has product, variant, and SKU mapping.
- CJ balance is funded.
- One low-cost live order completes from Stripe payment to CJ payment to tracking.
- The Control Room and Risk Check show no unresolved critical issues.

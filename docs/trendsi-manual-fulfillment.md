# Trendsi manual fulfillment

Open **Admin → Orders → Trendsi · Manual**. Furniture and CJ orders remain in their own tab.

1. **Stock & shipping review:** A customer selects a product option and requests availability with a US delivery address. No payment is taken. Open the exact supplier item, verify size/color/SKU and quantity, and enter the customer shipping charge, delivery estimate, and stock-check evidence.
2. **Ready for payment link:** Prepare the Stripe link within 30 minutes of stock confirmation. Copy it and send it to the customer manually. Links expire after 35 minutes. Checkout calculates applicable tax using the confirmed delivery address; address changes require a new request.
3. **Awaiting payment:** Signed Stripe events verify payment. Use **Check payment** to reconcile a delayed update. **Prepare / recover payment link** recovers the same attempt after an interrupted response; it does not intentionally create a second payment.
4. **Ready to order:** Place the supplier order manually using the exact SKU and customer destination. Record the Trendsi order number and an operations note. Recording a reference does not purchase from Trendsi.
5. **Ordered / Partially shipped / Shipped:** Record each item quantity, carrier, and tracking number. The system prevents recording more units than ordered. Send tracking to the customer manually.
6. **Delivered:** Confirm delivery after all units have shipped.

**Needs attention** keeps stock, shipping, and payment exceptions out of fulfillment. Resolve payment issues in Stripe, recheck payment, then record the operational resolution. Partial refunds and disputes block fulfillment. Full refunds are verified from Stripe and placed in **Refunded**; supplier cancellation and returns still require manual handling. Staff cannot mark orders paid or issue refunds from this workspace.

Daily inventory timestamps are advisory snapshots. Local stock holds prevent two Louie Mae requests from using the same manually confirmed units, but do not reserve stock at Trendsi. Verify availability when placing the supplier order. If a payment link expires, check payment and reconfirm stock before creating another.

## Release and access

Set Convex `TRENDSI_MANUAL_ENABLED=true` only after deploying the backend and frontend. Staff access uses the existing CJ admin allowlist. Stripe uses the existing platform secret key and signed webhook endpoint. Customer request receipts expose only a minimal status behind an unguessable request token; customer details and supplier references remain staff-only.

This release does not send automated customer emails or create supplier orders. Staff must contact customers with payment links and tracking. Existing furniture checkout is unchanged.

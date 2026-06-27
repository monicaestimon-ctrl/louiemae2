# CJ Hands-Off Fulfillment Launch Runbook

This runbook is the operational checklist for turning Louie Mae's CJ Dropshipping integration on safely.

Primary CJ references verified for this implementation:

- Webhook guide: https://developers.cjdropshipping.cn/en/api/start/webhook.html
- Webhook subscription API: https://developers.cjdropshipping.cn/en/api/api2/api/webhook.html
- Logistics and `trackInfo`: https://developers.cjdropshipping.cn/en/api/api2/api/logistic.html
- Shopping/order APIs, including order detail and balance payment: https://developers.cjdropshipping.cn/en/api/api2/api/shopping.html

Related Louie Mae guides:

- Admin operator guide: [CJ_ADMIN_OPERATOR_GUIDE.md](./CJ_ADMIN_OPERATOR_GUIDE.md)
- Full implementation plan: [CJ_ADMIN_CONTROL_ROOM_IMPLEMENTATION_PLAN.md](./CJ_ADMIN_CONTROL_ROOM_IMPLEMENTATION_PLAN.md)

## Required Environment Variables

Set server-side values in the Convex dashboard for the production deployment unless noted otherwise.

| Variable | Required | Purpose | Production value |
| --- | --- | --- | --- |
| `CJ_API_KEY` | Yes | CJ API authentication. | Live CJ API key. |
| `CJ_WEBHOOK_URL` | Yes | Callback URL registered with CJ. | `https://<convex-site-domain>/cj/webhook` |
| `CJ_OPEN_ID` | Yes when webhook verification is on | HMAC signing secret/openId for CJ webhook verification. | CJ account openId. |
| `CJ_WEBHOOK_OPEN_ID` | Optional | Fallback if `CJ_OPEN_ID` is not set. | Same openId, only if needed. |
| `CJ_WEBHOOK_VERIFY_SIGNATURE` | Yes | Requires CJ webhook signatures before parsing JSON. | `true` |
| `CJ_AUTO_FULFILLMENT_ENABLED` | Yes | Lets paid Stripe orders enter the CJ fulfillment workflow. | `true` after dry-run passes. |
| `CJ_AUTO_BALANCE_PAY_ENABLED` | Yes | Lets the backend submit CJ balance payment after order creation. | `true` only after CJ balance is funded and dry-run passes. |
| `CJ_REQUIRE_FULFILLMENT_READY_CHECKOUT` | Recommended | Blocks checkout for unmapped or unavailable CJ items while automation is on. | `true` |
| `CJ_LOW_STOCK_THRESHOLD` | Optional | Warns/admin-flags low CJ stock. | `5` or another ops threshold. |
| `CJ_ADMIN_EMAILS` | Recommended | Admin emails allowed to run CJ retry/resync actions. | Comma-separated admin emails. |
| `STRIPE_SECRET_KEY` | Yes | Creates Checkout sessions and verifies Stripe server operations. | Live Stripe secret key. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Verifies Stripe paid-order webhooks. | Live Stripe webhook signing secret. |
| `STRIPE_ALLOW_UNSIGNED_WEBHOOKS` | No in production | Local/test escape hatch for unsigned Stripe webhooks. | Unset or `false`. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Yes, frontend | Stripe Checkout frontend key. | Live Stripe publishable key. |
| `VITE_CONVEX_URL` | Yes, frontend | Frontend Convex deployment URL. | Production Convex URL. |
| `CONVEX_SITE_URL` | Yes | Convex Auth/site URL. | Production Convex site URL. |
| `SITE_URL` | Recommended | Canonical site origin for redirects/CORS fallback. | `https://louiemae.com` |
| `RESEND_API_KEY` | Recommended | Confirmation/tracking emails. | Live Resend key. |
| `RAPIDAPI_KEY` | Product sourcing/search | 1688/OTAPI product search and import. | Live RapidAPI key. |

## One-Time CJ Setup

1. Confirm every sellable product and variant has:
   - `cjProductId`
   - `cjVariantId`
   - `cjSku`
   - healthy CJ inventory status
2. In the admin CJ panel, run the product health/readiness checks until there are no CJ fulfillment blockers.
3. Set `CJ_WEBHOOK_URL` to the Convex site route, not the frontend route:
   - Correct: `https://<deployment>.convex.site/cj/webhook`
   - Avoid: `https://louiemae.com/cj/webhook` unless the domain explicitly proxies to Convex HTTP actions.
4. Run the admin action that calls CJ `/webhook/set` (`configureWebhooks`) after `CJ_WEBHOOK_URL` is set.
5. Verify webhook signatures are enabled:
   - `CJ_WEBHOOK_VERIFY_SIGNATURE=true`
   - `CJ_OPEN_ID` or `CJ_WEBHOOK_OPEN_ID` is set.
6. Keep `CJ_AUTO_BALANCE_PAY_ENABLED=false` until the dry-run below is successful and the CJ account balance is funded.

## Dry-Run Procedure

Use a low-cost test item with real CJ mapping and healthy inventory.

1. Set safe automation mode:
   - `CJ_AUTO_FULFILLMENT_ENABLED=true`
   - `CJ_AUTO_BALANCE_PAY_ENABLED=false`
   - `CJ_REQUIRE_FULFILLMENT_READY_CHECKOUT=true`
   - `CJ_WEBHOOK_VERIFY_SIGNATURE=true`
2. Confirm Stripe is using test keys and the Stripe webhook is pointed at:
   - `https://<deployment>.convex.site/stripe/webhook`
3. Place a test Stripe Checkout order from the public site.
4. Confirm the order record reaches CJ order creation without balance payment:
   - CJ order ID is stored.
   - CJ fulfillment step is at least `order_created`.
   - Payment status is `manual_payment_required` or equivalent manual/balance-disabled state.
5. In the CJ dashboard, verify the order/cart payload exists and the shipping address/product mapping is correct.
6. Run admin tracking sync once. It is acceptable for no tracking to exist yet; the sync should fail softly and leave the order retryable/pollable.
7. Simulate or wait for CJ webhook updates:
   - Duplicate webhook IDs should be skipped.
   - Invalid signatures should be rejected.
   - Valid status/tracking updates should mark the webhook processed.
8. If all checks pass, either cancel the test order in CJ/Stripe or manually complete it depending on the test account setup.

## Live Launch Checklist

Do this only after the dry-run is clean.

1. Fund the CJ balance enough for expected order volume plus a buffer.
2. Switch Stripe to live mode:
   - live `VITE_STRIPE_PUBLISHABLE_KEY`
   - live `STRIPE_SECRET_KEY`
   - live `STRIPE_WEBHOOK_SECRET`
3. Confirm `STRIPE_ALLOW_UNSIGNED_WEBHOOKS` is unset or `false`.
4. Confirm CJ production variables:
   - `CJ_API_KEY` is live.
   - `CJ_WEBHOOK_URL` points at production Convex site.
   - `CJ_OPEN_ID` or `CJ_WEBHOOK_OPEN_ID` matches the CJ account used for webhooks.
   - `CJ_WEBHOOK_VERIFY_SIGNATURE=true`.
5. Run the CJ webhook registration action again after production env vars are set.
6. Confirm product readiness:
   - no unmapped CJ products or variants
   - no unavailable/out-of-stock checkout items
   - low-stock warnings reviewed
7. Enable hands-off mode:
   - `CJ_AUTO_FULFILLMENT_ENABLED=true`
   - `CJ_AUTO_BALANCE_PAY_ENABLED=true`
   - `CJ_REQUIRE_FULFILLMENT_READY_CHECKOUT=true`
8. Place one live low-cost order and monitor:
   - Stripe paid webhook accepted
   - CJ order created
   - CJ cart confirmed
   - CJ balance payment submitted/paid
   - tracking sync/webhooks update Louie Mae order status
9. Keep the admin CJ panel open for the first live order and watch for failed/retryable statuses.

## Ongoing Operations

Use the admin panel for daily oversight:

1. Open **CJ Risk Check** first.
2. Fix critical risks before assuming hands-off fulfillment is healthy.
3. Open **CJ Control Room** and clear the **Needs review** filter.
4. Use admin retry actions for failed orders instead of creating duplicate orders manually.
5. Use admin tracking sync for delayed tracking.
6. Keep enough CJ balance for automatic payment.
7. Review CJ product health before publishing new products.
8. Investigate any product with pricing warnings before relying on the suggested retail price.
9. If CJ webhook delivery fails, re-run webhook registration and verify `CJ_WEBHOOK_URL` and signing configuration.

## Rollback

If live fulfillment misbehaves:

1. Set `CJ_AUTO_BALANCE_PAY_ENABLED=false` to stop automatic CJ balance payment while still allowing order creation.
2. If needed, set `CJ_AUTO_FULFILLMENT_ENABLED=false` to stop automated CJ order creation.
3. Keep `CJ_REQUIRE_FULFILLMENT_READY_CHECKOUT=true` so checkout continues to block known-unfulfillable items.
4. Resolve failed orders through admin retry/resync actions after the root cause is fixed.

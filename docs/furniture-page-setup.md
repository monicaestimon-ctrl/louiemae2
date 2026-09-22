# House of Louie Mae — isolated quote catalog

## Routes
- `/furniture`: public furniture quote catalog.
- `/furniture/admin`: private studio; existing Convex password login plus server-side admin allowlist.
- `/furniture?preview=1`: explicitly labeled visual preview. Existing project imagery and illustrative products; submits no quotes and saves no selections. Preview products are never inserted in the database.

The original index/App and waitlist content are unchanged. A dedicated HTML entry, Vite multi-page build and exact Vercel rewrites isolate the furniture page. The prelaunch plugin skips ONLY the furniture HTML entry. CSS is loaded only by the furniture entry. No navigation links were added to the homepage.

## Data
Separate `furnitureProducts`, `furnitureSuppliers` and `furnitureQuotes` tables. Imports never create/edit original-store products and never submit CJ sourcing or purchase requests. Supplier IDs deduplicate by source platform/vendor ID when available. Manual supplier names are a fallback; confirm ambiguous suppliers before sharing records.

1688 import uses the existing authenticated wrapper around the scraper's OTAPI/RapidAPI integration. Other public URLs use the existing generic importer. No dedicated Ashcroft wholesale/account integration. Each import is an editable unsaved draft; review category, description, option prices, minimum quantities, and image rights. Non-USD rates must be entered explicitly. No shipping-price, delivery-time, or availability defaults are imported. Minimum quantities start at one and are explicitly flagged for review.

Private supplier/packaging fields are not returned by the public catalog query. Text is rendered as text, never raw supplier HTML. Product snapshots in customer quote requests preserve names, options, quantities and server-calculated estimates. Public requests are idempotent per submission token, enforce published products/MOQ/quantity limits, and have a honeypot plus per-email request throttling. Add stronger IP/challenge protection if spam becomes an issue.

This simple first version uses editable notes for packaging, test reports, lead times and supplier confirmations. It does not implement inventory, freight booking, supplier payments, purchase orders, automatic FX, or automatic final shipping quotations. Catalog/admin lists are bounded to 500 products and the request inbox to the latest 200 requests; introduce pagination before exceeding those limits.

## Deployment and configuration
Deploy the additive Convex schema/functions to the intended deployment before publishing the frontend. Use an isolated release containing only the furniture changes; other uncommitted CJ work was already present and was not edited for this feature. Confirm the production prelaunch flag remains unchanged.

Required Convex environment:
- Existing `RAPIDAPI_KEY` for 1688 import.
- Existing `CJ_ADMIN_EMAILS` or `ADMIN_EMAILS` for authorized staff.
- Existing `RESEND_API_KEY` for transactional email.
- New `FURNITURE_QUOTE_EMAIL`: actual owner inbox, including a Zoho-hosted mailbox if desired.
- Optional `FURNITURE_EMAIL_FROM`: verified sender; default `House of Louie Mae <withlove@louiemae.com>`.

Frontend uses existing `VITE_CONVEX_URL`. Keep all email/API secrets server-side. The local browser-prefixed Gemini key was renamed to GEMINI_API_KEY on 2026-09-20. The value remains in gitignored .env.local and is not exposed through Vite. Convex actions read GEMINI_API_KEY from their own deployment environment; a local rename does not configure the hosted backend. Verify hosted configuration before release. The prebuild guard continues to reject the legacy public name. `node scripts/verify-furniture-build.mjs` performs an isolated verification build with only approved public values, without editing local secrets; follow with `npm run verify:client-secrets`.

Email notifications use the existing Resend integration, not a new Zoho API. The owner mailbox may be Zoho. Customer replies go to the owner mailbox; owner notification replies go to the customer. Each audience has independent status, retry and provider idempotency keys. Requests save first; missing configuration is shown in the admin inbox and does not lose the inquiry. This is not a checkout or invoice: customer confirmation says request received, and actual final quotes are sent manually from the inbox.

## Release check
1. Verify `/` and existing `/admin` behavior on a preview deployment with the unchanged prelaunch flag.
2. Deploy additive backend and set owner inbox; verify admin access denies unauthorized accounts.
3. Import an actual supplier URL, review and save a draft; confirm draft is absent from public catalog.
4. Publish an approved item, submit a test quote to an owned test mailbox, verify both emails and stored snapshot, then hide/remove test data through authorized administration.
5. Publish frontend only after these integration checks. Do not describe the feature as live before that deployment.

House logo concepts have been supplied and refined. The page still uses its text-only brand header; the selected logo asset has not yet been integrated.

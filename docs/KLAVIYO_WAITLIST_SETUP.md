# Louie Mae / Klaviyo waitlist

Status: integration prepared; no Klaviyo account credentials, list, sending-domain verification, or activated flow has been confirmed. Email drafts are in `docs/marketing/waitlist-review.html` and `waitlist-1.html` through `waitlist-4.html`. Regenerate with `node scripts/build-waitlist-email-drafts.mjs`.

## Account setup

1. Sign in to the Louie Mae free Klaviyo account. Confirm business name, website, time zone, monitored reply address, and business mailing address. Suggested sender: `Louie Mae <withlove@louiemae.com>`; verify mailbox ownership before use.
2. Create a dedicated **Louie Mae Launch Waitlist** list. Keep all flows Draft. Choose and review the list's opt-in setting: double opt-in sends a confirmation email before membership; single opt-in subscribes immediately. Do not activate the connection until this behavior has been reviewed.
3. Configure the branded sending domain using the exact DNS records Klaviyo provides, without replacing Zoho mailbox MX records or Resend records. Verify in Klaviyo; send an approved test to an owner-controlled inbox.
4. Create a scoped private API key for the backend: `profiles:read`, `profiles:write`, `lists:write`, `subscriptions:write`. Store only in the **Convex production environment**, not VITE variables, browser code, Git, or chat. Creating a key through the browser requires confirmation at that action.
5. Set `KLAVIYO_PRIVATE_API_KEY`, `KLAVIYO_WAITLIST_LIST_ID`; leave `KLAVIYO_WAITLIST_ENABLED=false` until the destination list and test are checked. Production and development must not accidentally share enabled marketing configuration.

## Behavior

The existing form still writes consent and source to Convex first. A durable job is inserted in the same transaction, even while Klaviyo is disabled. A one-minute cron dispatches at most 20 jobs with a ten-minute recovery lease. Retries back off for network errors, 429 and 5xx; permanent errors remain `failed` for operator correction. No provider response bodies, API keys, or email addresses are logged. HTTP 202 is recorded as **accepted**, not confirmed delivery or confirmed subscription.

Duplicate signups do not create another job or reset local unsubscribes. Each subscription attempt checks Klaviyo consent and skips existing global/list suppressions; suppressed contacts are mirrored locally. Local admin unsubscribes queue a marketing unsubscribe in Klaviyo. Klaviyo's email unsubscribe links remain authoritative for its sends. This is not a complete ongoing two-way contact sync: changes made in Klaviyo after a completed sync are not immediately mirrored in the local subscriber table. Do not use that table to send marketing through another provider without reconciling opt-outs.

`klaviyoWaitlist.status` is admin-protected and reports configuration plus the latest 100 jobs without subscriber addresses. After correcting permanent failures, use the internal paginated `klaviyoWaitlist.retryFailed` with `{ "cursor": null }`, continuing its cursor until `isDone`. Completed jobs are never automatically replayed.

## Existing subscribers

No deployment automatically imports old records. After account/list review, invoke internal `klaviyoWaitlist.backfill` with `{ "cursor": null }`; continue pages until `isDone`. It queues only active records without a prior job. Historical imports preserve recorded consent and bypass both confirmation emails and list-triggered welcome flows, per Klaviyo's API. Existing subscribers' welcome sequence needs a separate reviewed enrollment decision. Never fabricate new consent timestamps or override suppressions.

## Welcome flow for review

Create **Louie Mae — Our First Chapter**, triggered by joining the dedicated list, with no re-entry. Keep every message Draft during setup. Import the four HTML drafts; set subject and preview from `marketing/waitlist-sequence.json`. Timing: immediately, delay 2 days, delay 3 days, delay 4 days (days 0/2/5/9 overall). Review Smart Sending so a previous message does not inadvertently skip an intended step. Add a prelaunch condition that is disabled at launch, and ensure consent/unsubscribe rules apply to every message.

Preview personalization, footer mailing address, unsubscribe, mobile formatting, all links, and the monitored reply inbox. Obtain owner approval of the actual emails before setting messages Live. Launch-date announcements are separate Draft campaigns; no invented opening date, discount, stock urgency, or early-access promise. Pause remaining prelaunch flow messages when launch begins.

## Acceptance checks before enabling

- Dedicated list and opt-in behavior confirmed; flows Draft.
- An owner-authorized test signup reaches the correct list (and confirms opt-in if required).
- Repeating the signup does not repeat enrollment.
- Klaviyo unsubscribe and local admin unsubscribe prevent subsequent marketing; test with an owner-controlled address.
- Private key is absent from client bundle; checks and production deployment pass.
- Review counts against free-plan allowances (250 active profiles / 500 monthly email sends at time of setup).

References: [subscribe API](https://developers.klaviyo.com/en/reference/bulk_subscribe_profiles), [profile consent lookup](https://developers.klaviyo.com/en/reference/get_profiles), [unsubscribe API](https://developers.klaviyo.com/en/reference/bulk_unsubscribe_profiles).

## Verification preparation (September 17, 2026)

Four drafts now use JPEG email assets and a 600px Outlook conditional wrapper. Public storefront imagery remains unchanged. The generated HTML still needs reimporting into the four Klaviyo messages after the assets deploy.

Consent reconciliation reads known local contacts in batches of 20 every 15 minutes and mirrors remote opt-outs, complaints, and other suppressions into local records. It never subscribes or restores consent. Klaviyo remains authoritative for immediate suppression of its sends. Network/rate-limit errors retry with bounded backoff; later sweeps recover incomplete checks.

For owner-only QA, leave KLAVIYO_WAITLIST_ENABLED=false and temporarily set KLAVIYO_WAITLIST_TEST_EMAIL to the approved owner inbox. Only that inbox's queued job can dispatch. The worker checks this restriction independently. Use internal klaviyoWaitlist:testStatus to verify one record and job attempts without exposing contact data. Remove the test override when finished. Do not enable the full queue or activate the welcome flow before owner review.

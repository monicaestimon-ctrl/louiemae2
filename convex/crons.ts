import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Persist signups first; process/recover the bounded marketing queue separately.
crons.interval('sync-klaviyo-waitlist', { minutes: 1 }, internal.klaviyoWaitlist.dispatch, {});
crons.interval('reconcile-klaviyo-consent', { minutes: 15 }, internal.klaviyoWaitlistWorker.reconcileConsent, { cursor: null });

// Sync CJ tracking information every 4 hours
// This checks orders with CJ status "confirmed" or "processing" for tracking updates
crons.interval(
    "sync-cj-tracking",
    { hours: 4 },
    internal.cjDropshipping.syncAllTracking,
    {}
);

// Backfill legacy pending products into the durable sourcing queue in bounded pages.
crons.interval(
    "backfill-cj-sourcing-jobs",
    { minutes: 1 },
    internal.cjSourcingJobs.backfillLegacyPendingJobs,
    { limit: 25 }
);

// Lease and schedule a bounded set of due sourcing jobs. Provider I/O runs in
// independent actions so one slow product cannot time out or starve the queue.
crons.interval(
    "dispatch-cj-sourcing-jobs",
    { minutes: 1 },
    internal.cjSourcingJobs.dispatchDueJobs,
    {}
);

// Recover webhook claims abandoned by an action timeout or platform restart.
crons.interval(
    "recover-stale-cj-webhooks",
    { minutes: 5 },
    internal.cjHelpers.recoverStaleWebhookProcessing,
    { limit: 20 }
);

// Refresh CJ inventory in small batches so free/low-tier CJ API limits are respected.
crons.interval(
    "sync-cj-inventory",
    { minutes: 30 },
    internal.cjDropshipping.refreshProductInventory,
    { limit: 25, source: "cron" }
);

// Check each approved product about daily, in bounded batches with shared CJ throttling.
crons.interval('monitor-cj-pricing', { minutes: 15 }, internal.cjPricingReview.dispatchMonitor, {});
export default crons;

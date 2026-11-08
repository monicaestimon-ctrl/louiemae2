import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Owner-requested temporary pause. Resume explicitly per deployment.
const monitoringEnabled = process.env.BACKGROUND_MONITORING_ENABLED === 'true';

// Only summaries whose 48-hour pending threshold is due are revisited.
if (monitoringEnabled) crons.interval('refresh-due-product-health', { minutes: 5 }, internal.productHealth.refreshDue, {});

// v2 catalog: re-evaluate source freshness so stale cost, MAP or stock becomes a hold, never a sale.
if (monitoringEnabled) crons.interval('refresh-catalog-freshness', { hours: 1 }, internal.catStock.refreshPage, {});

// v2 checkout: expired intents release their holds; verified payment events never wait unprocessed.
crons.interval('expire-checkout-intents', { minutes: 15 }, internal.ordCheckout.expireStale, {});
crons.interval('recover-payment-events', { minutes: 5 }, internal.ordPayments.recoverBacklog, {});
crons.interval('recover-delivery-tax-reporting', { minutes: 5 }, internal.dlvTax.recoverTransactions, {});
crons.interval('expire-delivery-quotes', { minutes: 5 }, internal.dlvQuoteLifecycle.expire, {});

// v2 tiers: recompute once a day at 00:15 America/Chicago (the handler checks local time, so DST is handled).
crons.cron('tier-daily-chicago', '15 * * * *', internal.prgTiers.dailyTick, {});

// v2 ledger: clear commission 30 days after payment, settle business-referral awards, and run
// payouts (the handlers do nothing unless PAYOUT_EXECUTION_ENABLED is the only payout route).
crons.interval('clear-commissions-v2', { hours: 1 }, internal.ldgCommissions.clearDue, {});
crons.interval('settle-credit-awards-v2', { hours: 1 }, internal.ldgCredits.awardDue, {});
crons.cron('payout-run-chicago', '0 * * * *', internal.ldgPayoutActions.tick, {});
crons.interval('reconcile-uncertain-payouts', { hours: 1 }, internal.ldgPayoutActions.reconcileUncertain, {});

// v2 monitoring: alerts for backlog, duplicate money events, payout exceptions and missed jobs.
crons.interval('v2-alerts', { minutes: 5 }, internal.sysAlerts.check, {});

// v2 cutover: once v2 payouts are the active route, legacy commissions are mirrored into the v2 ledger.
crons.interval('sync-legacy-ledger', { hours: 1 }, internal.v2Migrations.syncLegacyLedgerPage, {});

// Persist signups first; process/recover the bounded marketing queue separately.
crons.interval('sync-klaviyo-waitlist', { minutes: 1 }, internal.klaviyoWaitlist.dispatch, {});
crons.interval('reconcile-klaviyo-consent', { minutes: 15 }, internal.klaviyoWaitlistWorker.reconcileConsent, { cursor: null });

// House of Louie Mae: partner commissions on paid retail projects, clearing and referral credit.
crons.interval('reconcile-house-partners', { hours: 1 }, internal.holmPartners.reconcile, {});
// Partner tiers from 12-month sales: up nightly, down at most one tier a quarter. 07:17 UTC is
// just after midnight in California.
crons.cron('update-partner-tiers', '17 7 * * *', internal.holmPartners.updateTiers, {});
// Store credit held for checkouts and quotes that ended without payment goes back to the balance.
crons.interval('settle-store-credit-holds', { hours: 1 }, internal.holmCredit.settleStaleHolds, {});
// Partner payouts through Stripe Connect on the 15th (does nothing until PARTNER_PAYOUTS_ENABLED is on).
crons.monthly('partner-payouts', { day: 15, hourUTC: 17, minuteUTC: 11 }, internal.holmConnect.runMonthlyPayouts, {});

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
if (monitoringEnabled) crons.interval('monitor-cj-pricing', { minutes: 15 }, internal.cjPricingReview.dispatchMonitor, {});
export default crons;

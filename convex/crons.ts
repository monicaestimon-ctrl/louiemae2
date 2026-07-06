import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sync CJ tracking information every 4 hours
// This checks orders with CJ status "confirmed" or "processing" for tracking updates
crons.interval(
    "sync-cj-tracking",
    { hours: 4 },
    internal.cjDropshipping.syncAllTracking,
    {}
);

// Check CJ product sourcing status every 2 hours
// This checks if pending products have been approved by CJ
crons.interval(
    "check-cj-sourcing",
    { hours: 2 },
    internal.cjDropshipping.checkSourcingStatus,
    {}
);

// Refresh CJ inventory in small batches so free/low-tier CJ API limits are respected.
crons.interval(
    "sync-cj-inventory",
    { minutes: 30 },
    internal.cjDropshipping.refreshProductInventory,
    { limit: 25, source: "cron" }
);

export default crons;

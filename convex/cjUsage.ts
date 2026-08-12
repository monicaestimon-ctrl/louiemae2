import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireCjAdminIdentity } from "./cjAdminAccess";

export const getInventoryPollSummary = query({
    args: { hours: v.optional(v.number()) },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const hours = Math.min(Math.max(args.hours ?? 24, 1), 30 * 24);
        const since = Date.now() - hours * 60 * 60 * 1000;
        const runs = await ctx.db.query("cjInventoryPollRuns")
            .withIndex("by_created_at", q => q.gte("createdAt", since))
            .take(1_500);
        const cronRuns = runs.filter(run => run.source === "cron");
        return {
            hours,
            runs: runs.length,
            cronRuns: cronRuns.length,
            emptyCronRuns: cronRuns.filter(run => run.checked === 0).length,
            providerTokenRequests: runs.filter(run => run.providerTokenRequested).length,
            eligible: runs.reduce((sum, run) => sum + run.eligible, 0),
            deferredFresh: runs.reduce((sum, run) => sum + run.deferredFresh, 0),
            checked: runs.reduce((sum, run) => sum + run.checked, 0),
            updated: runs.reduce((sum, run) => sum + run.updated, 0),
            errors: runs.reduce((sum, run) => sum + run.errors, 0),
        };
    },
});

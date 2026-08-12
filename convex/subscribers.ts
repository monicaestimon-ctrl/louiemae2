import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCjAdminIdentity } from "./cjAdminAccess";

export const list = query({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const rows = await ctx.db.query("subscribers").order("desc").take(501);
        return {
            subscribers: rows.slice(0, 500),
            truncated: rows.length > 500,
        };
    },
});

export const create = mutation({
    args: {
        email: v.string(),
        firstName: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        // Check for duplicates
        const existing = await ctx.db
            .query("subscribers")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .first();

        if (existing) {
            // If new tags are provided, merge them into existing tags
            if (args.tags && args.tags.length > 0) {
                const mergedTags = [...new Set([...existing.tags, ...args.tags])];
                await ctx.db.patch(existing._id, { tags: mergedTags });
            }
            return null; // Already exists (but tags were merged)
        }

        const defaultTags = ["new"];
        const allTags = args.tags ? [...new Set([...defaultTags, ...args.tags])] : defaultTags;

        return await ctx.db.insert("subscribers", {
            email: args.email,
            firstName: args.firstName,
            dateSubscribed: new Date().toISOString().split('T')[0],
            status: "active",
            tags: allTags,
            openRate: 0,
        });
    },
});

export const remove = mutation({
    args: { id: v.id("subscribers") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        await ctx.db.delete(args.id);
    },
});

// Seed initial subscribers
export const seed = mutation({
    args: {
        subscribers: v.array(v.object({
            email: v.string(),
            firstName: v.optional(v.string()),
            dateSubscribed: v.string(),
            status: v.union(v.literal("active"), v.literal("unsubscribed")),
            tags: v.array(v.string()),
            openRate: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("subscribers").first();
        if (existing) return; // Already seeded

        for (const sub of args.subscribers) {
            await ctx.db.insert("subscribers", sub);
        }
    },
});

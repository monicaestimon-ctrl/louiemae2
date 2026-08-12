import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCjAdminIdentity } from "./cjAdminAccess";

// Public queries
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("customPages").collect();
    },
});

export const getBySlug = query({
    args: { slug: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("customPages")
            .withIndex("by_slug", (q) => q.eq("slug", args.slug))
            .first();
    },
});

// Protected mutations
export const create = mutation({
    args: {
        title: v.string(),
        slug: v.string(),
        sections: v.array(v.any()),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        return await ctx.db.insert("customPages", args);
    },
});

export const update = mutation({
    args: {
        id: v.id("customPages"),
        title: v.optional(v.string()),
        slug: v.optional(v.string()),
        sections: v.optional(v.array(v.any())),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const { id, ...updates } = args;
        const filteredUpdates = Object.fromEntries(
            Object.entries(updates).filter(([_, v]) => v !== undefined)
        );
        await ctx.db.patch(id, filteredUpdates);
    },
});

export const remove = mutation({
    args: { id: v.id("customPages") },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        await ctx.db.delete(args.id);
    },
});

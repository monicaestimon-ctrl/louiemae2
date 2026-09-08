import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

export const get = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query('productAiFactCache')
      .withIndex('by_cache_key', (q) => q.eq('cacheKey', args.cacheKey))
      .first();
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return { facts: cached.visualFacts, warnings: cached.warnings };
  },
});

export const put = internalMutation({
  args: {
    cacheKey: v.string(),
    sourceSnapshotHash: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    visualFacts: v.array(v.any()),
    warnings: v.array(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('productAiFactCache')
      .withIndex('by_cache_key', (q) => q.eq('cacheKey', args.cacheKey))
      .first();
    const { ttlMs, ...storedArgs } = args;
    const value = {
      ...storedArgs,
      createdAt: Date.now(),
      expiresAt: Date.now() + (ttlMs || 30 * 24 * 60 * 60 * 1000),
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert('productAiFactCache', value);
  },
});

import { defineTable } from 'convex/server';
import { v } from 'convex/values';
export const publicSearchTables = {
  publicSearch: defineTable({ sourceKey: v.string(), productId: v.string(), text: v.string() })
    .index('by_source', ['sourceKey'])
    .searchIndex('public_text', { searchField: 'text' }),
  publicSearchState: defineTable({
    version: v.number(),
    enabled: v.boolean(),
    phase: v.union(
      v.literal('legacy'),
      v.literal('listings'),
      v.literal('orphans'),
      v.literal('verifyLegacy'),
      v.literal('verifyListings'),
      v.literal('verifyIndex'),
      v.literal('verified'),
      v.literal('failed')
    ),
    cursor: v.union(v.string(), v.null()),
    checked: v.number(),
    mismatchIds: v.array(v.string()),
    updatedAt: v.number(),
  }).index('by_version', ['version']),
};

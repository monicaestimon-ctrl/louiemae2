import { defineTable } from 'convex/server';
import { v } from 'convex/values';
export const qualityRoute = v.union(
  v.literal('retail-home'),
  v.literal('retail-shop'),
  v.literal('retail-story'),
  v.literal('retail-journal'),
  v.literal('retail-article'),
  v.literal('retail-collection'),
  v.literal('retail-product'),
  v.literal('holm-home')
);
export const qualityDevice = v.union(v.literal('mobile'), v.literal('desktop'));
export const qualitySample = v.object({
  name: v.union(v.literal('LCP'), v.literal('CLS'), v.literal('INP')),
  value: v.number(),
  revision: v.number(),
});
export const qualityTables = {
  qualityVisits: defineTable({
    documentToken: v.string(),
    release: v.string(),
    route: qualityRoute,
    device: qualityDevice,
    createdAt: v.number(),
    updatedAt: v.number(),
    samples: v.array(qualitySample),
  })
    .index('by_token', ['documentToken'])
    .index('by_created', ['createdAt'])
    .index('by_segment_created', ['route', 'device', 'release', 'createdAt']),
  qualityBudgets: defineTable({ day: v.number(), requests: v.number(), visits: v.number() }).index(
    'by_day',
    ['day']
  ),
};

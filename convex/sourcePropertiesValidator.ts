import { v } from 'convex/values';

// Existing maps stay valid during the backend-first rollout. Supplier labels in
// new imports are string values, so Unicode and reserved field names are safe.
export const sourcePropertiesValidator = v.union(
  v.record(v.string(), v.string()),
  v.array(v.object({ key: v.string(), value: v.string() })),
);
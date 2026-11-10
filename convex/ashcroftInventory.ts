import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { ashcroftQuantity } from '../lib/ashcroftInventory';
import { supplierAvailable } from '../lib/retailLaunch';
import { audit } from './sysCore';

export const latestFeed = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('ashcroftInventoryFeeds')
  .withIndex('by_observed').order('desc').first();

export async function ashcroftAvailable(ctx: Pick<QueryCtx, 'db'>, sku: string | undefined, description = '', quantity = 1) {
  const feed = await latestFeed(ctx);
  // Preserve the legacy route only until the first reconciled feed is installed.
  if (!feed) return supplierAvailable(sku, description);
  const available = ashcroftQuantity(feed, sku, Date.now());
  return Number.isSafeInteger(quantity) && quantity > 0 && available !== null && available >= quantity;
}

export const inspect = internalQuery({ args: {}, handler: latestFeed });

/** Operator-only complete attachment import, immutable and idempotent by content hash. */
export const reconcile = internalMutation({
  args: { source: v.string(), sha256: v.string(), observedAt: v.number(),
    rows: v.array(v.object({ sku: v.string(), quantity: v.number() })) },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!/^[a-f0-9]{64}$/.test(args.sha256) || !args.source.trim() || args.source.length > 1000 ||
      !Number.isSafeInteger(args.observedAt) || args.observedAt > now || args.observedAt < now - 72 * 3600000 ||
      args.rows.length < 1 || args.rows.length > 5000) throw new Error('Invalid or stale inventory attachment');
    const seen = new Set<string>();
    for (const row of args.rows) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.sku) || seen.has(row.sku) ||
        !Number.isSafeInteger(row.quantity) || row.quantity < 0 || row.quantity > 1000000)
        throw new Error('Invalid or duplicate inventory SKU');
      seen.add(row.sku);
    }
    const old = await latestFeed(ctx);
    if (old?.sha256 === args.sha256) return { id: old._id, duplicate: true, rows: old.rows.length };
    if (old && old.observedAt >= args.observedAt) throw new Error('A newer or conflicting inventory feed already exists');
    const id = await ctx.db.insert('ashcroftInventoryFeeds', { ...args, validUntil: args.observedAt + 72 * 3600000, importedAt: now });
    await audit(ctx, { actor: 'operator:ashcroft-inventory', action: 'inventory.reconcile', entityTable: 'ashcroftInventoryFeeds', entityId: id,
      after: { source: args.source, sha256: args.sha256, observedAt: args.observedAt, rows: args.rows.length },
      reason: 'Reconcile active-only supplier inventory attachment; missing SKUs remain unverified' });
    return { id, duplicate: false, rows: args.rows.length };
  },
});

// Availability observations and the freshness refresh job (spec S10, v2 §6). There is no
// authorized live Zuo stock integration yet: operations record authenticated checks here, and
// the job re-evaluates freshness so stale evidence becomes a hold instead of a sale.
import { v } from 'convex/values';
import { internalMutation, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { refreshVariant } from './catCore';
import { audit } from './sysCore';
import { availability } from './v2Validators';
import { CommerceError, isCommerceError } from '../lib/errors';

/** Records an authenticated stock check for a variant (manual refresh or a future adapter). */
export const recordStock = mutation({
  args: { variantId: v.id('catVariants'), availability, source: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    if (!a.source.trim()) throw new CommerceError('INVALID_INPUT', 'Say where this stock status came from.');
    const now = Date.now();
    await ctx.db.insert('catSourceObservations', {
      supplierId: cv.supplierId,
      variantId: cv._id,
      supplierSku: cv.supplierSku,
      field: 'stock',
      extractedValue: a.availability,
      sourceUrl: a.source.slice(0, 300),
      observedAt: now,
      contentHash: `${cv.supplierSku}|stock|${a.availability}|${now}`,
      verifier: admin.email,
      confidence: 'confirmed',
      createdAt: now,
    });
    // A discontinued variant only returns after an explicit admin observation like this one.
    if (cv.availability === 'discontinued' && a.availability !== 'discontinued') await ctx.db.patch(cv._id, { availability: a.availability, availabilityObservedAt: now });
    await audit(ctx, { actor: admin.email, action: 'stock.record', entityTable: 'catVariants', entityId: cv._id, before: cv.availability, after: a.availability, reason: a.source });
    try {
      return await refreshVariant(ctx, cv._id, admin.email, now);
    } catch (e) {
      if (isCommerceError(e, 'POLICY_NOT_APPROVED')) return null; // freshness policy awaiting D-16
      throw e;
    }
  },
});

/** One page of the freshness refresh; schedules the next page. Skips quietly while the policy is unapproved. */
export const refreshPage = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const page = await ctx.db.query('catVariants').paginate({ cursor: a.cursor ?? null, numItems: 50 });
    for (const cv of page.page) {
      try {
        await refreshVariant(ctx, cv._id, 'system:freshness');
      } catch (e) {
        if (isCommerceError(e, 'POLICY_NOT_APPROVED')) return { skipped: 'freshness policy not approved' };
        throw e;
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.catStock.refreshPage, { cursor: page.continueCursor });
    return { processed: page.page.length };
  },
});

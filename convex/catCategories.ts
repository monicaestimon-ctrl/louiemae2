// Explicit commission categories and the lighting migration (spec S08, v2 §5, §22). Preview is
// read-only; commit writes the category going forward. Earned commission rows are never touched,
// so historical category, rate and amount stay exactly as earned (CAT04).
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { isLighting, proposeCategory, type CommissionCategory } from '../lib/catCategory';
import { productTypeFor } from '../lib/holmPartners';
import { commissionCategory, type HoldReason } from './v2Validators';
import { slugify } from '../lib/slug';

/** A product's commission category: its explicit category, or null when none is set yet. */
export async function explicitCategory(ctx: QueryCtx, productId: Id<'commerceProducts'>): Promise<CommissionCategory | null> {
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
  return meta?.commissionCategory ?? null;
}

/** Every product with its current legacy type, the proposed explicit category and any conflict. */
export const preview = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const page = await ctx.db.query('commerceProducts').paginate({ cursor: a.cursor ?? null, numItems: 100 });
    const rows = await Promise.all(
      page.page.map(async (p) => {
        const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', p._id)).first();
        const text = `${p.draft.category} ${p.draft.name}`;
        const proposed = proposeCategory(text);
        const legacy = productTypeFor(p.provider, p.draft.category);
        return {
          productId: p._id,
          provider: p.provider,
          name: p.draft.name,
          navCategory: p.draft.category,
          legacyType: legacy,
          current: meta?.commissionCategory ?? null,
          proposed: proposed.category,
          reason: proposed.reason,
          lighting: isLighting(text),
          changes: legacy !== proposed.category,
          costIncomplete: p.draft.variants.some((x) => !(x.cost > 0)),
        };
      })
    );
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Sets the explicit category for future eligibility. Historical commissions are not changed. */
export const commit = mutation({
  args: { productIds: v.array(v.id('commerceProducts')), category: commissionCategory, reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new Error('Add a reason for the category change.');
    if (a.productIds.length > 100) throw new Error('Change at most 100 products at a time.');
    const now = Date.now();
    for (const productId of a.productIds) {
      const p = await ctx.db.get(productId);
      if (!p) continue;
      const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
      const before = meta?.commissionCategory ?? null;
      const holds: HoldReason[] = (meta?.holds ?? []).filter((h) => h !== 'CATEGORY_REVIEW');
      if (a.category === 'review_required') holds.push('CATEGORY_REVIEW');
      if (meta) await ctx.db.patch(meta._id, { commissionCategory: a.category, holds, updatedAt: now });
      else
        await ctx.db.insert('catProductMeta', {
          productId,
          commissionCategory: a.category,
          navCategory: p.draft.category,
          louieMaeName: p.draft.name,
          slug: `${slugify(p.draft.name) || 'product'}-${String(productId).slice(-6)}`,
          slugHistory: [],
          supplierName: p.draft.supplierName || p.provider,
          holds,
          stage: p.provider === 'zuo' ? 'imported_draft' : 'published',
          createdAt: now,
          updatedAt: now,
        });
      await audit(ctx, { actor: admin.email, action: 'category.commit', entityTable: 'commerceProducts', entityId: productId, before, after: a.category, reason: a.reason });
    }
  },
});

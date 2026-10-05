import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { catalogProjection, sameCatalogValue } from '../lib/catalogProjection';

export async function syncCatalogProduct(ctx: Pick<MutationCtx, 'db'>, productId: Id<'products'>, product: Doc<'products'> | null) {
  const existing = await ctx.db.query('productCatalog')
    .withIndex('by_product', q => q.eq('productId', productId)).unique();
  if (!product) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const projection = catalogProjection(product);
  if (!existing) {
    await ctx.db.insert('productCatalog', projection);
  } else {
    const stored = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== '_id' && key !== '_creationTime'));
    if (!sameCatalogValue(stored, projection)) await ctx.db.replace(existing._id, projection);
  }
}

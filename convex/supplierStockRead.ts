import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { supplierStockConstraint } from '../lib/supplierStock';

export async function latestSupplierStock(ctx: QueryCtx | MutationCtx, variantId: Id<'catVariants'>) {
  return ctx.db.query('catSourceObservations')
    .withIndex('by_variant_field_observed', q => q.eq('variantId', variantId).eq('field', 'supplier_inventory_on_hand'))
    .order('desc').take(20);
}

export async function zuoStockConstraint(ctx: QueryCtx | MutationCtx, variantId: Id<'catVariants'>, stockObservedAt: number | undefined, now: number) {
  return supplierStockConstraint(await latestSupplierStock(ctx, variantId), stockObservedAt, now);
}

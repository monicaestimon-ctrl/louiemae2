import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { supplierStockConstraint } from '../lib/supplierStock';

export async function latestSupplierStock(ctx: QueryCtx | MutationCtx, variantId: Id<'catVariants'>) {
  return ctx.db.query('catSourceObservations')
    .withIndex('by_variant_field_observed', q => q.eq('variantId', variantId).eq('field', 'supplier_inventory_on_hand'))
    .order('desc').take(20);
}

export async function zuoStockConstraint(ctx: QueryCtx | MutationCtx, variantId: Id<'catVariants'>, stockObservedAt: number | undefined, now: number) {
  const observations = await latestSupplierStock(ctx, variantId);
  const cv = await ctx.db.get(variantId);
  const revision = cv?.currentStockRevisionId ? await ctx.db.get(cv.currentStockRevisionId) : null;
  const accepted = revision?.provisionalAcceptance
    ? observations.find(o => o._id === revision.provisionalAcceptance?.sourceObservationId) : null;
  // Only the exact still-current source accepted by the owner may bypass its own
  // on-hand constraint. Newer, conflicting, or expired evidence still withdraws it.
  if (accepted && stockObservedAt === accepted.observedAt && observations.length < 20
    && observations[0]?.observedAt === accepted.observedAt
    && observations.filter(o => o.observedAt === accepted.observedAt).every(o =>
      ['confirmed', 'corroborated'].includes(o.confidence) && o.extractedValue === accepted.extractedValue)) return null;
  return supplierStockConstraint(observations, stockObservedAt, now);
}

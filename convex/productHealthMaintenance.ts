import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { HEALTH_VERSION, productHealthProjection, insertStuckHealthProblem, emptyMigrationCounts, emptyInventoryCounts } from '../lib/productHealth';
import { sameCatalogValue } from '../lib/catalogProjection';

export const getHealthState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('productHealthState').withIndex('by_key', q => q.eq('key', 'primary')).unique();

export async function readyProductMigrationCounts(ctx: Pick<QueryCtx, 'db'>) {
  const state = await getHealthState(ctx);
  return state?.enabled && state.phase === 'ready' && state.version === HEALTH_VERSION && state.migrationCounts
    ? state.migrationCounts : null;
}

export async function markHealthDeadline(ctx: Pick<MutationCtx, 'db'>, row: Doc<'productHealth'>, now: number) {
  const state = await getHealthState(ctx);
  if (!state || row.epoch !== state.epoch || state.version !== HEALTH_VERSION || row.dueAt <= 0 || row.dueAt > now) return;
  const details = row.details as ReturnType<typeof productHealthProjection>['details'];
  await ctx.db.patch(row._id, { dueAt: 0, hasIssues: true, details: { ...details, problems: insertStuckHealthProblem(details.problems) } });
  // The age-only issue is not a CJ/variant/inventory/stock issue under the
  // existing dashboard classification. Source changes maintain other flags.
  await ctx.db.patch(state._id, { issues: state.issues + Number(!row.hasIssues), revision: state.revision + 1, updatedAt: now });
}

export async function syncProductHealth(ctx: Pick<MutationCtx, 'db'>, id: Id<'products'>, product: Doc<'products'> | null, now = Date.now()) {
  const state = await getHealthState(ctx);
  if (!state || state.version !== HEALTH_VERSION) return;
  const existing = await ctx.db.query('productHealth').withIndex('by_product', q => q.eq('productId', id)).unique();
  const counted = existing?.epoch === state.epoch;
  const projected = product ? { ...productHealthProjection(product, now), epoch: state.epoch } : null;
  if (!existing && !projected) return;
  if (existing && projected) {
    const value = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== '_id' && key !== '_creationTime'));
    if (sameCatalogValue(value, projected)) return;
  }
  if (!projected) { if (existing) await ctx.db.delete(existing._id); }
  else if (existing) await ctx.db.replace(existing._id, projected);
  else await ctx.db.insert('productHealth', projected);
  const migrationCounts = { ...emptyMigrationCounts(), ...state.migrationCounts };
  if (counted && existing?.migrationStatus) migrationCounts[existing.migrationStatus] -= 1;
  if (projected?.migrationStatus) migrationCounts[projected.migrationStatus] += 1;
  const inventoryCounts = { ...emptyInventoryCounts(), ...state.inventoryCounts };
  if (counted && existing?.connectionState) inventoryCounts[existing.connectionState] -= 1;
  if (projected) inventoryCounts[projected.connectionState] += 1;
  inventoryCounts.next_launch += Number(projected?.nextLaunch ?? false) - Number(counted && existing?.nextLaunch || false);
  await ctx.db.patch(state._id, {
    migrationCounts, inventoryCounts,
    total: state.total + (projected ? 1 : 0) - (counted ? 1 : 0),
    issues: state.issues + (projected?.hasIssues ? 1 : 0) - (counted && existing?.hasIssues ? 1 : 0),
    cjIssues: state.cjIssues + (projected?.hasCjIssues ? 1 : 0) - (counted && existing?.hasCjIssues ? 1 : 0),
    missingCjVariants: state.missingCjVariants + (projected?.hasMissingCjVariants ? 1 : 0) - (counted && existing?.hasMissingCjVariants ? 1 : 0),
    revision: state.revision + 1, updatedAt: now,
  });
}

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
export const INVENTORY_TARGET_KEY = 'inventory-targets-v1';
type Target = { kind: 'vid' | 'sku'; value: string };
export function inventoryTargets(product: Doc<'products'> | null): Target[] {
  if (!product) return [];
  const vids = new Set<string>(); const skus = new Set<string>();
  if (product.cjVariantId) vids.add(product.cjVariantId);
  if (product.cjSku) skus.add(product.cjSku);
  for (const variant of product.variants ?? []) {
    if (variant.cjVariantId) vids.add(variant.cjVariantId);
    if (variant.cjSku) skus.add(variant.cjSku);
  }
  for (const variant of product.cjVariants ?? []) {
    if (variant.vid) vids.add(variant.vid);
    if (variant.sku) skus.add(variant.sku);
  }
  return [...[...vids].sort().map(value => ({ kind: 'vid' as const, value })), ...[...skus].sort().map(value => ({ kind: 'sku' as const, value }))];
}
export const targetKey = (target: Target) => JSON.stringify([target.kind, target.value]);
export async function syncInventoryTargets(ctx: Pick<MutationCtx, 'db'>, productId: Id<'products'>, product: Doc<'products'> | null) {
  const wanted = new Map(inventoryTargets(product).map(target => [targetKey(target), target]));
  const rows = await ctx.db.query('cjInventoryTargets').withIndex('by_product', q => q.eq('productId', productId)).collect();
  for (const row of rows) {
    const key = targetKey(row);
    if (wanted.has(key)) wanted.delete(key);
    else await ctx.db.delete(row._id);
  }
  for (const target of wanted.values()) await ctx.db.insert('cjInventoryTargets', { productId, ...target });
}
export const getInventoryTargetState = (ctx: Pick<QueryCtx, 'db'>) => ctx.db.query('cjInventoryTargetState').withIndex('by_key', q => q.eq('key', INVENTORY_TARGET_KEY)).unique();
export async function indexedInventoryProducts(ctx: Pick<QueryCtx, 'db'>, args: { vid?: string; sku?: string }): Promise<Doc<'products'>[] | null> {
  const state = await getInventoryTargetState(ctx);
  if (!state?.enabled) return null;
  if (state.phase !== 'verified') throw new Error('INVENTORY_TARGET_INDEX_NOT_VERIFIED');
  const targets: Target[] = [];
  if (args.vid) targets.push({ kind: 'vid', value: args.vid });
  if (args.sku) targets.push({ kind: 'sku', value: args.sku });
  const ids = new Set<Id<'products'>>();
  for (const target of targets) {
    const rows = await ctx.db.query('cjInventoryTargets').withIndex('by_target', q => q.eq('kind', target.kind).eq('value', target.value)).collect();
    for (const row of rows) ids.add(row.productId);
  }
  const products: Doc<'products'>[] = [];
  for (const id of ids) {
    const product = await ctx.db.get(id);
    if (!product || !inventoryTargets(product).some(target => targets.some(wanted => target.kind === wanted.kind && target.value === wanted.value))) throw new Error('INVENTORY_TARGET_INDEX_DRIFT');
    products.push(product);
  }
  return products.sort((a,b) => a._creationTime - b._creationTime || a._id.localeCompare(b._id));
}

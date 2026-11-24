import { resolveProjectProduct, type SavedProductMap } from './projectIdentity';
export type PlannerIdentity = { pid: number; lid?: string; vid?: string };

/** Preserve the document until the owner explicitly repairs unresolved saved pieces. */
export function unresolvedPlannerItems<T extends PlannerIdentity>(items: readonly T[], products: SavedProductMap) {
  return items.flatMap((item, index) => {
    const product = resolveProjectProduct(item, products);
    return !product || (item.lid && item.lid !== product.lid) ? [{ item, index }] : [];
  });
}

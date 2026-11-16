import type { HolmProduct } from './catalog';
export type PlannerIdentity = { pid: number; lid?: string };

/** Preserve the document until the owner explicitly repairs unresolved saved pieces. */
export function unresolvedPlannerItems<T extends PlannerIdentity>(items: readonly T[], products: ReadonlyMap<number, HolmProduct>) {
  return items.flatMap((item, index) => {
    const product = products.get(item.pid);
    return !product || (item.lid && item.lid !== product.lid) ? [{ item, index }] : [];
  });
}

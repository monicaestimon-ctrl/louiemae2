import { projectItemKey, resolveProjectProduct, type SavedProductIdentity, type SavedProductMap } from './projectIdentity';

/** Layout copies count separately; distinct source/options never collapse into one line. */
export function editorSelections(items: readonly (SavedProductIdentity & { hidden?: boolean })[], products: SavedProductMap) {
  const rows = new Map<string, SavedProductIdentity & { key: string; qty: number; hidden: boolean; product: ReturnType<typeof resolveProjectProduct> }>();
  for (const item of items) {
    const key = JSON.stringify([projectItemKey(item), !!item.hidden]);
    const existing = rows.get(key);
    if (existing) existing.qty++;
    else rows.set(key, { pid: item.pid, lid: item.lid, vid: item.vid, key, qty: 1, hidden: !!item.hidden, product: resolveProjectProduct(item, products) });
  }
  return [...rows.values()];
}

/** Synchronize layout copies by exact source/option, preserving the existing placements. */
export function reconcileEditorSelections(have: readonly SavedProductIdentity[], want: readonly SavedProductIdentity[]) {
  const remaining = [...want];
  const keep = new Set<number>();
  have.forEach((item, index) => {
    const match = remaining.findIndex(candidate => projectItemKey(candidate) === projectItemKey(item));
    if (match >= 0) { keep.add(index); remaining.splice(match, 1); }
  });
  return { keep, add: remaining };
}

/** Show the same supplier minimum/increment adjustment before and after adding to a project. */
export function editorOrderQuantity(quantity: number, product: { minimum: number; increment: number }) {
  return Math.max(product.minimum, product.minimum + Math.ceil((quantity - product.minimum) / product.increment) * product.increment);
}

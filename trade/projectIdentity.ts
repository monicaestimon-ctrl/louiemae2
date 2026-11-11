import type { HolmProduct } from './catalog';

export type SavedProductIdentity = { pid: number; lid?: string; vid?: string };

/** Distinct saved variants remain distinct lines even when they share a product and room. */
export function sameProjectSelection(a: SavedProductIdentity, b: SavedProductIdentity) {
  return a.pid === b.pid && (!a.lid || !b.lid || a.lid === b.lid) && a.vid === b.vid;
}

/** Encode persisted identity and room without concatenation collisions in React keys. */
export function projectItemKey(item: SavedProductIdentity & { zone?: string }) {
  return JSON.stringify([item.pid, item.lid ?? '', item.vid ?? '', item.zone ?? '']);
}

/** Restoring or undoing a line adds its quantity without creating duplicate variant/room keys. */
export function mergeProjectItem<T extends SavedProductIdentity & { qty: number; zone?: string }>(
  items: readonly T[], incoming: T
): T[] {
  const existing = items.find(item => sameProjectSelection(item, incoming) && item.zone === incoming.zone);
  return existing
    ? items.map(item => item === existing ? { ...item, lid: item.lid ?? incoming.lid, qty: item.qty + incoming.qty } : item)
    : [...items, incoming];
}

/** Saved source and variant identities must agree; never substitute a new default variant. */
export function resolveProjectProduct(
  item: SavedProductIdentity,
  products: ReadonlyMap<number, HolmProduct>
): HolmProduct | null {
  const product = products.get(item.pid);
  if (!product || (item.lid && item.lid !== product.lid)) return null;
  if (!item.vid || item.vid === product.vid) return product;
  const variant = product.variants?.find(option => option.id === item.vid);
  if (!variant) return null;
  return {
    ...product,
    vid: variant.id,
    price: variant.retail / 100,
    trade: variant.trade === null ? null : variant.trade / 100,
    minimum: variant.minimum,
    increment: variant.increment,
    img: variant.image ?? product.img,
    line: `${product.line} · ${variant.name}`,
    cutout: variant.image ? null : product.cutout,
  };
}

/** Keep unresolved records visible for repair while deriving prices only from current catalog rows. */
export function resolveProjectItems<T extends SavedProductIdentity>(
  items: readonly T[],
  products: ReadonlyMap<number, HolmProduct>
) {
  const resolved: (T & { p: HolmProduct })[] = [];
  const missing: T[] = [];
  for (const item of items) {
    const p = resolveProjectProduct(item, products);
    if (p) resolved.push({ ...item, p });
    else missing.push(item);
  }
  return { resolved, missing };
}

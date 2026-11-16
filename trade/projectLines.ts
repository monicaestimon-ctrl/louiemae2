import type { HolmProduct } from './catalog';
import { resolveProjectProduct, type SavedProductIdentity } from './projectIdentity';

/** Saved numeric IDs must resolve exactly; a missing piece can never become another product. */
export function projectLines(items: (SavedProductIdentity & { qty: number })[], products: ReadonlyMap<number, HolmProduct>) {
  const lines: { productId: string; variantId: string; packs: number }[] = [];
  const errors: string[] = [];
  for (const item of items) {
    const p = resolveProjectProduct(item, products);
    if (!p) { errors.push(`Saved item ${item.pid} is no longer available. Remove it or choose a replacement.`); continue; }
    if (!p.lid || !p.vid || p.oos || !Number.isSafeInteger(item.qty) || item.qty < p.minimum ||
      !Number.isSafeInteger(p.increment) || p.increment < 1 || (item.qty - p.minimum) % p.increment !== 0) {
      errors.push(`${p.name}: confirm availability and the required pack quantity.`); continue;
    }
    const existing = lines.find(l => l.productId === p.lid && l.variantId === p.vid);
    if (existing) existing.packs += item.qty;
    else lines.push({ productId: p.lid, variantId: p.vid, packs: item.qty });
  }
  if (lines.length > 100 || lines.some(l => l.packs > 10000)) errors.push('This project requires staff review because of its size.');
  return { lines, errors };
}

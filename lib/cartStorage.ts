import { MAX_ORDER_QUANTITY, publicQuantityRules } from './orderQuantity';
import type { Product, ProductVariant } from '../types';
import type { CartItem } from '../contexts/CartContext';

export const effectiveVariantId = (item: CartItem) =>
  item.selectedVariant?.id ?? item.product.variants?.[0]?.id;
export const cartItemKey = (item: CartItem) =>
  JSON.stringify([item.product.id, effectiveVariantId(item)]);
export const CART_STORAGE_KEY = 'louiemae_ashcroft_cart_v1';
export const validCartQuantity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= MAX_ORDER_QUANTITY;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const money = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000_000;
const image = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 2048 &&
  (/^https:\/\//.test(value) || /^\/(?![/\\])/.test(value));
const identity = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** A saved cart is display data only; prices, stock and selling rules still require server validation. */
export function savedCartItem(value: unknown): CartItem | null {
  const row = record(value),
    p = record(row?.product);
  if (
    !row ||
    !p ||
    !identity(p.id) ||
    !text(p.name, 300) ||
    !p.name ||
    !money(p.price) ||
    p.price < 0 ||
    !validCartQuantity(row.quantity) ||
    (p.fulfillmentProvider !== 'ashcroft' && p.fulfillmentProvider !== 'zuo')
  )
    return null;
  const decodeVariant = (value: unknown): ProductVariant | null => {
    const v = record(value);
    if (
      !v ||
      !text(v.id, 200) ||
      !v.id ||
      !text(v.name, 300) ||
      !money(v.priceAdjustment) ||
      (p.price as number) + v.priceAdjustment < 0
    )
      return null;
    const rules = record(v.quantityRules);
    const quantityRules = rules
      ? publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack)
      : undefined;
    return {
      ...(quantityRules ? { quantityRules } : {}),
      id: v.id as string,
      name: v.name as string,
      priceAdjustment: v.priceAdjustment,
      inStock: v.inStock === true,
      ...(image(v.image) ? { image: v.image } : {}),
    };
  };
  let variants: ProductVariant[] | undefined;
  if (p.variants !== undefined) {
    if (!Array.isArray(p.variants) || p.variants.length > 1000) return null;
    const decoded = p.variants.map(decodeVariant);
    if (decoded.some((v) => v === null)) return null;
    variants = decoded as ProductVariant[];
  }
  let selectedVariant: ProductVariant | undefined;
  if (row.selectedVariant !== undefined) {
    const decoded = decodeVariant(row.selectedVariant);
    if (!decoded) return null;
    selectedVariant = decoded;
  }
  const product: Product = {
    id: p.id,
    name: p.name as string,
    price: p.price,
    fulfillmentProvider: p.fulfillmentProvider,
    images: Array.isArray(p.images) ? p.images.filter(image).slice(0, 10) : [],
    description: '',
    category: text(p.category, 200) ? (p.category as string) : '',
    collection: text(p.collection, 100) ? (p.collection as string) : '',
    inStock: p.inStock === true,
    ...(variants ? { variants } : {}),
    ...(money(p.deliveryFee) && p.deliveryFee >= 0 ? { deliveryFee: p.deliveryFee } : {}),
  };
  return { product, quantity: row.quantity, ...(selectedVariant ? { selectedVariant } : {}) };
}
export function restoreCart(raw: string | null): { items: CartItem[]; recoveryNotice: string } {
  if (!raw) return { items: [], recoveryNotice: '' };
  const invalid = 'Some saved cart items could not be restored. Please add those items again.';
  try {
    if (raw.length > 256_000) throw new Error('Saved cart is too large');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('Invalid saved cart');
    const items: CartItem[] = [],
      seen = new Map<string, number>();
    for (const row of rows) {
      const item = savedCartItem(row);
      if (!item) continue;
      const key = cartItemKey(item);
      const existing = seen.get(key);
      if (existing !== undefined) {
        const combined = items[existing].quantity + item.quantity;
        if (validCartQuantity(combined))
          items[existing] = { ...items[existing], quantity: combined };
        continue;
      }
      seen.set(key, items.length);
      items.push(item);
    }
    return {
      items,
      recoveryNotice:
        items.length !== rows.length
          ? invalid
          : items.length > 30
            ? 'Your saved cart has more than 30 product options. Remove options until 30 remain to review checkout.'
            : '',
    };
  } catch {
    return { items: [], recoveryNotice: invalid };
  }
}

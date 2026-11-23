import { publicQuantityRules } from './orderQuantity.js';
import type { Product, ProductVariant } from '../types';
import { publicProductImage } from './productMetadata.js';

export const PRODUCT_BOOTSTRAP_TTL = 30_000;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Explicit public fields only. Supplier costs, trade prices and fulfillment mappings never serialize. */
export function publicProductSnapshot(value: unknown): Product | null {
  const row = record(value);
  if (!row) return null;
  const id = row._id ?? row.id;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || typeof row.name !== 'string' || typeof row.description !== 'string'
    || typeof row.category !== 'string' || typeof row.collection !== 'string' || !money(row.price) || row.price < 0
    || !Array.isArray(row.images) || row.images.length > 100 || !row.images.every(image => typeof image === 'string')) return null;
  let variants: ProductVariant[] | undefined;
  if (row.variants !== undefined) {
    if (!Array.isArray(row.variants) || row.variants.length > 1000) return null;
    variants = [];
    for (const value of row.variants) {
      const variant = record(value);
      if (!variant || typeof variant.id !== 'string' || typeof variant.name !== 'string' || !money(variant.priceAdjustment) || row.price + variant.priceAdjustment < 0) return null;
      const rules = record(variant.quantityRules);
      const quantityRules = rules ? publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack) : undefined;
      variants.push({ ...(quantityRules ? { quantityRules } : {}), id: variant.id, name: variant.name, priceAdjustment: variant.priceAdjustment, inStock: variant.inStock === true,
        ...(typeof variant.image === 'string' ? { image: publicProductImage(variant.image) } : {}) });
    }
  }
  return { id, name: row.name, description: row.description, category: row.category, collection: row.collection, price: row.price,
    images: row.images.map(image => publicProductImage(image as string)).filter(Boolean), inStock: row.inStock === true,
    ...(variants ? { variants } : {}),
    ...(row.checkoutMode === 'legacy' || row.checkoutMode === 'v2' ? { checkoutMode: row.checkoutMode } : {}),
    ...(row.fulfillmentProvider === 'ashcroft' || row.fulfillmentProvider === 'zuo' ? { fulfillmentProvider: row.fulfillmentProvider } : {}),
    ...(money(row.deliveryFee) && row.deliveryFee >= 0 ? { deliveryFee: row.deliveryFee } : {}) };
}

export function serializeProductBootstrap(value: unknown, generatedAt = Date.now()) {
  const product = publicProductSnapshot(value);
  if (!product) return '';
  const json = JSON.stringify({ schemaVersion: 1, generatedAt, product }).replace(/</g, '\\u003c');
  return json.length <= 256_000 ? json : '';
}

/** Only the freshly rendered, matching document can seed its initial client view. */
export function readProductBootstrap(id?: string | null) {
  const element = document.getElementById('lm-product-bootstrap');
  if (!id || element?.tagName !== 'SCRIPT' || element.getAttribute('type') !== 'application/json' || element.dataset.productId !== id || !element.textContent || element.textContent.length > 256_000) return null;
  try {
    const data = JSON.parse(element.textContent);
    const age = Date.now() - data.generatedAt;
    if (data.schemaVersion !== 1 || !Number.isFinite(data.generatedAt) || age < -5000 || age >= PRODUCT_BOOTSTRAP_TTL) return null;
    const product = publicProductSnapshot(data.product);
    return product?.id === id ? { product, expiresAt: data.generatedAt + PRODUCT_BOOTSTRAP_TTL } : null;
  } catch { return null; }
}

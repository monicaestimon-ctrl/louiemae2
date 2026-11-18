import { publicProductImage } from './productMetadata.js';
import { CATALOG_VERSION } from './catalogVersion.js';
export type KidsInitialPreview = {
  ready: true;
  version: number;
  products: {
    _id: string;
    name: string;
    price: number;
    images: string[];
    category: string;
    isNew?: boolean;
    variantCount: number;
  }[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
/** Bounded public display decoder. Never grants purchase authority or accepts supplier fields. */
export function kidsInitialPreview(value: unknown): KidsInitialPreview | undefined {
  if (
    !record(value) ||
    value.ready !== true ||
    value.version !== CATALOG_VERSION ||
    !Array.isArray(value.products) ||
    value.products.length > 8
  )
    return;
  const products: KidsInitialPreview['products'] = [];
  const ids = new Set<string>();
  for (const row of value.products) {
    if (
      !record(row) ||
      !bounded(row._id, 128) ||
      !/^[a-zA-Z0-9_-]+$/.test(row._id) ||
      ids.has(row._id) ||
      !bounded(row.name, 300) ||
      !bounded(row.category, 200) ||
      typeof row.price !== 'number' ||
      !Number.isFinite(row.price) ||
      row.price < 0 ||
      typeof row.variantCount !== 'number' ||
      !Number.isSafeInteger(row.variantCount) ||
      row.variantCount < 0 ||
      (row.isNew !== undefined && typeof row.isNew !== 'boolean') ||
      !Array.isArray(row.images) ||
      row.images.length > 1 ||
      !row.images.every((src: unknown) => typeof src === 'string' && src.length <= 2048)
    )
      return;
    ids.add(row._id);
    products.push({
      _id: row._id,
      name: row.name,
      price: row.price,
      images: row.images.filter((src: string) => src.length > 0 && publicProductImage(src) === src),
      category: row.category,
      variantCount: row.variantCount,
      ...(typeof row.isNew === 'boolean' ? { isNew: row.isNew } : {}),
    });
  }
  return { ready: true, version: CATALOG_VERSION, products };
}

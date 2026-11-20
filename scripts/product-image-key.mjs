import { createHash } from 'node:crypto';
export const PRODUCT_IMAGE_RECIPE = 'webp85-effort6-lossless-orientation-v2';
/** Immutable URLs bind the supplier original bytes and the exact encoding recipe. */
export function productImageBase(sourceHash, recipe) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || typeof recipe !== 'string' || !recipe.length) throw new Error('Invalid image provenance');
  return `/images/opt/products/${createHash('sha256').update(`${sourceHash}:${recipe}`).digest('hex').slice(0, 24)}`;
}

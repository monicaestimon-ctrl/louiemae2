import manifest from './imageManifest.json';
import productManifest from './productImageManifest.json';

type Entry = { base: string; widths: number[]; ratio: number };
const ENTRIES = manifest as Record<string, Entry>;
const PRODUCTS = productManifest as Record<string, Entry>;

export type ResponsiveImage = { src: string; srcSet?: string; sizes?: string };

/** Exact-source product renditions or known brand renditions; unknown uploads pass through. */
export function imageEntry(src?: string | null): Entry | undefined {
  if (!src) return undefined;
  if (Object.prototype.hasOwnProperty.call(PRODUCTS, src)) return PRODUCTS[src];
  const key = src.startsWith('https://louiemae.com/') ? src.slice('https://louiemae.com'.length) : src;
  if (Object.prototype.hasOwnProperty.call(ENTRIES, key)) return ENTRIES[key];
  const decoded = safeDecode(key);
  return Object.prototype.hasOwnProperty.call(ENTRIES, decoded) ? ENTRIES[decoded] : undefined;
}

/**
 * Uses prepared WebP srcsets only for known immutable image sources.
 * Unrecognized product photos, uploads and remote images pass through unchanged.
 */
export function responsiveImage(src: string | null | undefined, sizes = '100vw'): ResponsiveImage {
  const entry = imageEntry(src);
  if (!entry) return { src: src || '' };
  const srcSet = entry.widths.map((w) => `${entry.base}-${w}.webp ${w}w`).join(', ');
  const fallback = entry.widths.find((w) => w >= 960) ?? entry.widths[entry.widths.length - 1];
  return { src: `${entry.base}-${fallback}.webp`, srcSet, sizes };
}

function safeDecode(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

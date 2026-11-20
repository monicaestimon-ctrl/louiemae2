import manifest from './imageManifest.json' with { type: 'json' };
import productManifest from './productImageManifest.json' with { type: 'json' };
import editorialManifest from './editorialImageManifest.json' with { type: 'json' };

type Entry = { base: string; widths: number[]; ratio: number; avifBase?: string };
const ENTRIES = manifest as Record<string, Entry>;
const PRODUCTS = productManifest as Record<string, Entry>;
const EDITORIAL = editorialManifest as Record<string, Entry>;

export type ResponsiveImage = { src: string; srcSet?: string; sizes?: string };

/** Exact-source product renditions or known brand renditions; unknown uploads pass through. */
export function imageEntry(src?: string | null): Entry | undefined {
  if (!src) return undefined;
  if (Object.prototype.hasOwnProperty.call(PRODUCTS, src)) return PRODUCTS[src];
  if (Object.prototype.hasOwnProperty.call(EDITORIAL, src)) return EDITORIAL[src];
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

/** Optional prepared AVIF source; callers retain the ordinary image as fallback. */
export function responsiveAvifSource(src: string | null | undefined, sizes: string) {
  const entry = imageEntry(src);
  return entry?.avifBase ? {
    type: 'image/avif',
    srcSet: entry.widths.map(w => `${entry.avifBase}-${w}.avif ${w}w`).join(', '),
    sizes,
  } : undefined;
}

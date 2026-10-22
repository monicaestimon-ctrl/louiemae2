import manifest from './imageManifest.json';

type Entry = { base: string; widths: number[]; ratio: number };
const ENTRIES = manifest as Record<string, Entry>;

export type ResponsiveImage = { src: string; srcSet?: string; sizes?: string };

/** The optimized renditions for a brand image, or undefined for anything else. */
export function imageEntry(src?: string | null): Entry | undefined {
  if (!src) return undefined;
  const key = src.startsWith('https://louiemae.com/') ? src.slice('https://louiemae.com'.length) : src;
  return ENTRIES[key] ?? ENTRIES[safeDecode(key)];
}

/**
 * Turns a brand image path into WebP srcset props sized for where it renders.
 * Product photos, uploads and remote images pass through unchanged.
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

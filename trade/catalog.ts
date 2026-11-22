// Maps live House listings onto the product shape the site was designed around.
// The 24 curated pieces keep their numeric ids (1–24) so hero films, room scenes and
// cutouts stay attached to the right product; every other listing gets a stable id
// derived from its database id.

export type LiveVariant = {
  id: string;
  name: string;
  image?: string;
  minimum: number;
  increment: number;
  retail: number | null;
  trade: number | null;
};
import type { ProductImageMedia } from '../types';
import { CURATED_SOURCES } from './curatedSources';
import { holmCatalogFacets } from '../lib/holmCatalogFacets';
import { holmLegacyId } from '../lib/holmProductIdentity';
import { parseDims, type DimsCm } from '../lib/holmDims';

export type LiveAssets = {
  dimsCm: DimsCm | null;
  dimsSource: string | null;
  cutoutUrl: string | null;
  cutoutAspect: number | null;
  modelUrl: string | null;
  modelLowUrl: string | null;
  hangs: boolean | null;
  mountHeightCm: number | null;
};
export type LiveItem = {
  checkoutMode?: 'v2' | 'quote';
  imageMedia?: ProductImageMedia[];
  id: string;
  name: string;
  description: string;
  category: string;
  images: string[];
  facts: string;
  inStock: boolean;
  variants: LiveVariant[];
  assets?: LiveAssets;
};
export type HolmProduct = {
  checkoutMode?: 'v2' | 'quote';
  imageMedia?: ProductImageMedia[];
  id: number;
  lid: string; // commerceProducts id
  vid: string; // default variant
  variants: LiveVariant[];
  name: string;
  line: string;
  full: string;
  type: string;
  mat: string;
  tone: string;
  price: number; // retail, dollars
  trade: number | null; // trade, dollars (verified accounts only)
  seats: number;
  oos: boolean;
  note: string;
  facts: string;
  img: string;
  imgs: string[];
  ar: number;
  sku: string;
  likes: number;
  widthCm: number | null;
  dimsCm: DimsCm | null; // W × D × H in cm; null means "Measurements needed"
  dimsSource: string | null; // parsed, manual, supplier, or estimate for a curated piece
  cutout: string | null; // a seamless transparent cutout, when one exists
  cutAR: number | null; // the cutout's width / height
  model: string | null; // an approved GLB at real-world scale
  modelLow: string | null;
  hangs: boolean; // pendants and wall lights hang from the ceiling or wall
  mountCm: number | null;
  minimum: number;
  increment: number;
};

// The curated pieces ship with studio cutouts in public/trade/c/ (each cutout's pixel size) and
// measured widths. Their asset rows override these once they carry approved cutouts and dimensions.
const CURATED_CUT: Record<number, [number, number]> = {1:[1031,308],2:[1084,368],3:[1057,352],4:[1100,379],5:[1100,375],6:[1100,370],7:[1100,552],8:[995,777],9:[941,673],10:[1100,551],11:[383,917],12:[944,889],13:[1100,726],14:[1100,520],15:[1046,641],16:[995,637],17:[1100,478],18:[1100,577],19:[1100,521],20:[1100,504],21:[1100,731],22:[1100,540],23:[956,426],24:[1100,688]};
// Curated pieces listed here ship a TRELLIS image-to-3D model in public/trade/m/ (full and low detail,
// Meshopt geometry and WebP textures, width on X, front facing +Z; see scripts/trellis/). The planner
// scales it to W × D × H. An uploaded model on the piece's asset row takes its place.
const CURATED_MODEL = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24]);
const CURATED_W: Record<number, number> = {1:245,2:235,3:250,4:240,5:300,6:300,7:290,8:46,9:80,10:88,11:64,12:100,13:150,14:85,15:70,16:80,17:270,18:135,19:130,20:150,21:150,22:122,23:110,24:125};
// Typical depth by type, for a curated piece whose listing gives only a width. Zero means as deep as wide.
const TYPE_DEPTH: Record<string, number> = { sofa: 95, sectional: 170, bench: 45, ottoman: 0, lighting: 0, stool: 45, chair: 75, table: 90 };
const HANGS = /pendant|semi-flush|flush mount|chandelier|ceiling|sconce|wall light/i;

/** A curated piece without listed dimensions: measured width, height from its cutout, depth by type. */
function curatedEstimate(id: number, type: string): DimsCm | null {
  const w = CURATED_W[id], c = CURATED_CUT[id];
  if (!w || !c) return null;
  return { w, d: TYPE_DEPTH[type] || w, h: Math.round((w * c[1]) / c[0]) };
}

/** Overall width in cm from "Overall dimensions (W × D × H): 92.5 × 39 × 26.4 in". */
function widthOf(facts: string) {
  const m = facts.match(/(\d+(?:\.\d+)?)\s*[×x]\s*\d+(?:\.\d+)?(?:\s*[×x]\s*\d+(?:\.\d+)?)?\s*(in|cm)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round(m[2].toLowerCase() === 'cm' ? n : n * 2.54);
}

export function liveProducts(items: LiveItem[]): HolmProduct[] {
  const used = new Map<number, string>();
  const out: HolmProduct[] = [];
  for (const item of items) {
    const facets = holmCatalogFacets(item, CURATED_SOURCES[item.id]);
    const { full, type } = facets;
    // Identity must not depend on page order, availability or a marketing rename.
    const best = facets.curated;
    const v0 = item.variants[0];
    if (!v0) continue;
    const id = holmLegacyId(item.id);
    if (used.has(id)) throw new Error('Catalog product identities require review.');
    used.set(id, item.id);
    const text = `${full} ${item.facts}`;
    const a = item.assets;
    const parsed = a?.dimsCm ?? parseDims(item.facts);
    const dims = parsed ?? (best ? curatedEstimate(id, type) : null);
    const curatedCut = best && CURATED_CUT[id];
    const curatedModel = !!best && CURATED_MODEL.has(id);
    out.push({
      id,
      lid: item.id,
      vid: v0.id,
      variants: item.variants,
      name: facets.name,
      line: facets.line,
      full,
      type,
      mat: facets.mat,
      tone: facets.tone,
      // Null is transported explicitly; NaN keeps missing comparisons out of arithmetic totals.
      price: v0.retail === null ? Number.NaN : v0.retail / 100,
      trade: v0.trade === null ? null : v0.trade / 100,
      seats: facets.seats,
      oos: !item.inStock,
      note: item.description,
      facts: item.facts,
      img: v0.image || item.images[0] || '',
      imgs: item.images,
      imageMedia: item.imageMedia,
      checkoutMode: item.checkoutMode,
      ar: 1,
      sku: `HL-${String(id).padStart(3, '0')}`,
      likes: 0,
      widthCm: dims?.w ?? widthOf(item.facts),
      dimsCm: dims,
      dimsSource: parsed ? (a?.dimsSource ?? 'parsed') : dims ? 'estimate' : null,
      cutout: a?.cutoutUrl ?? (curatedCut ? `c/${id}.webp` : null),
      cutAR: a?.cutoutUrl ? a.cutoutAspect : curatedCut ? curatedCut[0] / curatedCut[1] : null,
      model: a?.modelUrl ?? (curatedModel ? `/trade/m/${id}.glb` : null),
      modelLow: a?.modelUrl ? (a.modelLowUrl ?? null) : curatedModel ? `/trade/m/${id}-low.glb` : null,
      hangs: a?.hangs ?? (type === 'lighting' && HANGS.test(text)),
      mountCm: a?.mountHeightCm ?? null,
      minimum: v0.minimum,
      increment: v0.increment,
    });
  }
  // Curated pieces first, in their designed order; the rest by name.
  return out.sort((a, b) => (a.id < 100 ? a.id : 1e9) - (b.id < 100 ? b.id : 1e9) || a.full.localeCompare(b.full));
}

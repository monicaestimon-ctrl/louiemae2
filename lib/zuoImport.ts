// Zuo neutral staging package → normalized records (spec S09, v2 §3, §22). Pure: parsing,
// validation, cohort classification and holds. The Convex side (convex/zuoImport.ts) diffs and
// writes. Field names accept the aliases below; verify them against the real package's header
// row before the first real dry run and add aliases here rather than renaming source columns.
import { stableStringify } from './canonicalJson.js';
export { stableStringify } from './canonicalJson.js';
import { parseDecimal, toDecimalString, mul, rat, toMinor } from './decimal';

export const ZUO_COHORTS = ['approved_306', 'map_135', 'original_296', 'reconciled_66', 'unpriced_62'] as const;
export type ZuoCohort = (typeof ZUO_COHORTS)[number] | 'other';

/** Package counts the reconciled 2026-11-06 snapshot must reproduce exactly (v2 §3). */
export const EXPECTED_ZUO_COUNTS = {
  total: 865,
  modeledPrices: 803,
  approved_306: 306,
  map_135: 135,
  original_296: 296,
  reconciled_66: 66,
  unpriced_62: 62,
  excluded: 226,
  nonexcludedDrafts: 639,
} as const;

/** SKUs with named treatment in v2 §3. */
export const NAMED_SKU_HOLDS: Record<string, { hold?: 'METHOD_CHANGED' | 'SOURCE_ABSENT'; availability?: 'out_of_stock'; note: string }> = {
  '110799': { hold: 'METHOD_CHANGED', note: 'Supplier method changed from Ground to LTL; earlier delivery assumptions are not reused.' },
  '101771': { hold: 'SOURCE_ABSENT', note: 'Absent from the latest Install source: a verification hold, not discontinuation.' },
  '111300': { availability: 'out_of_stock', note: 'Authenticated check showed out of stock; refresh stock before activation.' },
  '111303': { availability: 'out_of_stock', note: 'Authenticated check showed out of stock; refresh stock before activation.' },
  '111311': { availability: 'out_of_stock', note: 'Authenticated check showed out of stock; refresh stock before activation.' },
};

export type ZuoCarton = { cartonsPerPack: number; lengthMm: number; widthMm: number; heightMm: number; grossWeightG: number; netWeightG?: number; method: 'ground' | 'ltl' | 'unknown' };

export type ZuoRecord = {
  sku: string;
  packId: string;
  supplierName: string;
  louieMaeName?: string;
  navCategory: string;
  material?: string;
  color?: string;
  size?: string;
  sizeClass: 'SMALL' | 'MEDIUM' | 'LARGE' | 'OVERSIZE' | 'LTL' | 'UNKNOWN';
  piecesPerPack: number;
  minimumPacks: number;
  incrementPacks: number;
  /** Wholesale per piece as an exact decimal string in USD, or null when unknown. */
  wholesalePiece: string | null;
  costConfidence: 'confirmed' | 'corroborated' | 'unverified';
  /** MAP per selling pack, exact, or null. */
  mapPack: string | null;
  mapSource: 'explicit_sku' | 'policy_derived' | 'none';
  mapApplicability: 'applies' | 'not_applicable' | 'unknown';
  cartons: ZuoCarton[];
  stock: 'in_stock' | 'out_of_stock' | 'discontinued' | 'unknown';
  excluded: boolean;
  cohort: ZuoCohort;
  /** Owner-approved sellable-pack prices, exact as imported (approved cohort). */
  approvedRetailPack: string | null;
  approvedTradePack: string | null;
  policyKey?: string;
  images: string[];
  observedAt: number;
  sourceFile: string;
};

export type ParsedRow = { row: number; raw: Record<string, unknown> };
export type RowIssue = { row: number; sku: string; reasons: string[] };

// ---------------- parsing ----------------
export function parseJsonPackage(text: string): ParsedRow[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : Array.isArray(data?.products) ? data.products : null;
  if (!list) throw new Error('JSON package must be an array or have a "records" or "products" array');
  return list.map((raw: Record<string, unknown>, i: number) => ({ row: i + 1, raw }));
}

/** RFC 4180 CSV (quoted fields, doubled quotes, embedded newlines). */
export function parseCsv(text: string): ParsedRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells, i) => ({ row: i + 2, raw: Object.fromEntries(keys.map((k, j) => [k, cells[j] ?? ''])) }));
}

const ALIASES: Record<string, string[]> = {
  sku: ['sku', 'supplierSku', 'supplier_sku', 'SKU', 'item'],
  packId: ['packId', 'pack_id', 'pack'],
  supplierName: ['supplierName', 'supplier_name', 'name', 'productName', 'product_name'],
  louieMaeName: ['louieMaeName', 'louie_mae_name', 'renamedName', 'listingName'],
  navCategory: ['category', 'navCategory', 'nav_category', 'productType'],
  material: ['material'],
  color: ['color', 'colour', 'finish'],
  size: ['size'],
  sizeClass: ['sizeClass', 'size_class', 'deliverySize', 'allowanceSize'],
  piecesPerPack: ['piecesPerPack', 'pieces_per_pack', 'packQty', 'pack_quantity', 'unitsPerPack'],
  minimumPacks: ['minimum', 'orderMinimum', 'minimumPacks'],
  incrementPacks: ['increment', 'orderIncrement', 'incrementPacks'],
  wholesale: ['wholesale', 'wholesalePiece', 'wholesale_per_piece', 'cost', 'dealerCost'],
  wholesaleBasis: ['wholesaleBasis', 'wholesale_basis', 'costBasis'],
  costConfidence: ['costConfidence', 'cost_status', 'costStatus'],
  currency: ['currency'],
  map: ['map', 'mapPack', 'MAP', 'map_price'],
  mapBasis: ['mapBasis', 'map_basis', 'mapUnitBasis'],
  mapSource: ['mapSource', 'map_source'],
  mapApplicability: ['mapApplicability', 'map_applicability'],
  stock: ['stock', 'availability', 'stockStatus'],
  excluded: ['excluded', 'isExcluded'],
  exclusionReason: ['exclusionReason', 'exclusion_reason'],
  cohort: ['cohort', 'pricingCohort', 'pricing_cohort'],
  approvedRetail: ['approvedRetailPack', 'approvedRetail', 'approved_retail', 'retailPack', 'retail'],
  approvedTrade: ['approvedTradePack', 'approvedTrade', 'approved_trade', 'tradePack', 'trade'],
  policyKey: ['policyKey', 'policy', 'marginPolicy'],
  images: ['images', 'imageUrls', 'image_urls'],
  cartons: ['cartons'],
  method: ['method', 'shippingMethod', 'supplierMethod'],
  observedAt: ['observedAt', 'observed_at', 'verifiedAt'],
};

function pick(raw: Record<string, unknown>, field: string): unknown {
  for (const k of ALIASES[field] ?? [field]) if (raw[k] !== undefined && raw[k] !== '') return raw[k];
  return undefined;
}
const text = (x: unknown) => (x === undefined || x === null ? '' : String(x).trim());
const MONEY = /^\d+(\.\d+)?$/;
const IN_TO_MM = (inches: string) => toMinor(mul(parseDecimal(inches), rat(254, 10)), 'half_up');
const LB_TO_G = (lb: string) => toMinor(mul(parseDecimal(lb), rat(45_359_237, 100_000)), 'half_up');

function parseCartons(raw: Record<string, unknown>, issues: string[]): ZuoCarton[] {
  let list: Record<string, unknown>[] = [];
  const c = pick(raw, 'cartons');
  if (Array.isArray(c)) list = c as Record<string, unknown>[];
  else if (typeof c === 'string' && c.trim().startsWith('[')) list = JSON.parse(c);
  else
    for (let i = 1; i <= 12; i++) {
      const l = raw[`carton${i}_length_in`] ?? raw[`carton${i}_length_mm`];
      if (l === undefined || l === '') break;
      list.push({ lengthIn: raw[`carton${i}_length_in`], widthIn: raw[`carton${i}_width_in`], heightIn: raw[`carton${i}_height_in`], weightLb: raw[`carton${i}_weight_lb`], lengthMm: raw[`carton${i}_length_mm`], widthMm: raw[`carton${i}_width_mm`], heightMm: raw[`carton${i}_height_mm`], grossWeightG: raw[`carton${i}_weight_g`], count: raw[`carton${i}_count`] });
    }
  const method = (text(pick(raw, 'method')).toLowerCase() || 'unknown') as ZuoCarton['method'];
  return list.flatMap((x, i) => {
    const mm = (k: 'length' | 'width' | 'height') => {
      const m = text(x[`${k}Mm`]);
      const inch = text(x[`${k}In`]);
      if (MONEY.test(m)) return Number(m);
      if (MONEY.test(inch)) return IN_TO_MM(inch);
      return NaN;
    };
    const g = MONEY.test(text(x.grossWeightG)) ? Number(text(x.grossWeightG)) : MONEY.test(text(x.weightLb)) ? LB_TO_G(text(x.weightLb)) : NaN;
    const carton = { cartonsPerPack: Number(text(x.count) || 1), lengthMm: mm('length'), widthMm: mm('width'), heightMm: mm('height'), grossWeightG: g, method: ['ground', 'ltl'].includes(method) ? method : 'unknown' } as ZuoCarton;
    if (![carton.cartonsPerPack, carton.lengthMm, carton.widthMm, carton.heightMm, carton.grossWeightG].every((n) => Number.isFinite(n) && n > 0)) {
      issues.push(`carton ${i + 1} has missing or non-positive dimensions or weight`);
      return [];
    }
    return [carton];
  });
}

/** Normalizes one row. Unknown values become null (and later a hold); invalid values are reported. */
export function normalizeRow(p: ParsedRow, sourceFile: string, defaultObservedAt: number): { record?: ZuoRecord; reasons: string[]; holdReasons: string[] } {
  const r = p.raw;
  const reasons: string[] = [];
  const holdReasons: string[] = [];
  const sku = text(pick(r, 'sku'));
  if (!sku) reasons.push('missing supplier SKU');
  const currency = text(pick(r, 'currency')).toUpperCase() || 'USD';
  if (currency !== 'USD') reasons.push(`unsupported currency ${currency}`);
  const intField = (field: string, dflt: number) => {
    const t = text(pick(r, field));
    if (!t) return dflt;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1) {
      reasons.push(`${field} must be a whole number of at least 1`);
      return dflt;
    }
    return n;
  };
  const piecesPerPack = intField('piecesPerPack', 1);
  const money = (field: string) => {
    const t = text(pick(r, field)).replace(/^\$/, '').replace(/,/g, '');
    if (!t) return null;
    if (t.startsWith('-')) {
      reasons.push(`${field} is negative`);
      return null;
    }
    if (!MONEY.test(t)) {
      reasons.push(`${field} is not a number`);
      return null;
    }
    return t;
  };
  let wholesale = money('wholesale');
  const basis = text(pick(r, 'wholesaleBasis')).toLowerCase() || 'piece';
  if (!['piece', 'pack'].includes(basis)) reasons.push(`inconsistent wholesale unit basis "${basis}"`);
  if (wholesale && basis === 'pack') wholesale = toDecimalString(mul(parseDecimal(wholesale), rat(1, piecesPerPack)), 6);
  if (wholesale === null) holdReasons.push('COST_MISSING');
  let mapPack = money('map');
  const mapBasis = text(pick(r, 'mapBasis')).toLowerCase() || 'pack';
  if (!['piece', 'pack'].includes(mapBasis)) reasons.push(`inconsistent MAP unit basis "${mapBasis}"`);
  if (mapPack && mapBasis === 'piece') mapPack = toDecimalString(mul(parseDecimal(mapPack), rat(piecesPerPack)), 6);
  const mapSourceRaw = text(pick(r, 'mapSource')).toLowerCase();
  const mapSource: ZuoRecord['mapSource'] = mapSourceRaw.includes('policy') ? 'policy_derived' : mapSourceRaw.includes('explicit') || mapSourceRaw === 'sku' ? 'explicit_sku' : mapPack ? 'explicit_sku' : 'none';
  const applicRaw = text(pick(r, 'mapApplicability')).toLowerCase();
  const mapApplicability: ZuoRecord['mapApplicability'] = applicRaw === 'applies' || applicRaw === 'yes' ? 'applies' : applicRaw === 'not_applicable' || applicRaw === 'no' ? 'not_applicable' : mapPack ? 'applies' : 'unknown';
  if (mapApplicability === 'applies' && mapPack !== null && Number(mapPack) === 0) holdReasons.push('MAP_ZERO');
  if (mapSource === 'policy_derived') holdReasons.push('MAP_POLICY_DERIVED');
  if (mapApplicability === 'unknown') holdReasons.push('MAP_MISSING');
  const cartonIssues: string[] = [];
  let cartons: ZuoCarton[] = [];
  try {
    cartons = parseCartons(r, cartonIssues);
  } catch {
    reasons.push('cartons are not valid JSON');
  }
  if (cartonIssues.length || !cartons.length) holdReasons.push('CARTON_MISSING');
  const stockRaw = text(pick(r, 'stock')).toLowerCase().replace(/\s+/g, '_');
  const exclusion = text(pick(r, 'exclusionReason')).toLowerCase();
  const excluded = ['true', '1', 'yes'].includes(text(pick(r, 'excluded')).toLowerCase());
  let stock: ZuoRecord['stock'] = ['in_stock', 'out_of_stock', 'discontinued'].includes(stockRaw) ? (stockRaw as ZuoRecord['stock']) : 'unknown';
  if (excluded && exclusion.includes('discontinu')) stock = 'discontinued';
  else if (excluded && exclusion.includes('stock')) stock = 'out_of_stock';
  const cohortRaw = text(pick(r, 'cohort')).toLowerCase();
  const cohort = (ZUO_COHORTS as readonly string[]).find((c) => c === cohortRaw || c.split('_')[0] === cohortRaw) as ZuoCohort | undefined;
  if (!cohort) holdReasons.push('MANUAL');
  if (cohort === 'map_135') holdReasons.push('MAP_FLOOR_UNAPPROVED');
  const sizeRaw = text(pick(r, 'sizeClass')).toUpperCase();
  const sizeClass = (['SMALL', 'MEDIUM', 'LARGE', 'OVERSIZE', 'LTL'].includes(sizeRaw) ? sizeRaw : 'UNKNOWN') as ZuoRecord['sizeClass'];
  if (sizeClass === 'UNKNOWN') holdReasons.push('DELIVERY_UNSUPPORTED');
  const imgs = pick(r, 'images');
  const images = (Array.isArray(imgs) ? imgs.map(String) : text(imgs).split(/[\s|;]+/)).filter((u) => /^https?:\/\//.test(u));
  holdReasons.push('MEDIA_MISSING'); // URL presence is not proof of usable media or rights (v2 §3)
  const conf = text(pick(r, 'costConfidence')).toLowerCase();
  const named = NAMED_SKU_HOLDS[sku];
  if (named?.hold) holdReasons.push(named.hold);
  if (named?.availability) stock = named.availability;
  const observedRaw = text(pick(r, 'observedAt'));
  const observedAt = observedRaw ? Date.parse(observedRaw) : defaultObservedAt;
  if (reasons.length) return { reasons, holdReasons };
  return {
    reasons,
    holdReasons: [...new Set(holdReasons)],
    record: {
      sku,
      packId: text(pick(r, 'packId')) || '1',
      supplierName: text(pick(r, 'supplierName')) || sku,
      ...(text(pick(r, 'louieMaeName')) ? { louieMaeName: text(pick(r, 'louieMaeName')) } : {}),
      navCategory: text(pick(r, 'navCategory')),
      ...(text(pick(r, 'material')) ? { material: text(pick(r, 'material')) } : {}),
      ...(text(pick(r, 'color')) ? { color: text(pick(r, 'color')) } : {}),
      ...(text(pick(r, 'size')) ? { size: text(pick(r, 'size')) } : {}),
      sizeClass,
      piecesPerPack,
      minimumPacks: intField('minimumPacks', 1),
      incrementPacks: intField('incrementPacks', 1),
      wholesalePiece: wholesale,
      costConfidence: conf.includes('confirm') ? 'confirmed' : conf.includes('corrobor') ? 'corroborated' : 'unverified',
      mapPack,
      mapSource,
      mapApplicability,
      cartons,
      stock,
      excluded,
      cohort: cohort ?? 'other',
      approvedRetailPack: money('approvedRetail'),
      approvedTradePack: money('approvedTrade'),
      ...(text(pick(r, 'policyKey')) ? { policyKey: text(pick(r, 'policyKey')) } : {}),
      images,
      observedAt: Number.isFinite(observedAt) ? observedAt : defaultObservedAt,
      sourceFile,
    },
  };
}

/** Normalizes a whole package; rejects duplicate (sku, packId) keys inside the batch. */
export function normalizePackage(rows: ParsedRow[], sourceFile: string, observedAt: number) {
  const records: { record: ZuoRecord; holdReasons: string[] }[] = [];
  const rejected: RowIssue[] = [];
  const seen = new Map<string, number>();
  for (const p of rows) {
    const n = normalizeRow(p, sourceFile, observedAt);
    const sku = text(pick(p.raw, 'sku'));
    if (!n.record) {
      rejected.push({ row: p.row, sku, reasons: n.reasons });
      continue;
    }
    const key = `${n.record.sku}:${n.record.packId}`;
    if (seen.has(key)) {
      rejected.push({ row: p.row, sku, reasons: [`duplicate supplier key ${key} (first at row ${seen.get(key)})`] });
      continue;
    }
    seen.set(key, p.row);
    records.push({ record: n.record, holdReasons: n.holdReasons });
  }
  return { records, rejected };
}

/** Cohort counts for the package-level check against EXPECTED_ZUO_COUNTS. */
export function cohortCounts(records: readonly ZuoRecord[]) {
  const c: Record<string, number> = { total: records.length, excluded: 0, nonexcludedDrafts: 0, modeledPrices: 0 };
  for (const r of records) {
    c[r.cohort] = (c[r.cohort] ?? 0) + 1;
    if (r.excluded) c.excluded++;
    else c.nonexcludedDrafts++;
    if (r.cohort !== 'unpriced_62') c.modeledPrices++;
  }
  return c;
}

export function countMismatches(counts: Record<string, number>, expected: Record<string, number> = EXPECTED_ZUO_COUNTS) {
  return Object.entries(expected)
    .filter(([k, n]) => (counts[k] ?? 0) !== n)
    .map(([k, n]) => `${k}: expected ${n}, got ${counts[k] ?? 0}`);
}

/** Stable identity key and a content fingerprint used for unchanged/updated diffs. */
export const identityKey = (r: Pick<ZuoRecord, 'sku' | 'packId'>) => `${r.sku}:${r.packId}`;
export function fingerprint(r: ZuoRecord): string {
  const { observedAt: _o, sourceFile: _s, ...rest } = r;
  void _o;
  void _s;
  return stableStringify(rest);
}

import { normalizeRow, type ZuoCohort } from './zuoImport';
import { validateZuoStagingRow, type ZuoStagingRow } from './zuoStaging';
import { dollarsToMinor, mul, parseDecimal, rat, toMinor } from './decimal';

const cohorts: Record<string, ZuoCohort> = {
  APPROVED_5_PERCENT: 'approved_306',
  ORIGINAL_20_PERCENT_MODEL: 'original_296',
  MAP_BASED_10_PERCENT_TRADE: 'map_135',
  RECONCILED_20_PERCENT_MODEL: 'reconciled_66',
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** This is a merchandise allowance class, not a carrier/service classification. */
export function stagedAllowanceClass(evidence: Record<string, unknown>) {
  const allowance = evidence.deliveryAllowanceEach;
  if (typeof allowance !== 'number' || !Number.isFinite(allowance)) return null;
  const classes = { 15: 'SMALL', 25: 'MEDIUM', 40: 'LARGE', 60: 'OVERSIZE', 100: 'LTL' } as const;
  const sizeClass = classes[allowance as keyof typeof classes];
  return sizeClass ? { sizeClass, allowanceMinor: allowance * 100 } : null;
}

/** Convert preserved source evidence, never a sample/template product, into held catalog rows. */
export function stagedCatalogRecord(row: ZuoStagingRow, sourceFile: string, observedAt: number) {
  validateZuoStagingRow(row);
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0)
    throw new Error('A frozen source observation timestamp is required.');
  const evidence = object(JSON.parse(row.sourceEvidence));
  const packaging = object(JSON.parse(row.draft.packaging));
  const fresh = object(evidence.freshObservation);
  const cohort =
    typeof evidence.pricingRegime === 'string' ? cohorts[evidence.pricingRegime] : undefined;
  if (!cohort) throw new Error(`Unknown approved pricing cohort: ${row.sku}`);
  if (typeof evidence.originalSupplierName !== 'string' || !evidence.originalSupplierName.trim())
    throw new Error(`Missing original supplier name: ${row.sku}`);
  if (packaging.unitsPerSellUnit !== row.pack)
    throw new Error(`Packaging unit basis differs: ${row.sku}`);
  const variant = row.draft.variants[0];
  const currentCostMatches = positive(fresh.currentCostEach) &&
    toMinor(mul(parseDecimal(String(fresh.currentCostEach)), rat(row.pack * 100)), 'half_up') === dollarsToMinor(String(variant.cost));
  const corroboratedCost = fresh.freshLocalCandidate === true && Array.isArray(fresh.blockers) && fresh.blockers.length === 0 &&
    Number.isSafeInteger(fresh.currentInstallRow) && Number(fresh.currentInstallRow) > 0 && fresh.currentPack === row.pack && currentCostMatches && !row.excluded;
  const additional = [
    'MANUAL',
    'MEDIA_RIGHTS',
    'COMMISSION_UNQUALIFIED',
    'MAPPING_MISSING',
    'DELIVERY_UNSUPPORTED',
    ...(!corroboratedCost ? ['COST_STALE'] : []),
  ];
  const method =
    fresh.currentShip === 'Ground' || fresh.currentShip === 'LTL'
      ? fresh.currentShip
      : packaging.shippingMethod;
  if (fresh.currentShip && fresh.currentShip !== packaging.shippingMethod)
    additional.push('METHOD_CHANGED');
  if (!fresh.currentInstallRow) additional.push('SOURCE_ABSENT');
  if (
    fresh.currentPack !== row.pack ||
    (positive(fresh.currentCostEach) && !currentCostMatches)
  )
    additional.push('COST_CONFLICT');
  // Original exclusions remain authoritative even if a later feed reports restocked.
  const discontinued =
    row.exclusionReasons.some((s) => /discontinu/i.test(s)) ||
    fresh.currentLifecycle === 'DISCONTINUED';
  const stock = discontinued
    ? 'discontinued'
    : row.excluded || fresh.currentAvailability === 'OUT_OF_STOCK'
      ? 'out_of_stock'
      : fresh.currentAvailability === 'IN_STOCK'
        ? 'in_stock'
        : 'unknown';
  // Feed quantities have no confirmed physical-unit basis in this packet.
  additional.push('STOCK_UNVERIFIED');
  // Carrier length is the longest side, regardless of the supplier's axis naming.
  // Use the current supplier row; older packaging remains preserved as evidence only.
  const rawCartons = Number(fresh.currentInstallRow) > 0 && fresh.currentPack === row.pack && Array.isArray(fresh.currentCartons) ? fresh.currentCartons : [];
  const cartons = rawCartons.flatMap((value) => {
    const c = object(value),
      dims = c.dims;
    if (
      !Array.isArray(dims) ||
      dims.length !== 3 ||
      !dims.every(positive) ||
      !positive(c.weight)
    ) {
      additional.push('CARTON_MISSING');
      return [];
    }
    const sides = [...dims].sort((a, b) => b - a);
    return [
      {
        count: 1,
        widthIn: String(sides[1]),
        lengthIn: String(sides[0]),
        heightIn: String(sides[2]),
        weightLb: String(c.weight),
      },
    ];
  });
  const mapEach = positive(fresh.currentMapEach) ? fresh.currentMapEach : null;
  const normalized = normalizeRow(
    {
      row: 1,
      raw: {
        sku: row.sku,
        packId: '1',
        supplierName: evidence.originalSupplierName,
        louieMaeName: row.draft.name,
      louieMaeVariantName: variant.name,
        navCategory: row.draft.category,
        piecesPerPack: row.pack,
        minimumPacks: variant.minimum,
        incrementPacks: variant.increment,
      wholesale: String(corroboratedCost ? fresh.currentCostEach : variant.cost),
      wholesaleBasis: corroboratedCost ? 'piece' : 'pack',
      costConfidence: corroboratedCost ? 'corroborated' : 'unverified',
        map: mapEach === null ? '' : String(mapEach),
        mapBasis: 'piece',
        mapSource: mapEach === null ? 'none' : 'explicit_sku',
        mapApplicability: mapEach === null ? 'unknown' : 'applies',
        cartons,
        method,
        sizeClass: stagedAllowanceClass(evidence)?.sizeClass ?? (method === 'LTL' ? 'LTL' : 'UNKNOWN'),
        stock,
        excluded: row.excluded,
        cohort,
        approvedRetailPack: (variant.retail / 100).toFixed(2),
        approvedTradePack: (variant.commercial / 100).toFixed(2),
        images: row.draft.images,
        observedAt: new Date(observedAt).toISOString(),
      },
    },
    sourceFile,
    observedAt
  );
  if (!normalized.record || normalized.reasons.length)
    throw new Error(`Invalid staged conversion ${row.sku}: ${normalized.reasons.join('; ')}`);
  normalized.record.stock = stock; // Current preserved evidence supersedes older hardcoded SKU stock hints.
  return {
    record: normalized.record,
    holdReasons: [...new Set([...normalized.holdReasons, ...additional, ...row.holdReasons])],
  };
}

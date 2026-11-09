// Source freshness, conflicts and availability (spec S10, v2 §6). Pure: given a variant's
// observations and the supplier's freshness policy, decide which holds apply. An old timestamp
// never overrides a known expiry or conflict, and missing data is never treated as availability
// or discontinuation.
import type { FreshnessPolicy } from './config';
import { cmp, parseDecimal } from './decimal';

export type Availability = 'in_stock' | 'out_of_stock' | 'discontinued' | 'preorder_approved' | 'unknown';
export type Observation = {
  field: string;
  unit?: string;
  extractedValue: string;
  observedAt: number;
  effectiveFrom?: number;
  effectiveTo?: number;
  confidence: 'confirmed' | 'corroborated' | 'policy_derived' | 'unverified' | 'conflict';
};
export type CostView = {
  wholesaleMinor: number | null;
  mapMinor: number | null;
  mapSource: 'explicit_sku' | 'policy_derived' | 'none';
  mapApplicability: 'applies' | 'not_applicable' | 'unknown';
  mapUnitBasis: 'piece' | 'pack';
  verifiedAt?: number;
  effectiveTo?: number;
};
export type FreshnessHold =
  | 'COST_MISSING'
  | 'COST_STALE'
  | 'COST_CONFLICT'
  | 'COST_IMPLAUSIBLE'
  | 'MAP_MISSING'
  | 'MAP_ZERO'
  | 'MAP_POLICY_DERIVED'
  | 'CARTON_MISSING'
  | 'STOCK_UNVERIFIED';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const valid = (o: Observation, now: number) => Number.isFinite(o.observedAt) && o.observedAt > 0 && o.observedAt <= now && (o.effectiveFrom === undefined || o.effectiveFrom <= now) && (o.effectiveTo === undefined || o.effectiveTo > now);

function equivalent(a: Observation, b: Observation) {
  if (a.unit && b.unit && a.unit !== b.unit) return false;
  if (a.extractedValue === b.extractedValue) return true;
  if (a.field !== 'wholesale' && a.field !== 'map') return false;
  try { return cmp(parseDecimal(a.extractedValue), parseDecimal(b.extractedValue)) === 0; }
  catch { return false; }
}

/** The latest still-valid observation of a field, or null. Conflicting current values return 'conflict'. */
export function currentObservation(obs: readonly Observation[], field: string, now: number): Observation | null | 'conflict' {
  const current = obs.filter((o) => o.field === field && valid(o, now) && (o.confidence === 'confirmed' || o.confidence === 'corroborated' || (field !== 'stock' && o.confidence === 'policy_derived'))).sort((a, b) => b.observedAt - a.observedAt);
  if (!current.length) return obs.some(o => o.field === field && valid(o, now) && o.confidence === 'conflict') ? 'conflict' : null;
  const newest = current[0];
  // Two current observations from the same moment that disagree are a conflict.
  if (current.some((o) => o.observedAt === newest.observedAt && !equivalent(o, newest))) return 'conflict';
  if (obs.some((o) => o.field === field && valid(o, now) && o.confidence === 'conflict' && o.observedAt >= newest.observedAt)) return 'conflict';
  return newest;
}

export function evaluateVariant(input: {
  cost: CostView | null;
  piecesPerPack: number;
  cartons: number;
  observations: readonly Observation[];
  policy: FreshnessPolicy;
  now: number;
  /** A documented supplier price list that is still in effect keeps cost/MAP current past maxDays. */
  priceListValidUntil?: number;
}): { holds: FreshnessHold[]; availability: Availability; stockObservedAt?: number } {
  const { cost, policy, now } = input;
  const holds = new Set<FreshnessHold>();
  if (!cost || cost.wholesaleMinor === null) holds.add('COST_MISSING');
  else {
    if (cost.wholesaleMinor <= 0) holds.add('COST_IMPLAUSIBLE');
    const listValid = input.priceListValidUntil !== undefined && input.priceListValidUntil > now;
    const expired = cost.effectiveTo !== undefined && cost.effectiveTo <= now;
    const invalidVerification = cost.verifiedAt === undefined || !Number.isFinite(cost.verifiedAt) || cost.verifiedAt <= 0 || cost.verifiedAt > now;
    const old = invalidVerification || now - cost.verifiedAt! > policy.costMapMaxDays * DAY;
    if (expired || invalidVerification || (old && !listValid)) holds.add('COST_STALE');
  }
  if (cost) {
    if (cost.mapApplicability === 'unknown') holds.add('MAP_MISSING');
    if (cost.mapApplicability === 'applies') {
      if (cost.mapMinor === null) holds.add('MAP_MISSING');
      else if (cost.mapMinor === 0) holds.add('MAP_ZERO');
      else if (cost.wholesaleMinor !== null) {
        const mapPiece = cost.mapUnitBasis === 'pack' ? cost.mapMinor / input.piecesPerPack : cost.mapMinor;
        if (mapPiece < cost.wholesaleMinor) holds.add('COST_IMPLAUSIBLE');
      }
      if (cost.mapSource === 'policy_derived') holds.add('MAP_POLICY_DERIVED');
    }
  }
  for (const f of ['wholesale', 'map']) if (currentObservation(input.observations, f, now) === 'conflict') holds.add('COST_CONFLICT');
  if (input.cartons < 1) holds.add('CARTON_MISSING');
  const stock = currentObservation(input.observations, 'stock', now);
  let availability: Availability = 'unknown';
  let stockObservedAt: number | undefined;
  if (stock === 'conflict') holds.add('STOCK_UNVERIFIED');
  else if (stock) {
    stockObservedAt = stock.observedAt;
    const v = stock.extractedValue as Availability;
    availability = ['in_stock', 'out_of_stock', 'discontinued', 'preorder_approved'].includes(v) ? v : 'unknown';
    if (availability !== 'discontinued' && now - stock.observedAt > policy.stockSyncMaxHours * HOUR) holds.add('STOCK_UNVERIFIED');
  } else holds.add('STOCK_UNVERIFIED');
  if (availability === 'unknown') holds.add('STOCK_UNVERIFIED');
  return { holds: [...holds], availability, stockObservedAt };
}

/** Whether a variant may be offered for a purpose, given availability. */
export function availabilityAllows(a: Availability, purpose: 'publish' | 'purchase' | 'link' | 'estimate'): boolean {
  void purpose;
  // Out of stock, discontinued and unknown are never offered; the initial Zuo release has no
  // preorder flow, so preorder_approved is held too until one exists.
  return a === 'in_stock';
}

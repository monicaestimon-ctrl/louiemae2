// Delivery and cart economics engine (spec 02 §8.4–8.6, v2 §9, §11). Pure and integer:
// per-line contribution and subsidy, group requirements, one rounding on the customer ladder,
// and an upward-only tax iteration. Never shows a partial total when any group needs a quote.
import { CommerceError } from '../errors';
import { allocate, ceilDiv } from '../money';
import type { DeliveryLadder } from '../config';

export type EngineRates = { processingBps: number; returnsBps: number; overheadBps: number; deliveryProcessingBps: number };

export type EngineLine = {
  key: string;
  /** Net merchandise actually paid after allocated discounts and credit (cents). */
  netMinor: number;
  /** Landed merchandise cost including supplier payment cost (cents). */
  costMinor: number;
  physicalUnits: number;
  /** Size allowance per physical unit (cents); null when unknown (blocks automatic checkout). */
  allowancePerUnitMinor: number | null;
  /** Margin target for the line (bps); null when unresolved (blocks automatic checkout). */
  marginBps: number | null;
  /** Commission dollars reserved (retail estimates: maximum eligible/protected; trade: 0). */
  commissionMinor: number;
  /** Other known expenses (fixed payment cost share, etc.), excluding processing on tax. */
  otherMinor: number;
};

export type EngineGroup = {
  key: string;
  /** Supplier order fee charged once per supplier order (cents). */
  supplierOrderFeeMinor: number;
  /** Modeled outbound freight + accessorials + one uncertainty reserve (cents); null = quote. */
  freightMinor: number | null;
  quoteReasons: string[];
  lines: EngineLine[];
};

export type LineResult = { key: string; handlingMinor: number; contributionMinor: number; budgetMinor: number; subsidyMinor: number; blocked?: string };
export type GroupResult = { key: string; lines: LineResult[]; subsidyMinor: number; requirementMinor: number | null; quoteRequired: boolean; reasons: string[] };

/** Ladder tier for a requirement (cents): 4999 + 1000 × max(0, ceil((q − 4999)/1000)). Null above the top → quote. */
export function ladderCharge(requirementMinor: number, ladder: DeliveryLadder): number | null {
  const q = Math.max(0, Math.ceil(requirementMinor));
  const step = ladder.tiersMinor.length > 1 ? ladder.tiersMinor[1] - ladder.tiersMinor[0] : 1000;
  const tier = ladder.minimumMinor + step * Math.max(0, ceilDiv(q - ladder.minimumMinor, step));
  if (tier > ladder.quoteAboveMinor) return null;
  // The ladder is the published list; snap to it exactly.
  const found = ladder.tiersMinor.find((t) => t >= tier);
  return found ?? null;
}

/**
 * Allocates the supplier order fee across lines by physical units (by net merchandise when no
 * line has units), so it is counted once per supplier order.
 */
export function allocateHandling(lines: readonly EngineLine[], feeMinor: number): number[] {
  const units = lines.map((l) => l.physicalUnits);
  const weights = units.some((u) => u > 0) ? units : lines.map((l) => Math.max(0, l.netMinor));
  return allocate(feeMinor, weights);
}

/** A_i, B_i and U_i for each line of a group, and the group's uncovered requirement q. */
export function evaluateGroup(g: EngineGroup, r: EngineRates, taxShareMinor: readonly number[] = []): GroupResult {
  const handling = allocateHandling(g.lines, g.supplierOrderFeeMinor);
  const variableBps = r.processingBps + r.returnsBps + r.overheadBps;
  const lines: LineResult[] = g.lines.map((l, i) => {
    const H = handling[i];
    const procOnTax = Math.ceil(((taxShareMinor[i] ?? 0) * r.processingBps) / 10_000);
    if (l.marginBps === null) return { key: l.key, handlingMinor: H, contributionMinor: 0, budgetMinor: 0, subsidyMinor: 0, blocked: 'margin policy unresolved' };
    if (l.allowancePerUnitMinor === null) return { key: l.key, handlingMinor: H, contributionMinor: 0, budgetMinor: 0, subsidyMinor: 0, blocked: 'delivery allowance unknown' };
    // A_i = R_i(1 − p − r − o − m) − C_i − H_i − K_i − V_i  (floored: never overstate contribution)
    const A = Math.floor((l.netMinor * (10_000 - variableBps - l.marginBps)) / 10_000) - l.costMinor - H - l.commissionMinor - l.otherMinor - procOnTax;
    const B = l.allowancePerUnitMinor * l.physicalUnits + Math.max(0, 1000 * l.physicalUnits - H);
    if (A < 0) return { key: l.key, handlingMinor: H, contributionMinor: A, budgetMinor: B, subsidyMinor: 0, blocked: 'line contribution below policy' };
    return { key: l.key, handlingMinor: H, contributionMinor: A, budgetMinor: B, subsidyMinor: Math.min(A, B) };
  });
  const subsidyMinor = lines.reduce((t, l) => t + l.subsidyMinor, 0);
  const reasons = [...g.quoteReasons, ...lines.filter((l) => l.blocked).map((l) => `${l.key}: ${l.blocked}`)];
  if (g.freightMinor === null || reasons.length) return { key: g.key, lines, subsidyMinor, requirementMinor: null, quoteRequired: true, reasons };
  const uncovered = Math.max(0, g.freightMinor - subsidyMinor);
  const requirementMinor = ceilDiv(uncovered * 10_000, 10_000 - r.deliveryProcessingBps);
  return { key: g.key, lines, subsidyMinor, requirementMinor, quoteRequired: false, reasons };
}

export type TaxEstimator = (input: { merchandiseMinor: number; deliveryMinor: number; lineNetMinor: number[] }) => { taxMinor: number; lineTaxMinor: number[] };

export type CartEstimate =
  | { status: 'ok'; deliveryMinor: number; taxMinor: number; groups: GroupResult[]; iterations: number; extraFixedMinor: number }
  | { status: 'quote_required'; groups: GroupResult[]; reasons: string[] };

/**
 * Whole-cart estimate. Group requirements are summed once and rounded once on the ladder; a
 * fixed supplier-rule charge (e.g. Ashcroft's per-item delivery) is added on top. Tax is
 * estimated for the candidate tier and the tier only moves up until stable (≤5 passes).
 */
export function estimateCart(groups: readonly EngineGroup[], r: EngineRates, ladder: DeliveryLadder, tax: TaxEstimator, extraFixedMinor = 0): CartEstimate {
  if (!groups.length && extraFixedMinor <= 0) throw new CommerceError('INVALID_INPUT', 'Empty cart');
  const allLines = groups.flatMap((g) => g.lines);
  const lineNet = allLines.map((l) => l.netMinor);
  const merchandiseMinor = lineNet.reduce((t, x) => t + x, 0);
  let lineTax: number[] = [];
  let tier: number | null = null;
  let taxMinor = 0;
  let results: GroupResult[] = [];
  for (let k = 0; k < 5; k++) {
    let offset = 0;
    results = groups.map((g) => {
      const share = lineTax.slice(offset, offset + g.lines.length);
      offset += g.lines.length;
      return evaluateGroup(g, r, share);
    });
    if (results.some((x) => x.quoteRequired)) return { status: 'quote_required', groups: results, reasons: results.flatMap((x) => x.reasons) };
    const q = results.reduce((t, x) => t + (x.requirementMinor ?? 0), 0);
    const ladderPart = groups.length ? ladderCharge(q, ladder) : 0;
    if (ladderPart === null) return { status: 'quote_required', groups: results, reasons: ['delivery above the published ladder'] };
    const candidate = Math.max(tier ?? 0, ladderPart);
    const t = tax({ merchandiseMinor, deliveryMinor: candidate + extraFixedMinor, lineNetMinor: lineNet });
    taxMinor = t.taxMinor;
    lineTax = t.lineTaxMinor;
    if (tier === candidate) return { status: 'ok', deliveryMinor: candidate + extraFixedMinor, taxMinor, groups: results, iterations: k + 1, extraFixedMinor };
    tier = candidate;
  }
  return { status: 'quote_required', groups: results, reasons: ['tax and delivery did not stabilize'] };
}

/** A tax estimator from a single conservative combined rate (used until a tax provider is authorized). */
export function flatRateTax(rateBps: number, taxDelivery = true): TaxEstimator {
  return ({ merchandiseMinor, deliveryMinor, lineNetMinor }) => {
    const base = merchandiseMinor + (taxDelivery ? deliveryMinor : 0);
    const taxMinor = Math.ceil((base * rateBps) / 10_000);
    return { taxMinor, lineTaxMinor: allocate(taxMinor, lineNetMinor) };
  };
}

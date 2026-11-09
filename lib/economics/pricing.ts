// Zuo merchandise pricing engine (spec 02 §8.1–8.3, v2 §7). Exact rationals throughout; the
// sellable-pack price is rounded once, up to the cent. Contribution is reported, never "profit".
import { CommerceError } from '../errors';
import { add, bpsRat, cmp, div, max, minorRat, mul, rat, sub, toMinor, type Rational } from '../decimal';
import type { PricingAssumptions } from '../config';

export const ENGINE_VERSION = 'zuo-pricing-2';
export type SizeClass = 'SMALL' | 'MEDIUM' | 'LARGE' | 'OVERSIZE' | 'LTL' | 'UNKNOWN';

export type PricingInput = {
  /** Wholesale cost per physical piece, exact (cents as a rational). */
  wholesalePiece: Rational;
  piecesPerPack: number;
  sizeClass: SizeClass;
  /** Verified extra costs per pack (duties, inbound freight, supplier fees); null = unknown. */
  extraPackCostsMinor: (number | null)[];
  /** MAP for the selling pack, or null when MAP does not apply / is unknown. */
  mapPackMinor: number | null;
  assumptions: PricingAssumptions;
  /** Maximum applicable commission for the SKU (elite rate for its category, or its exception max). */
  maxCommissionBps: number;
  marginBps: number;
  tradeDiscountBps: number;
};

/** B per piece = wholesale × (1 + reserve) + handling + size allowance (02 §8.1). */
export function basePiece(i: Pick<PricingInput, 'wholesalePiece' | 'sizeClass' | 'assumptions'>): Rational {
  if (i.sizeClass === 'UNKNOWN') throw new CommerceError('COST_REVIEW_REQUIRED', 'Size class unknown: no delivery allowance can be inferred');
  const a = i.assumptions;
  return add(add(mul(i.wholesalePiece, add(rat(1), bpsRat(a.supplierPaymentReserveBps))), minorRat(a.handlingPerPieceMinor)), minorRat(a.allowanceBySize[i.sizeClass]));
}

export function basePack(i: PricingInput): Rational {
  if (i.extraPackCostsMinor.some((x) => x === null)) throw new CommerceError('COST_REVIEW_REQUIRED', 'An extra cost (duties, inbound freight or fees) is unknown');
  const extras = i.extraPackCostsMinor.reduce<Rational>((t, x) => add(t, minorRat(x as number)), rat(0));
  return add(mul(basePiece(i), rat(i.piecesPerPack)), extras);
}

const variableBps = (a: PricingAssumptions) => a.processingBps + a.returnsBps + a.overheadBps;

/** A trade purchase funds its own costs and margin, with no retail referral commission. */
export function minimumTrade(i: PricingInput): number {
  const denominator = sub(rat(1), bpsRat(variableBps(i.assumptions) + i.marginBps));
  if (cmp(denominator, rat(0)) <= 0) throw new CommerceError('INVALID_INPUT', 'Trade rates leave no room for costs');
  return toMinor(max(div(basePack(i), denominator), minorRat(i.mapPackMinor ?? 0)), 'ceil');
}

/** Minimum retail per pack: max(B/D1, B/D2, MAP/(1−d)), rounded up to the cent (02 §8.2). */
export function minimumRetail(i: PricingInput) {
  const B = basePack(i);
  const pro = variableBps(i.assumptions);
  const D1 = sub(rat(1), bpsRat(pro + i.maxCommissionBps + i.marginBps));
  const D2 = mul(sub(rat(1), bpsRat(pro + i.marginBps)), sub(rat(1), bpsRat(i.tradeDiscountBps)));
  if (cmp(D1, rat(0)) <= 0 || cmp(D2, rat(0)) <= 0) throw new CommerceError('INVALID_INPUT', 'Rates leave no room for the price (non-positive denominator)');
  const terms = [div(B, D1), div(B, D2)];
  if (i.mapPackMinor !== null) terms.push(div(minorRat(i.mapPackMinor), sub(rat(1), bpsRat(i.tradeDiscountBps))));
  const retailMinor = toMinor(max(...terms), 'ceil');
  return { basePackMinor: toMinor(B, 'ceil'), basePack: B, retailMinor, tradeMinor: tradePrice(retailMinor, i.tradeDiscountBps) };
}

/** Trade price per pack = retail × (1 − d), rounded up to the cent. */
export const tradePrice = (retailMinor: number, tradeDiscountBps: number) => toMinor(mul(minorRat(retailMinor), sub(rat(1), bpsRat(tradeDiscountBps))), 'ceil');

export type Scenario = { name: string; priceMinor: number; contributionMinor: number; contributionBps: number; passes: boolean; reason?: string };

/**
 * Contribution for one price and commission: price × (1 − p − r − o) − B − commission (02 §8.3).
 * `passes` when contribution ≥ margin × price.
 */
export function scenario(name: string, priceMinor: number, commissionBps: number, B: Rational, a: PricingAssumptions, marginBps: number): Scenario {
  const price = minorRat(priceMinor);
  const contribution = sub(sub(mul(price, sub(rat(1), bpsRat(variableBps(a)))), B), mul(price, bpsRat(commissionBps)));
  const contributionMinor = toMinor(contribution, 'floor');
  const contributionBps = priceMinor > 0 ? toMinor(div(mul(contribution, rat(10_000)), price), 'floor') : 0;
  const passes = cmp(contribution, mul(price, bpsRat(marginBps))) >= 0;
  return { name, priceMinor, contributionMinor, contributionBps, passes, ...(passes ? {} : { reason: 'below margin policy' }) };
}

/**
 * Every independently modeled scenario for a variant: retail direct, retail at the full category
 * schedule's maximum commission, trade at 5% and 10%, and any extra scenarios. Commission and a
 * trade discount are never applied to the same purchase.
 */
export function scenarios(i: PricingInput & { retailMinor: number; fullScheduleBps: number; extra?: { name: string; priceMinor: number; commissionBps: number }[] }) {
  const B = basePack(i);
  const a = i.assumptions;
  const out = [
    scenario('retail_direct', i.retailMinor, 0, B, a, i.marginBps),
    scenario('retail_max_commission', i.retailMinor, i.fullScheduleBps, B, a, i.marginBps),
    scenario('trade_5', tradePrice(i.retailMinor, 500), 0, B, a, i.marginBps),
    scenario('trade_10', tradePrice(i.retailMinor, 1000), 0, B, a, i.marginBps),
    ...(i.extra ?? []).map((x) => scenario(x.name, x.priceMinor, x.commissionBps, B, a, i.marginBps)),
  ];
  return { basePackMinor: toMinor(B, 'ceil'), scenarios: out, referralQualified: out[1].passes };
}

/** Full-schedule commission each category must support to be referral-eligible (v2 §7). */
export const FULL_SCHEDULE_BPS = { furniture: 1800, decor: 1200, clothing: 800 } as const;

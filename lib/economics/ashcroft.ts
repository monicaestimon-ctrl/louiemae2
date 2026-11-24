// Exact selling-unit economics. This is a planning/qualification calculation, not a supplier quote.
import { add, bpsRat, cmp, div, max, mul, rat, sub, toMinor, type Rational } from '../decimal';
import { CommerceError } from '../errors';
import type { AshcroftPricingAssumptions } from '../config';
import type { Scenario } from './pricing';

export const ASHCROFT_ENGINE_VERSION = 'ashcroft-selling-unit-1';
export type AshcroftPricingInput = {
  wholesaleSellingUnit: Rational;
  extraSellingUnitCostsMinor: (number | null)[];
  modeledFreightMinor: number;
  customerDeliveryMinor: number;
  mapSellingUnitMinor: number | null;
  assumptions: AshcroftPricingAssumptions;
  marginBps: number;
  maxCommissionBps: number;
};

function nonnegative(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new CommerceError('COST_REVIEW_REQUIRED', 'Invalid selling-unit expense');
  return rat(value);
}

export function ashcroftBase(i: AshcroftPricingInput) {
  if (cmp(i.wholesaleSellingUnit, rat(0)) <= 0) throw new CommerceError('COST_REVIEW_REQUIRED', 'Positive selling-unit wholesale required');
  if (i.assumptions.supplierCode !== 'ashcroft' || i.assumptions.wholesaleUnitBasis !== 'selling_unit')
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Ashcroft assumptions required');
  const a = i.assumptions;
  for (const value of [a.supplierPaymentReserveBps, a.processingBps, a.returnsBps, a.overheadBps, a.fundedTradeDiscountBps, i.marginBps, i.maxCommissionBps])
    if (!Number.isSafeInteger(value) || value < 0 || value >= 10000) throw new CommerceError('INVALID_INPUT', 'Invalid pricing rate');
  const extras = i.extraSellingUnitCostsMinor.reduce<Rational>((sum, value) => {
    if (value === null) throw new CommerceError('COST_REVIEW_REQUIRED', 'Selling-unit duties, inbound freight or supplier fees are unknown');
    return add(sum, nonnegative(value));
  }, rat(0));
  const netDelivery = mul(nonnegative(i.customerDeliveryMinor), sub(rat(1), bpsRat(a.processingBps)));
  // Delivery revenue can fund outbound freight only; excess never manufactures merchandise margin.
  const subsidy = max(rat(0), sub(nonnegative(i.modeledFreightMinor), netDelivery));
  return add(add(add(mul(i.wholesaleSellingUnit, add(rat(1), bpsRat(a.supplierPaymentReserveBps))), extras), subsidy),
    add(nonnegative(a.handlingPerSellingUnitMinor), nonnegative(a.fixedProcessingPerSellingUnitMinor)));
}

function denominator(i: AshcroftPricingInput, commissionBps: number) {
  const a = i.assumptions;
  const d = sub(rat(1), bpsRat(a.processingBps + a.returnsBps + a.overheadBps + commissionBps + i.marginBps));
  if (cmp(d, rat(0)) <= 0) throw new CommerceError('INVALID_INPUT', 'Rates leave no room for Ashcroft costs');
  return d;
}

export function ashcroftMinimums(i: AshcroftPricingInput) {
  const base = ashcroftBase(i);
  const map = i.mapSellingUnitMinor === null ? rat(0) : nonnegative(i.mapSellingUnitMinor);
  const trade = max(div(base, denominator(i, 0)), map);
  const retail = max(div(base, denominator(i, i.maxCommissionBps)), map,
    div(trade, sub(rat(1), bpsRat(i.assumptions.fundedTradeDiscountBps))));
  return { minimumRetailMinor: toMinor(retail, 'ceil'), minimumTradeMinor: toMinor(trade, 'ceil'), basePackMinor: toMinor(base, 'ceil') };
}

export function ashcroftScenario(i: AshcroftPricingInput, name: string, priceMinor: number, commissionBps: number): Scenario {
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0 || !Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps >= 10000)
    throw new CommerceError('INVALID_INPUT', 'Invalid approved price or commission');
  const a = i.assumptions;
  const price = rat(priceMinor);
  const contribution = sub(mul(price, sub(rat(1), bpsRat(a.processingBps + a.returnsBps + a.overheadBps + commissionBps))), ashcroftBase(i));
  const passes = cmp(contribution, mul(price, bpsRat(i.marginBps))) >= 0;
  return { name, priceMinor, contributionMinor: toMinor(contribution, 'floor'),
    contributionBps: toMinor(div(mul(contribution, rat(10000)), price), 'floor'), passes,
    ...(passes ? {} : { reason: 'below margin policy' }) };
}

/** Same unrounded contribution comparison as qualification, including post-discount/tax costs. */
export function ashcroftBasketFunded(b: { baseNumerator: string; baseDenominator: string; processingBps: number; returnsBps: number; overheadBps: number; commissionBps: number; marginBps: number }, netMinor: number, units: number, taxMinor = 0) {
  const net = rat(netMinor);
  const contribution = sub(sub(mul(net, sub(rat(1), bpsRat(b.processingBps + b.returnsBps + b.overheadBps + b.commissionBps))),
    mul(rat(BigInt(b.baseNumerator), BigInt(b.baseDenominator)), rat(units))), mul(rat(taxMinor), bpsRat(b.processingBps)));
  return cmp(contribution, mul(net, bpsRat(b.marginBps))) >= 0;
}

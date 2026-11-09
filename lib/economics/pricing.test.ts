import { describe, expect, it } from 'vitest';
import { basePiece, minimumRetail, minimumTrade, scenarios, scenario, tradePrice, type PricingInput } from './pricing';
import { rat, toMinor } from '../decimal';
import { CONFIG_SEED } from '../config/seed';
import type { PricingAssumptions } from '../config';
import { isCommerceError } from '../errors';

const assumptions = CONFIG_SEED.find((s) => s.kind === 'pricingAssumptions')!.value as PricingAssumptions;
const sku111182: PricingInput = {
  wholesalePiece: rat(11_500),
  piecesPerPack: 2,
  sizeClass: 'MEDIUM',
  extraPackCostsMinor: [0],
  mapPackMinor: null,
  assumptions,
  maxCommissionBps: 1800,
  marginBps: 500,
  tradeDiscountBps: 1000,
};

describe('golden G1: SKU 111182 pair', () => {
  it('reproduces the approved retail and trade prices', () => {
    expect(toMinor(basePiece(sku111182), 'half_even')).toBe(15_345);
    const r = minimumRetail(sku111182);
    expect(r.basePackMinor).toBe(30_690);
    expect(r.retailMinor).toBe(45_806);
    expect(r.tradeMinor).toBe(41_226);
  });

  it('reports separate retail and trade contributions (PRI02)', () => {
    const s = scenarios({ ...sku111182, retailMinor: 45_806, fullScheduleBps: 1800 });
    const by = Object.fromEntries(s.scenarios.map((x) => [x.name, x]));
    expect(by.retail_max_commission.contributionMinor).toBe(2_290); // $22.90 ≈ 5%
    expect(by.trade_10.priceMinor).toBe(41_226);
    expect(by.trade_10.contributionMinor).toBe(6_413); // $64.13 ≈ 15.56%
    expect(by.trade_10.contributionBps).toBe(1555);
    expect(by.retail_max_commission.passes).toBe(true);
    expect(s.referralQualified).toBe(true);
    // a trade scenario never carries commission
    expect(by.trade_5.priceMinor).toBe(tradePrice(45_806, 500));
  });
});

describe('minimum retail rules', () => {
  it('uses the independent no-commission trade floor, rounded up and bounded by pack MAP', () => {
    const floor = minimumTrade(sku111182);
    expect(floor).toBe(36106);
    expect(scenario('trade', floor, 0, rat(30690), assumptions, 500).passes).toBe(true);
    expect(scenario('trade', floor - 1, 0, rat(30690), assumptions, 500).passes).toBe(false);
    expect(minimumTrade({ ...sku111182, maxCommissionBps: 9000 })).toBe(floor);
    expect(minimumTrade({ ...sku111182, mapPackMinor: 50000 })).toBe(50000);
    expect(() => minimumTrade({ ...sku111182, extraPackCostsMinor: [null] })).toThrow();
    expect(() => minimumTrade({ ...sku111182, marginBps: 9500 })).toThrow();
  });
  it('lets MAP set the floor on the matching pack basis', () => {
    const r = minimumRetail({ ...sku111182, mapPackMinor: 50_000 });
    expect(r.retailMinor).toBe(55_556); // 500 / 0.9 rounded up
  });

  it('holds unknown size class, unknown extra costs and non-positive denominators (PRI04)', () => {
    for (const bad of [{ sizeClass: 'UNKNOWN' as const }, { extraPackCostsMinor: [null] }]) {
      try {
        minimumRetail({ ...sku111182, ...bad });
        expect.unreachable();
      } catch (e) {
        expect(isCommerceError(e, 'COST_REVIEW_REQUIRED')).toBe(true);
      }
    }
    expect(() => minimumRetail({ ...sku111182, maxCommissionBps: 9_000 })).toThrow();
  });

  it('rounds the pack up once, not per piece', () => {
    const r = minimumRetail({ ...sku111182, piecesPerPack: 3, wholesalePiece: rat(3333, 1) });
    // per piece B = 33.33×1.03 + 10 + 25 = 69.3299; pack = 207.9897; /0.67 = 310.432…
    expect(r.retailMinor).toBe(31_044);
  });

  it('marks a below-policy scenario', () => {
    const s = scenario('x', 30_000, 1800, rat(30_690), assumptions, 500);
    expect(s.passes).toBe(false);
    expect(s.contributionMinor).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { HOLM_PARTNERS, HOLM_RATES, commissionCents, holmChannel, lineCommissions } from './holmPartners';

describe('House partner commission', () => {
  it('pays the tier rate on the retail amount', () => {
    expect(commissionCents(100_000, HOLM_PARTNERS.tiers.base)).toBe(10_000);
    expect(commissionCents(100_000, HOLM_PARTNERS.tiers.elite)).toBe(18_000);
  });

  it('never exceeds the 23% ceiling', () => {
    expect(commissionCents(100_000, 3000)).toBe(23_000);
  });

  it('pays nothing on an empty order', () => {
    expect(commissionCents(0, 1000)).toBe(0);
  });
});

describe('House partner link channels', () => {
  it('keeps the fixed channels as they are', () => {
    for (const c of HOLM_PARTNERS.channels) expect(holmChannel(c)).toBe(c);
  });

  it('maps links shared before the fixed list to the nearest channel', () => {
    expect(holmChannel('pinterest')).toBe('pin');
    expect(holmChannel('Instagram')).toBe('story');
    expect(holmChannel('direct')).toBe('link');
  });

  it('counts anything unknown as a plain link', () => {
    expect(holmChannel('')).toBe('link');
    expect(holmChannel('constructor')).toBe('link');
    expect(holmChannel('__proto__')).toBe('link');
    expect(holmChannel(undefined)).toBe('link');
    expect(holmChannel('<script>')).toBe('link');
  });
});

describe('commission by product type', () => {
  const line = (over: Partial<import('./holmPartners').CommissionLineInput>) => ({ key: 'a', type: 'furniture' as const, unitCents: 100_000, quantity: 1, unitCostCents: 40_000, ...over });

  it('uses the tier rate for each product type', () => {
    const r = lineCommissions(
      [line({ key: 'sofa' }), line({ key: 'vase', type: 'decor', unitCents: 6_299, unitCostCents: 3_700 }), line({ key: 'dress', type: 'clothing', unitCents: 3_199, unitCostCents: 1_900 })],
      'base'
    );
    expect(r.lines.map((l) => [l.key, l.rateBps])).toEqual([['sofa', 1000], ['vase', 800], ['dress', 500]]);
    expect(r.lines.find((l) => l.key === 'dress')!.amountCents).toBe(160); // 5% of $31.99
    expect(HOLM_RATES.elite).toEqual({ furniture: 1800, decor: 1200, clothing: 800 });
  });

  it('never pays more than 40% of our profit on a line', () => {
    // bulky décor: $31.99, $23 landed cost; profit after card fees $7.76 → cap $3.10
    const [l] = lineCommissions([line({ type: 'decor', unitCents: 3_199, unitCostCents: 2_300 })], 'elite').lines;
    expect(l.rateBps).toBe(1200);
    expect(l.capped).toBe(true);
    expect(l.amountCents).toBe(310);
    // at the base rate the same line is under the cap
    expect(lineCommissions([line({ type: 'decor', unitCents: 3_199, unitCostCents: 2_300 })], 'base').lines[0]).toMatchObject({ amountCents: 256, capped: false });
  });

  it('pays nothing on a line sold at a loss', () => {
    expect(lineCommissions([line({ unitCostCents: 120_000 })], 'top').lines[0].amountCents).toBe(0);
  });

  it('pays the base rate for its type when the cost is unknown', () => {
    const [l] = lineCommissions([line({ unitCostCents: null })], 'elite').lines;
    expect(l).toMatchObject({ rateBps: 1000, amountCents: 10_000, costKnown: false });
  });

  it('counts card fees on delivery and tax against the line', () => {
    const plain = lineCommissions([line({ type: 'decor', unitCents: 3_199, unitCostCents: 2_300 })], 'elite').lines[0].amountCents;
    const withDelivery = lineCommissions([line({ type: 'decor', unitCents: 3_199, unitCostCents: 2_300 })], 'elite', 10_000).lines[0].amountCents;
    expect(withDelivery).toBeLessThan(plain);
  });

  it('ignores empty or malformed lines', () => {
    expect(lineCommissions([line({ quantity: 0 }), line({ unitCents: -5 })], 'base').amountCents).toBe(0);
  });
});

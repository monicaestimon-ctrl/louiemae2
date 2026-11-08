import { describe, expect, it } from 'vitest';
import { allocate, assertMinor, ceilDiv, divByComplementBps, divRound, floorDiv, formatUsd, mulBps, mulDiv, sumMinor } from './money';
import { add, bpsRat, cmp, div, dollarsToMinor, max, mul, parseDecimal, rat, sub, toDecimalString, toMinor } from './decimal';
import { isCommerceError } from './errors';

describe('money (G9)', () => {
  it('rounds exactly in every mode, for both signs', () => {
    expect(divRound(7n, 2n, 'floor')).toBe(3n);
    expect(divRound(7n, 2n, 'ceil')).toBe(4n);
    expect(divRound(7n, 2n, 'half_up')).toBe(4n);
    expect(divRound(7n, 2n, 'half_even')).toBe(4n);
    expect(divRound(5n, 2n, 'half_even')).toBe(2n);
    expect(divRound(-7n, 2n, 'floor')).toBe(-4n);
    expect(divRound(-7n, 2n, 'ceil')).toBe(-3n);
    expect(divRound(6n, 3n, 'ceil')).toBe(2n);
    expect(ceilDiv(10, 3)).toBe(4);
    expect(floorDiv(10, 3)).toBe(3);
  });

  it('matches a BigInt reference on 100,000 random cases (no float drift)', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 100_000; i++) {
      const minor = Math.floor(rnd() * 10_000_000);
      const bps = Math.floor(rnd() * 10_001);
      const ref = (BigInt(minor) * BigInt(bps) + 9999n) / 10_000n;
      expect(BigInt(mulBps(minor, bps, 'ceil'))).toBe(ref);
    }
  });

  it('grosses up by a rate complement and rejects a non-positive denominator', () => {
    expect(divByComplementBps(30_690, 3_300, 'ceil')).toBe(45_806); // 306.90 / 0.67 → 458.06
    expect(() => divByComplementBps(100, 10_000, 'ceil')).toThrow();
    expect(() => divByComplementBps(100, 12_000, 'ceil')).toThrow();
  });

  it('rejects non-integer amounts with a typed error', () => {
    try {
      assertMinor(1.5);
      expect.unreachable();
    } catch (e) {
      expect(isCommerceError(e, 'INVALID_INPUT')).toBe(true);
    }
    expect(() => mulDiv(Number.MAX_SAFE_INTEGER, 10, 1, 'floor')).toThrow();
    expect(sumMinor([1, 2, 3])).toBe(6);
  });

  it('allocates totals exactly by weight', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10_000, [15_000, 5_000])).toEqual([7_500, 2_500]);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
    const parts = allocate(99_999, [3, 7, 11, 13]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99_999);
  });

  it('formats dollars', () => {
    expect(formatUsd(45_806)).toBe('$458.06');
    expect(formatUsd(-5)).toBe('−$0.05');
    expect(formatUsd(123_456_789)).toBe('$1,234,567.89');
  });
});

describe('decimal and rational', () => {
  it('parses decimals exactly', () => {
    expect(cmp(parseDecimal('115.0000'), rat(115))).toBe(0);
    expect(cmp(parseDecimal('0.1'), rat(1, 10))).toBe(0);
    expect(() => parseDecimal('1e3')).toThrow();
    expect(dollarsToMinor('118.45')).toBe(11_845);
    expect(dollarsToMinor('0.005', 'half_up')).toBe(1);
  });

  it('computes 0.1 + 0.2 exactly', () => {
    expect(cmp(add(parseDecimal('0.1'), parseDecimal('0.2')), parseDecimal('0.3'))).toBe(0);
  });

  it('reproduces golden G1 arithmetic for SKU 111182', () => {
    const wholesale = rat(11_500); // cents per piece
    const piece = add(add(mul(wholesale, add(rat(1), bpsRat(300))), rat(1_000)), rat(2_500));
    expect(toMinor(piece, 'half_even')).toBe(15_345);
    const pack = mul(piece, rat(2));
    const retail = toMinor(div(pack, sub(rat(1), bpsRat(3_300))), 'ceil');
    expect(retail).toBe(45_806);
    const trade = toMinor(mul(rat(retail), sub(rat(1), bpsRat(1_000))), 'ceil');
    expect(trade).toBe(41_226);
    expect(cmp(max(rat(1), rat(3), rat(2)), rat(3))).toBe(0);
    expect(toDecimalString(parseDecimal('458.0597'), 2)).toBe('458.06');
  });
});

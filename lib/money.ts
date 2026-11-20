// Integer money for every v2 path (spec 02 §7). Amounts are integer minor units (US cents);
// rates are integer basis points. Division and rate maths run on BigInt so no float ever
// touches a money value, and every rounding names its mode.
import { CommerceError } from './errors';

export type Minor = number;
export type Bps = number;
export type RoundMode = 'ceil' | 'floor' | 'half_up' | 'half_even';

export function assertMinor(x: unknown, label = 'amount'): asserts x is Minor {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) throw new CommerceError('INVALID_INPUT', `${label} must be a whole number of cents`);
}
export function assertNonNegativeMinor(x: unknown, label = 'amount'): asserts x is Minor {
  assertMinor(x, label);
  if (x < 0) throw new CommerceError('INVALID_INPUT', `${label} cannot be negative`);
}
export function assertBps(x: unknown, label = 'rate'): asserts x is Bps {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 10_000) throw new CommerceError('INVALID_INPUT', `${label} must be 0–10000 basis points`);
}

/** n / d rounded by mode, exactly, for any sign of n (d > 0). */
export function divRound(n: bigint, d: bigint, mode: RoundMode): bigint {
  if (d <= 0n) throw new CommerceError('INVALID_INPUT', 'Division by a non-positive denominator');
  const q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  const neg = n < 0n;
  const floor = neg ? q - 1n : q;
  const ceil = floor + 1n;
  if (mode === 'floor') return floor;
  if (mode === 'ceil') return ceil;
  // distance from floor, as 2·(n − floor·d) compared with d
  const twice = 2n * (n - floor * d);
  if (twice < d) return floor;
  if (twice > d) return ceil;
  if (mode === 'half_up') return ceil;
  return floor % 2n === 0n ? floor : ceil; // half_even
}

const toNumber = (b: bigint) => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new CommerceError('INVALID_INPUT', 'Amount out of range');
  return n;
};

export const ceilDiv = (a: number, b: number) => toNumber(divRound(BigInt(a), BigInt(b), 'ceil'));
export const floorDiv = (a: number, b: number) => toNumber(divRound(BigInt(a), BigInt(b), 'floor'));

/** minor × num / den, exactly, rounded once. */
export function mulDiv(minor: Minor, num: number | bigint, den: number | bigint, mode: RoundMode): Minor {
  assertMinor(minor);
  return toNumber(divRound(BigInt(minor) * BigInt(num), BigInt(den), mode));
}

/** minor × bps / 10000. */
export function mulBps(minor: Minor, bps: Bps, mode: RoundMode): Minor {
  assertBps(bps);
  return mulDiv(minor, bps, 10_000, mode);
}

/** minor / (1 − bpsSum/10000): the gross-up used by price floors. Rejects a non-positive denominator. */
export function divByComplementBps(minor: Minor, bpsSum: number, mode: RoundMode): Minor {
  if (!Number.isInteger(bpsSum) || bpsSum >= 10_000) throw new CommerceError('INVALID_INPUT', 'Rates leave no room for the price (non-positive denominator)');
  return mulDiv(minor, 10_000, 10_000 - bpsSum, mode);
}

export function sumMinor(values: readonly Minor[]): Minor {
  let t = 0n;
  for (const v of values) {
    assertMinor(v);
    t += BigInt(v);
  }
  return toNumber(t);
}

/**
 * Splits `total` across weights in proportion, largest-remainder, so the parts always add up to
 * the total exactly (used for discounts, credit and tax shares per line).
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  assertMinor(total);
  const w = weights.map((x) => BigInt(Math.max(0, Math.trunc(x))));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0));
  const T = BigInt(total);
  const base = w.map((x) => (T * x) / sum);
  let left = T - base.reduce((a, b) => a + b, 0n);
  const order = w
    .map((x, i) => ({ i, rem: (T * x) % sum }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const step = left >= 0n ? 1n : -1n;
  for (let k = 0; left !== 0n; k = (k + 1) % order.length) {
    base[order[k].i] += step;
    left -= step;
  }
  return base.map(toNumber);
}

export function formatUsd(minor: Minor): string {
  assertMinor(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${neg ? '−' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

// Exact decimals and rationals for source inputs (wholesale, MAP, FX) and pricing formulas.
// Source values are kept as decimal strings; formulas run as BigInt fractions and convert to
// cents once, with a named rounding mode (spec 02 §7).
import { CommerceError } from './errors';
import { divRound, type Minor, type RoundMode } from './money';

export type Rational = { readonly n: bigint; readonly d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};

export function rat(n: bigint | number, d: bigint | number = 1n): Rational {
  let N = BigInt(n);
  let D = BigInt(d);
  if (D === 0n) throw new CommerceError('INVALID_INPUT', 'Division by zero');
  if (D < 0n) [N, D] = [-N, -D];
  const g = gcd(N, D);
  return { n: N / g, d: D / g };
}

export const ZERO = rat(0);
export const ONE = rat(1);
export const add = (a: Rational, b: Rational) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rat(a.n * b.n, a.d * b.d);
export function div(a: Rational, b: Rational) {
  if (b.n === 0n) throw new CommerceError('INVALID_INPUT', 'Division by zero');
  return rat(a.n * b.d, a.d * b.n);
}
export const cmp = (a: Rational, b: Rational) => {
  const x = a.n * b.d - b.n * a.d;
  return x === 0n ? 0 : x < 0n ? -1 : 1;
};
export const max = (...xs: Rational[]) => xs.reduce((m, x) => (cmp(x, m) > 0 ? x : m));
export const min = (...xs: Rational[]) => xs.reduce((m, x) => (cmp(x, m) < 0 ? x : m));
export const isPositive = (a: Rational) => a.n > 0n;

/** A rate in basis points as a fraction (1800 → 18/100). */
export const bpsRat = (bps: number) => rat(BigInt(bps), 10_000n);
/** Cents as a rational number of cents. */
export const minorRat = (minor: Minor) => rat(BigInt(minor));

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parses a decimal string such as "115.0000" exactly. */
export function parseDecimal(s: string): Rational {
  const m = DECIMAL.exec(String(s).trim());
  if (!m) throw new CommerceError('INVALID_INPUT', `Not a decimal number: ${s}`);
  const frac = m[3] ?? '';
  const n = BigInt((m[1] ?? '') + m[2] + frac);
  return rat(n, 10n ** BigInt(frac.length));
}

/** A dollar decimal string ("115.03") to cents, rounded once. */
export const dollarsToMinor = (s: string, mode: RoundMode = 'half_even'): Minor => toMinor(mul(parseDecimal(s), rat(100)), mode);

/** A rational number of cents to whole cents. */
export function toMinor(x: Rational, mode: RoundMode): Minor {
  const v = divRound(x.n, x.d, mode);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new CommerceError('INVALID_INPUT', 'Amount out of range');
  return n;
}

/** Canonical decimal string for storage (scale digits after the point, truncated toward zero). */
export function toDecimalString(x: Rational, scale = 4): string {
  const f = 10n ** BigInt(scale);
  const v = divRound(x.n * f, x.d, 'half_even');
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / f;
  const frac = (a % f).toString().padStart(scale, '0');
  return `${neg ? '-' : ''}${whole}${scale ? '.' + frac : ''}`;
}

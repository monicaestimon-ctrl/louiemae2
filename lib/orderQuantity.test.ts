import { expect, it } from 'vitest';
import { publicQuantityRules } from './orderQuantity';
import { checkQuantity } from './commerce';
it('preserves selling quantities without guessing a physical pack basis', () => {
  expect(publicQuantityRules(3, 2)).toEqual({ minimum: 3, increment: 2 });
  expect(publicQuantityRules(1, 1, 2)).toEqual({ minimum: 1, increment: 1, piecesPerPack: 2 });
});
it('rejects a minimum that no checkout quantity can satisfy', () => {
  expect(publicQuantityRules(9999, 1)).toEqual({ minimum: 9999, increment: 1 });
  expect(publicQuantityRules(10000, 1)).toBeUndefined();
  expect(() => checkQuantity(9999, { minimum: 9999, increment: 1 })).not.toThrow();
  expect(() => checkQuantity(10000, { minimum: 10000, increment: 1 })).toThrow();
});
it.each([
  [0, 1],
  [-1, 1],
  [1, 0],
  [1, 1.5],
  [NaN, 1],
  [1, Infinity],
  [Number.MAX_SAFE_INTEGER + 1, 1],
  ['1', 1],
  [1, 1, 0],
  [1, 1, '2'],
])('rejects invalid or unknown quantity metadata %j', (...values) =>
  expect(publicQuantityRules(values[0], values[1], values[2])).toBeUndefined()
);
it.each([
  { minimum: 0, increment: 1 },
  { minimum: -1, increment: 2 },
  { minimum: 1, increment: 0 },
  { minimum: 1, increment: 0.5 },
  { minimum: NaN, increment: 1 },
])('server quantity checking rejects malformed source rules %j', (rules) =>
  expect(() => checkQuantity(1, rules)).toThrow()
);
it('retains minimum-relative increments and rejects invalid combined quantities', () => {
  expect(() => checkQuantity(3, { minimum: 3, increment: 2 })).not.toThrow();
  expect(() => checkQuantity(5, { minimum: 3, increment: 2 })).not.toThrow();
  expect(() => checkQuantity(6, { minimum: 3, increment: 2 })).toThrow();
  expect(() => checkQuantity(0, { minimum: 1, increment: 1 })).toThrow();
});

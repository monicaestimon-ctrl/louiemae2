import { expect, it } from 'vitest';
import { reviewQuantity } from './cartQuantityReview';
it('offers explicit corrections for combined valid additions that produce an invalid total', () => {
  expect(reviewQuantity(6, { minimum: 3, increment: 2 })).toEqual({
    valid: false,
    choices: [5, 7],
  });
});
it('uses minimum-relative increments rather than multiples of the increment', () => {
  expect(reviewQuantity(3, { minimum: 3, increment: 2 })).toEqual({ valid: true, choices: [5] });
  expect(reviewQuantity(5, { minimum: 3, increment: 2 })).toEqual({ valid: true, choices: [3, 7] });
});
it('does not guess rules or physical pack size', () => {
  expect(reviewQuantity(1)).toEqual({ valid: false, choices: [] });
  expect(reviewQuantity(1, { minimum: 1, increment: 0 })).toEqual({ valid: false, choices: [] });
});
it('bounds suggestions and can suggest the minimum for a stale smaller count', () => {
  expect(reviewQuantity(2, { minimum: 3, increment: 2 })).toEqual({ valid: false, choices: [3] });
  expect(reviewQuantity(9999, { minimum: 3, increment: 2 })).toEqual({
    valid: true,
    choices: [9997],
  });
});
it('withholds impossible order sizes instead of overflowing arithmetic', () => {
  expect(reviewQuantity(1, { minimum: 10001, increment: 1 })).toEqual({
    valid: false,
    choices: [],
  });
  expect(reviewQuantity(Infinity, { minimum: 1, increment: 1 })).toEqual({
    valid: false,
    choices: [1],
  });
});

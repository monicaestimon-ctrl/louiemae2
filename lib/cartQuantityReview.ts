import { MAX_ORDER_QUANTITY, publicQuantityRules, type OrderQuantityRules } from './orderQuantity';
export const MAX_CART_QUANTITY = MAX_ORDER_QUANTITY;
/** Suggestions are explicit customer choices, never an automatic change to an order. */
export function reviewQuantity(quantity: number, rules?: OrderQuantityRules) {
  const verified =
    rules && publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack);
  if (!verified)
    return { valid: false, choices: [] as number[] };
  const { minimum, increment } = verified;
  const valid =
    Number.isSafeInteger(quantity) &&
    quantity >= minimum &&
    quantity <= MAX_CART_QUANTITY &&
    (quantity - minimum) % increment === 0;
  if (!Number.isFinite(quantity)) return { valid: false, choices: [minimum] };
  const lower = minimum + Math.floor((quantity - minimum) / increment) * increment;
  const upper = valid ? quantity + increment : Math.max(minimum, lower + increment);
  const choices = [valid ? quantity - increment : lower, upper].filter(
    (n) => Number.isSafeInteger(n) && n >= minimum && n <= MAX_CART_QUANTITY && n !== quantity
  );
  return { valid, choices: [...new Set(choices)] };
}

import {
  MAX_ORDER_QUANTITY,
  publicQuantityRules,
  validOrderQuantity,
  type OrderQuantityRules,
} from './orderQuantity';
export const MAX_CART_QUANTITY = MAX_ORDER_QUANTITY;
/** Suggestions are explicit customer choices, never an automatic change to an order. */
export function reviewQuantity(
  quantity: number,
  rules?: OrderQuantityRules,
  maximum = MAX_CART_QUANTITY
) {
  const verified =
    rules && publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack);
  if (
    !verified ||
    !Number.isSafeInteger(maximum) ||
    maximum < verified.minimum ||
    maximum > MAX_CART_QUANTITY
  )
    return { valid: false, choices: [] as number[] };
  const { minimum, increment } = verified;
  const valid = validOrderQuantity(quantity, verified, maximum);
  if (!Number.isFinite(quantity)) return { valid: false, choices: [minimum] };
  const bounded = Math.min(quantity, maximum);
  const lower = minimum + Math.floor((bounded - minimum) / increment) * increment;
  const upper = valid ? quantity + increment : Math.max(minimum, lower + increment);
  const choices = [valid ? quantity - increment : lower, upper].filter(
    (n) => Number.isSafeInteger(n) && n >= minimum && n <= maximum && n !== quantity
  );
  return { valid, choices: [...new Set(choices)] };
}

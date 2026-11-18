/** Public selling quantities, independent of inventory, price and checkout authority. */
export type OrderQuantityRules = { minimum: number; increment: number; piecesPerPack?: number };
export const MAX_ORDER_QUANTITY = 9_999;
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export function publicQuantityRules(
  minimum: unknown,
  increment: unknown,
  piecesPerPack?: unknown
): OrderQuantityRules | undefined {
  if (
    !positiveInteger(minimum) ||
    minimum > MAX_ORDER_QUANTITY ||
    !positiveInteger(increment) ||
    (piecesPerPack !== undefined && !positiveInteger(piecesPerPack))
  )
    return;
  return { minimum, increment, ...(typeof piecesPerPack === 'number' ? { piecesPerPack } : {}) };
}

/** The same min-relative rule is used for new additions and explicit cart corrections. */
export function validOrderQuantity(
  quantity: number,
  rules: OrderQuantityRules,
  maximum = MAX_ORDER_QUANTITY
) {
  const verified = publicQuantityRules(rules.minimum, rules.increment, rules.piecesPerPack);
  return (
    !!verified &&
    Number.isSafeInteger(maximum) &&
    maximum >= verified.minimum &&
    maximum <= MAX_ORDER_QUANTITY &&
    Number.isSafeInteger(quantity) &&
    quantity >= verified.minimum &&
    quantity <= maximum &&
    (quantity - verified.minimum) % verified.increment === 0
  );
}

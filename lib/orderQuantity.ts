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

export const MANUAL_STOCK_AGE_MS = 30 * 60_000;
export const TRENDSI_STAGES = [
  ['requested', 'Stock & shipping review'],
  ['confirmed', 'Ready for payment link'],
  ['payment_pending', 'Awaiting payment'],
  ['paid', 'Ready to order'],
  ['ordered', 'Ordered with Trendsi'],
  ['partially_shipped', 'Partially shipped'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['exception', 'Needs attention'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
] as const;
export function positiveQuantity(n: number) {
  return Number.isSafeInteger(n) && n > 0 && n <= 20;
}
export function validMinor(n: number) {
  return Number.isSafeInteger(n) && n >= 0 && n <= 2_000_000;
}
export function canPreparePayment(
  order: { status: string; stockConfirmedAt?: number; shippingMinor?: number },
  now: number
) {
  return (
    order.status === 'confirmed' &&
    order.stockConfirmedAt !== undefined &&
    order.stockConfirmedAt <= now &&
    now - order.stockConfirmedAt <= MANUAL_STOCK_AGE_MS &&
    order.shippingMinor !== undefined &&
    validMinor(order.shippingMinor)
  );
}
export function shipmentStatus(
  items: { quantity: number }[],
  shipments: { lineIndex: number; quantity: number }[]
) {
  const totals = items.map(() => 0);
  for (const s of shipments) {
    if (!Number.isSafeInteger(s.lineIndex) || !items[s.lineIndex] || !positiveQuantity(s.quantity))
      throw Error('Invalid shipment quantity.');
    totals[s.lineIndex] += s.quantity;
    if (totals[s.lineIndex] > items[s.lineIndex].quantity)
      throw Error('Shipment exceeds the ordered quantity.');
  }
  return totals.every((n, i) => n === items[i].quantity)
    ? ('shipped' as const)
    : ('partially_shipped' as const);
}

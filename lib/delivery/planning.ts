import type { DeliveryLadder } from '../config';
import { ladderCharge } from './engine';
import { ceilDiv } from '../money';

/** Planning uses the approved embedded budget, not an assertion about landed cost or margin. */
export function planningDelivery(input: {
  freightMinor: number; uncertaintyBps: number; supplierOrderFeeMinor: number;
  lines: { units: number; allowanceMinor: number; handlingMinor: number }[];
  ladder: DeliveryLadder;
}): number | null {
  const { freightMinor, uncertaintyBps, supplierOrderFeeMinor, lines, ladder } = input;
  if (!lines.length || ![freightMinor, uncertaintyBps, supplierOrderFeeMinor, ladder.deliveryProcessingBps].every(n => Number.isSafeInteger(n) && n >= 0) ||
    uncertaintyBps > 10000 || ladder.deliveryProcessingBps >= 10000 ||
    lines.some(l => ![l.units, l.allowanceMinor, l.handlingMinor].every(n => Number.isSafeInteger(n) && n >= 0) || l.units < 1)) return null;
  const allowance = lines.reduce((n, l) => n + l.units * l.allowanceMinor, 0);
  const handling = lines.reduce((n, l) => n + l.units * l.handlingMinor, 0);
  // Supplier fee consumes the embedded handling budget once; any shortfall increases freight.
  const uncovered = Math.max(0, freightMinor + Math.ceil(freightMinor * uncertaintyBps / 10000) + supplierOrderFeeMinor - handling - allowance);
  const numerator = uncovered * 10000;
  if (![allowance, handling, numerator].every(Number.isSafeInteger)) return null;
  return ladderCharge(ceilDiv(numerator, 10000 - ladder.deliveryProcessingBps), ladder);
}

export const PLANNING_NOTE = 'Planning estimate only, including our delivery allowance and applicable fees. Subject to product availability and final delivery confirmation; this estimate cannot be used for payment.';

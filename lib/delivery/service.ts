/** Versioned customer wording, captured with estimates and paid orders. No carrier timing promises. */
export const DELIVERY_TERMS_VERSION = 1;
export type DeliveryTerms = { version: number; label: string; details: string[] };
import type { DeliveryServicePolicy } from '../config';
export function serviceTerms(
  classifications: readonly string[],
  policy?: DeliveryServicePolicy
): DeliveryTerms {
  const entries = [...new Set(classifications)].map(
    (mode) => policy?.modes[mode as keyof DeliveryServicePolicy['modes']]
  );
  const unknown = !entries.length || entries.some((e) => !e);
  return {
    version: DELIVERY_TERMS_VERSION,
    label: unknown
      ? 'Delivery quote required'
      : [...new Set(entries.map((e) => e!.label))].join(' + '),
    details: unknown
      ? ['Delivery service details require confirmation before ordering.']
      : [...new Set(entries.flatMap((e) => e!.details))],
  };
}

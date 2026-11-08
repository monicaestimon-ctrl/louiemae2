import { CommerceError } from '../errors';

export const DELIVERY_STAFF_ROLES = [
  'owner',
  'support',
  'operations',
  'finance',
  'approver',
  'engineering',
] as const;
export type DeliveryStaffRole = (typeof DELIVERY_STAFF_ROLES)[number];

/** Missing configuration preserves existing owners. An explicit map never grants implicit access. */
export function deliveryStaffRoles(raw: string | undefined, email: string): DeliveryStaffRole[] {
  if (raw === undefined) return ['owner'];
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const map = new Map<string, DeliveryStaffRole[]>();
    for (const [key, value] of Object.entries(input)) {
      const canonical = key.trim().toLowerCase();
      if (
        !canonical ||
        map.has(canonical) ||
        !Array.isArray(value) ||
        value.some((role) => !DELIVERY_STAFF_ROLES.includes(role))
      )
        throw new Error();
      map.set(canonical, [...new Set(value)]);
    }
    return map.get(email.trim().toLowerCase()) ?? [];
  } catch {
    throw new CommerceError('FORBIDDEN', 'Delivery staff role configuration needs review');
  }
}

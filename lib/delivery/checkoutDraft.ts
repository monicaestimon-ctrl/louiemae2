import type { DeliveryAccess } from './destination';

/** Contact inputs only, held in page memory. Never retain accepted totals or capabilities. */
export type CheckoutDraft = {
  address: {
    recipientName: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  access: DeliveryAccess;
  email: string;
  useCredit: boolean;
};
export type CheckoutDraftRef = { owner: string; current: CheckoutDraft | undefined };

/** A memory reset key, not an authorization decision. Token refresh keeps the same subject. */
export function checkoutDraftOwner(token?: string | null) {
  if (!token) return 'anonymous';
  try {
    const payload = JSON.parse(
      globalThis.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    if (typeof payload.sub === 'string' && payload.sub) return `subject:${payload.sub}`;
  } catch {
    /* An unparseable token still resets memory when it changes. */
  }
  return `token:${token}`;
}

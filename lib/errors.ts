// Typed commerce failures (spec 02 §4). The message is safe to show a customer; `detail` is for
// admins and logs only and never names supplier costs to a customer.
import { ConvexError } from 'convex/values';

export const COMMERCE_ERROR_CODES = [
  'COST_REVIEW_REQUIRED',
  'MAP_POLICY_REVIEW',
  'STOCK_UNAVAILABLE',
  'DELIVERY_QUOTE_REQUIRED',
  'QUOTE_EXPIRED',
  'PRICE_CHANGED',
  'TRADE_APPROVAL_REQUIRED',
  'REFERRAL_INELIGIBLE',
  'PAYMENT_RECONCILIATION_REQUIRED',
  'POLICY_NOT_APPROVED',
  'FEATURE_DISABLED',
  'INVALID_INPUT',
  'FORBIDDEN',
  'TEMPORARILY_UNAVAILABLE',
] as const;
export type CommerceErrorCode = (typeof COMMERCE_ERROR_CODES)[number];

export const CUSTOMER_MESSAGES: Record<CommerceErrorCode, string> = {
  COST_REVIEW_REQUIRED: "This item isn't available to order yet.",
  MAP_POLICY_REVIEW: "This item isn't available to order yet.",
  STOCK_UNAVAILABLE: 'This item is out of stock.',
  DELIVERY_QUOTE_REQUIRED: 'Delivery to this address needs a quote. Request a delivery quote.',
  QUOTE_EXPIRED: 'Your delivery estimate expired. Please review the updated total.',
  PRICE_CHANGED: 'Your total changed. Please review before paying.',
  TRADE_APPROVAL_REQUIRED: 'Trade pricing is available to approved trade members.',
  REFERRAL_INELIGIBLE: "Referral links aren't available for this item.",
  PAYMENT_RECONCILIATION_REQUIRED: 'This needs review by our team.',
  POLICY_NOT_APPROVED: "This isn't available yet.",
  FEATURE_DISABLED: "This isn't available yet.",
  INVALID_INPUT: 'Please check the details and try again.',
  FORBIDDEN: "You don't have access to this.",
  TEMPORARILY_UNAVAILABLE: 'This is temporarily unavailable. Please try again or request support.',
};

export type CommerceErrorData = { code: CommerceErrorCode; message: string; detail?: string; requestId?: string };

export class CommerceError extends ConvexError<CommerceErrorData> {
  readonly code: CommerceErrorCode;
  constructor(code: CommerceErrorCode, detail?: string, message?: string, requestId?: string) {
    super({ code, message: message ?? CUSTOMER_MESSAGES[code], ...(detail ? { detail } : {}), ...(requestId ? { requestId } : {}) });
    this.code = code;
  }
}

/** The error's data, whether it arrives as an object or (across some transports) as JSON text. */
export function commerceErrorData(e: unknown): CommerceErrorData | null {
  let data = (e as { data?: unknown })?.data;
  // ConvexError carries its data as JSON in the message too; some transports keep only that.
  if (data === undefined && typeof (e as { message?: unknown })?.message === 'string') data = (e as { message: string }).message;
  // Some transports encode the data as JSON text, occasionally more than once.
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const d = data as Partial<CommerceErrorData> | undefined;
  return d && typeof d.code === 'string' && (COMMERCE_ERROR_CODES as readonly string[]).includes(d.code) ? (d as CommerceErrorData) : null;
}

export function isCommerceError(e: unknown, code?: CommerceErrorCode): e is CommerceError {
  const d = commerceErrorData(e);
  return !!d && (!code || d.code === code);
}

/** What a customer-facing surface may show for any error. */
export function customerMessage(e: unknown): string {
  const data = commerceErrorData(e);
  const message = data?.message ?? 'Something went wrong. Please try again.';
  return data?.code === 'TEMPORARILY_UNAVAILABLE' && /^[a-f0-9]{24}$/.test(data.requestId ?? '') ? `${message} Reference: ${data.requestId}.` : message;
}

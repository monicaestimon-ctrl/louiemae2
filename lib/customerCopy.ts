// Customer-facing copy that must read the same everywhere it appears (spec S21, v2 §13).
// The split-shipment disclosure is shown before payment, on the confirmation page, in the
// confirmation email and in order details; a test asserts every surface uses these strings.

export const SPLIT_MAY =
  'Your order may arrive in separate shipments. Items may ship from different locations and arrive on different dates. ' +
  "We'll send tracking updates as each shipment ships. Splitting your order will not add delivery charges beyond the amount confirmed at checkout.";

export const SPLIT_WILL =
  'Your order will arrive in separate shipments. Items may ship from different locations and arrive on different dates. ' +
  "We'll send tracking updates as each shipment ships. Splitting your order will not add delivery charges beyond the amount confirmed at checkout.";

/** The disclosure for an order: "will" once the split is known, "may" otherwise. */
export const splitDisclosure = (splitKnown: boolean) => (splitKnown ? SPLIT_WILL : SPLIT_MAY);

export const DELIVERY_TIMING_CAVEAT =
  'Dispatch and transit timing are confirmed separately when your order ships.';
export const ZIP_ESTIMATE_NOTE =
  'Estimate for this ZIP code. Your final delivery charge is confirmed with your full address before you pay.';
export const QUOTE_CTA = 'Request a delivery quote';

/** Status words used by both sites (spec S37 vocabulary). */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  paid: 'Order confirmed',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  partially_delivered: 'Partially delivered',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  exception: 'Needs attention',
};

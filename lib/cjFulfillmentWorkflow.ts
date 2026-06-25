export const CJ_STEP_ORDER = [
  "not_started",
  "creating_order",
  "order_created",
  "adding_to_cart",
  "cart_added",
  "confirming_cart",
  "cart_confirmed",
  "generating_payment_order",
  "payment_order_generated",
  "paying_balance",
  "payment_submitted",
  "paid",
  "processing",
] as const;

export type CjFulfillmentStep = typeof CJ_STEP_ORDER[number];

export type CjFulfillmentReentryState = {
  cjStatus?: string;
  cjPaymentStatus?: string;
  cjFulfillmentStep?: string;
};

export type CjFulfillmentReentryBlock = {
  reason: "paid" | "processing" | "shipped" | "delivered";
  message: string;
};

const CJ_STEP_SET = new Set<string>(CJ_STEP_ORDER);

const isKnownCjStep = (step: string | undefined): step is CjFulfillmentStep =>
  Boolean(step && CJ_STEP_SET.has(step));

export const hasReachedCjStep = (current: string | undefined, target: CjFulfillmentStep): boolean => {
  if (!isKnownCjStep(current)) return false;
  return CJ_STEP_ORDER.indexOf(current) >= CJ_STEP_ORDER.indexOf(target);
};

export const getCjFulfillmentReentryBlock = (
  state: CjFulfillmentReentryState,
): CjFulfillmentReentryBlock | null => {
  if (state.cjStatus === "delivered") {
    return {
      reason: "delivered",
      message: "CJ fulfillment has already delivered",
    };
  }

  if (state.cjStatus === "shipped") {
    return {
      reason: "shipped",
      message: "CJ fulfillment has already shipped",
    };
  }

  if (state.cjFulfillmentStep === "processing" || state.cjStatus === "processing") {
    return {
      reason: "processing",
      message: "CJ fulfillment is already paid or processing",
    };
  }

  if (state.cjPaymentStatus === "paid" || state.cjFulfillmentStep === "paid") {
    return {
      reason: "paid",
      message: "CJ fulfillment is already paid or processing",
    };
  }

  return null;
};

import { describe, expect, it } from "vitest";
import {
  getCjFulfillmentReentryBlock,
  hasReachedCjStep,
} from "./cjFulfillmentWorkflow";

describe("CJ fulfillment workflow guards", () => {
  it.each([
    [{ cjPaymentStatus: "paid" }, "paid", "CJ fulfillment is already paid or processing"],
    [{ cjFulfillmentStep: "paid" }, "paid", "CJ fulfillment is already paid or processing"],
    [{ cjFulfillmentStep: "processing" }, "processing", "CJ fulfillment is already paid or processing"],
    [{ cjStatus: "processing" }, "processing", "CJ fulfillment is already paid or processing"],
    [{ cjStatus: "shipped" }, "shipped", "CJ fulfillment has already shipped"],
    [{ cjStatus: "delivered" }, "delivered", "CJ fulfillment has already delivered"],
  ] as const)("blocks duplicate fulfillment when state is %j", (state, reason, message) => {
    expect(getCjFulfillmentReentryBlock(state)).toEqual({ reason, message });
  });

  it("prefers shipped and delivered reasons over paid when multiple terminal states are present", () => {
    expect(getCjFulfillmentReentryBlock({
      cjPaymentStatus: "paid",
      cjFulfillmentStep: "paid",
      cjStatus: "shipped",
    })).toEqual({
      reason: "shipped",
      message: "CJ fulfillment has already shipped",
    });

    expect(getCjFulfillmentReentryBlock({
      cjPaymentStatus: "paid",
      cjFulfillmentStep: "paid",
      cjStatus: "delivered",
    })).toEqual({
      reason: "delivered",
      message: "CJ fulfillment has already delivered",
    });
  });

  it.each([
    { cjStatus: "failed", cjFulfillmentStep: "order_created", cjPaymentStatus: "failed" },
    { cjStatus: "confirmed", cjFulfillmentStep: "cart_added", cjPaymentStatus: "not_started" },
    { cjStatus: "confirmed", cjFulfillmentStep: "cart_confirmed", cjPaymentStatus: "not_started" },
    { cjStatus: "confirmed", cjFulfillmentStep: "payment_order_generated", cjPaymentStatus: "balance_payment_ready" },
    { cjStatus: "cancelled", cjFulfillmentStep: "failed", cjPaymentStatus: "failed" },
  ])("allows retryable partial fulfillment state %j", (state) => {
    expect(getCjFulfillmentReentryBlock(state)).toBeNull();
  });

  it("recognizes reached workflow steps for resume decisions", () => {
    expect(hasReachedCjStep("order_created", "cart_added")).toBe(false);
    expect(hasReachedCjStep("cart_added", "cart_added")).toBe(true);
    expect(hasReachedCjStep("cart_added", "cart_confirmed")).toBe(false);
    expect(hasReachedCjStep("cart_confirmed", "cart_added")).toBe(true);
    expect(hasReachedCjStep("payment_order_generated", "cart_confirmed")).toBe(true);
    expect(hasReachedCjStep("payment_order_generated", "paid")).toBe(false);
    expect(hasReachedCjStep("paid", "payment_order_generated")).toBe(true);
  });

  it("does not treat missing, failed, or unknown steps as reached", () => {
    expect(hasReachedCjStep(undefined, "cart_added")).toBe(false);
    expect(hasReachedCjStep("failed", "cart_added")).toBe(false);
    expect(hasReachedCjStep("unexpected", "cart_added")).toBe(false);
  });
});

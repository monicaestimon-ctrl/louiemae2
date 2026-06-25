import { describe, expect, it } from "vitest";
import { getStripeWebhookVerificationError, shouldAllowUnsignedStripeWebhook } from "./stripeWebhook";

describe("Stripe webhook verification mode", () => {
  it("allows normal signed webhook verification when secret and signature are present", () => {
    expect(getStripeWebhookVerificationError("whsec_test", "t=1,v1=sig", { NODE_ENV: "production" })).toBeNull();
  });

  it("rejects missing signing secret by default", () => {
    expect(getStripeWebhookVerificationError(undefined, "t=1,v1=sig", { NODE_ENV: "production" }))
      .toBe("Stripe webhook signing secret is not configured.");
  });

  it("rejects missing Stripe signature by default", () => {
    expect(getStripeWebhookVerificationError("whsec_test", null, { NODE_ENV: "production" }))
      .toBe("Stripe webhook signature is missing.");
  });

  it("requires both an explicit flag and non-production runtime for unsigned test webhooks", () => {
    expect(shouldAllowUnsignedStripeWebhook({
      NODE_ENV: "production",
      STRIPE_ALLOW_UNSIGNED_WEBHOOKS: "true",
    })).toBe(false);
    expect(shouldAllowUnsignedStripeWebhook({
      NODE_ENV: "test",
      STRIPE_ALLOW_UNSIGNED_WEBHOOKS: "true",
    })).toBe(true);
  });
});

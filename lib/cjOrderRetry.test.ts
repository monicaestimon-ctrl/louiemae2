import { describe, expect, it } from "vitest";
import { buildCjRetryOrderPayload, type CjRetryOrderSource } from "./cjOrderRetry";

const baseOrder: CjRetryOrderSource = {
  stripeSessionId: "cs_test_123456789abc",
  customerName: "A Customer",
  customerEmail: "customer@example.com",
  customerPhone: "555-0100",
  subtotal: 42,
  shipping: 7.95,
  shippingAddress: {
    line1: "123 Main",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "US",
  },
  items: [
    {
      cjVariantId: "VID-1",
      cjSku: "SKU-1",
      quantity: 2,
      price: 21,
      cjProductCost: 8,
    },
  ],
};

describe("CJ order retry payload", () => {
  it("builds a fulfillment payload from a saved order", () => {
    expect(buildCjRetryOrderPayload(baseOrder)).toMatchObject({
      ok: true,
      payload: {
        orderNumber: "123456789ABC",
        customerName: "A Customer",
        customerPhone: "555-0100",
        customerEmail: "customer@example.com",
        customerShippingCollected: 7.95,
        orderSubtotal: 42,
        products: [{
          vid: "VID-1",
          sku: "SKU-1",
          quantity: 2,
          productCost: 8,
          retailPrice: 21,
        }],
      },
    });
  });

  it("blocks retry when the order cannot be shipped", () => {
    expect(buildCjRetryOrderPayload({ ...baseOrder, shippingAddress: undefined })).toEqual({
      ok: false,
      error: "Order is missing a shipping address",
    });
  });

  it("blocks retry when no items are mapped to CJ", () => {
    expect(buildCjRetryOrderPayload({
      ...baseOrder,
      items: [{ quantity: 1, price: 21 }],
    })).toEqual({
      ok: false,
      error: "Order has no CJ-mapped items to fulfill",
    });
  });
});

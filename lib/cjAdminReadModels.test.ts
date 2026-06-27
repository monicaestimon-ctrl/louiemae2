import { describe, expect, it } from "vitest";
import {
  getAutomationRisks,
  getCjControlRoomOrder,
  getCjControlRoomSummary,
  getCjOrderRisks,
  getProductRisks,
  getRiskSummary,
  sortRisks,
  type CjAdminOrderInput,
} from "./cjAdminReadModels";

const NOW = Date.parse("2026-06-26T12:00:00.000Z");

const baseOrder = (overrides: Partial<CjAdminOrderInput> = {}): CjAdminOrderInput => ({
  _id: "order-1",
  stripeSessionId: "cs_1",
  customerEmail: "customer@example.com",
  customerName: "Amelia",
  items: [{
    name: "Louie Dress",
    quantity: 1,
    cjVariantId: "vid-1",
    cjSku: "sku-1",
  }],
  total: 84,
  currency: "usd",
  status: "paid",
  shippingAddress: {
    line1: "10 Main",
    city: "Dallas",
    state: "TX",
    postalCode: "75201",
    country: "US",
  },
  createdAt: "2026-06-26T11:00:00.000Z",
  updatedAt: "2026-06-26T11:05:00.000Z",
  ...overrides,
});

describe("CJ admin read models", () => {
  it("labels a fresh paid CJ order as ready for CJ", () => {
    const order = getCjControlRoomOrder(baseOrder(), NOW);

    expect(order.pipelineState).toBe("ready_for_cj");
    expect(order.pipelineLabel).toBe("Ready for CJ");
    expect(order.needsReview).toBe(false);
    expect(order.nextActionKey).toBe("retry_order");
  });

  it("flags missing CJ mapping in simple operator language", () => {
    const order = getCjControlRoomOrder(baseOrder({
      items: [{ name: "Louie Dress", quantity: 1, cjVariantId: "vid-1" }],
    }), NOW);

    expect(order.pipelineState).toBe("needs_review");
    expect(order.needsReview).toBe(true);
    expect(order.nextAction).toBe("Fix product mapping");
    expect(order.risks[0]).toMatchObject({
      severity: "critical",
      title: "Product mapping missing",
      actionKey: "review_mapping",
    });
  });

  it("separates single-order tracking from all-order tracking by action key", () => {
    const risks = getCjOrderRisks(baseOrder({
      cjPaymentStatus: "paid",
      cjFulfillmentStep: "paid",
      cjFulfillmentLastStepAt: "2026-06-22T11:00:00.000Z",
    }), NOW);

    expect(risks).toContainEqual(expect.objectContaining({
      title: "Tracking is late",
      actionKey: "sync_order_tracking",
    }));
  });

  it("surfaces waiting CJ payment as critical after two hours", () => {
    const order = getCjControlRoomOrder(baseOrder({
      cjPaymentStatus: "manual_payment_required",
      cjFulfillmentStep: "payment_order_generated",
      cjPaymentUrl: "https://cj.example/pay",
      cjFulfillmentLastStepAt: "2026-06-26T08:30:00.000Z",
    }), NOW);

    expect(order.pipelineState).toBe("waiting_for_cj_payment");
    expect(order.needsReview).toBe(true);
    expect(order.nextActionKey).toBe("open_cj_payment");
    expect(order.risks[0]?.title).toBe("CJ payment not complete");
  });

  it("detects refund review when local cancellation may not have stopped CJ", () => {
    const order = getCjControlRoomOrder(baseOrder({
      status: "cancelled",
      cjOrderId: "CJ-100",
      cjStatus: "processing",
    }), NOW);

    expect(order.pipelineState).toBe("cancelled");
    expect(order.needsReview).toBe(true);
    expect(order.nextActionKey).toBe("review_refund");
    expect(order.risks[0]?.title).toBe("Refund review needed");
  });

  it("summarizes control room counts", () => {
    const orders = [
      getCjControlRoomOrder(baseOrder(), NOW),
      getCjControlRoomOrder(baseOrder({
        _id: "order-2",
        cjPaymentStatus: "manual_payment_required",
        cjFulfillmentStep: "payment_order_generated",
        cjFulfillmentLastStepAt: "2026-06-26T08:00:00.000Z",
      }), NOW),
      getCjControlRoomOrder(baseOrder({
        _id: "order-3",
        cjStatus: "shipped",
        trackingNumber: "CJPKL123",
      }), NOW),
    ];

    expect(getCjControlRoomSummary(orders)).toMatchObject({
      totalCjOrders: 3,
      needsReview: 1,
      readyForCj: 1,
      waitingForPayment: 1,
      inTransit: 1,
      criticalRisks: 1,
    });
  });

  it("sorts silent risk monitor items by severity before recency", () => {
    const risks = sortRisks([
      ...getProductRisks([{
        _id: "product-1",
        name: "Louie Dress",
        cjSourcingStatus: "approved",
        cjProductId: "pid-1",
        cjInventoryStatus: "low_stock",
        cjInventoryLastCheckedAt: "2026-06-26T11:59:00.000Z",
      }], NOW),
      ...getAutomationRisks({
        apiKeyConfigured: false,
        fulfillmentAutomationReady: false,
        balancePaymentReady: false,
        autoFulfillmentEnabled: true,
        autoBalancePayEnabled: true,
        webhookUrlConfigured: false,
        webhookSignatureVerificationRequired: true,
        warnings: [],
        mode: "balance_payment",
      }, NOW),
    ]);

    expect(risks[0]?.severity).toBe("critical");
    expect(getRiskSummary(risks)).toMatchObject({
      totalRisks: 5,
      critical: 4,
      warning: 1,
      productRisks: 1,
    });
  });

  it("does not create CJ product risks for manual non-CJ products", () => {
    expect(getProductRisks([{
      _id: "manual-product",
      name: "In-store Gift Wrap",
      variants: [{ name: "Default", inStock: true }],
      inStock: true,
    }], NOW)).toEqual([]);
  });
});

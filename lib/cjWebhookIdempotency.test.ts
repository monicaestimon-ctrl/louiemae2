import { describe, expect, it } from "vitest";
import { resolveMonotonicCjStatus } from "./cjWebhookIdempotency";

describe("CJ webhook idempotency", () => {
  it("accepts forward order status progressions", () => {
    expect(resolveMonotonicCjStatus("confirmed", "processing")).toEqual({
      status: "processing",
      changed: true,
      ignored: false,
    });

    expect(resolveMonotonicCjStatus("processing", "shipped")).toEqual({
      status: "shipped",
      changed: true,
      ignored: false,
    });

    expect(resolveMonotonicCjStatus("shipped", "delivered")).toEqual({
      status: "delivered",
      changed: true,
      ignored: false,
    });
  });

  it("ignores stale status downgrades from equivalent or out-of-order messages", () => {
    expect(resolveMonotonicCjStatus("processing", "confirmed")).toEqual({
      status: "processing",
      changed: false,
      ignored: true,
    });

    expect(resolveMonotonicCjStatus("shipped", "processing")).toEqual({
      status: "shipped",
      changed: false,
      ignored: true,
    });

    expect(resolveMonotonicCjStatus("delivered", "shipped")).toEqual({
      status: "delivered",
      changed: false,
      ignored: true,
    });
  });

  it("keeps duplicate status messages idempotent", () => {
    expect(resolveMonotonicCjStatus("shipped", "shipped")).toEqual({
      status: "shipped",
      changed: false,
      ignored: false,
    });
  });

  it("does not let a stale cancellation undo a shipped or delivered order", () => {
    expect(resolveMonotonicCjStatus("shipped", "cancelled")).toEqual({
      status: "shipped",
      changed: false,
      ignored: true,
    });

    expect(resolveMonotonicCjStatus("delivered", "cancelled")).toEqual({
      status: "delivered",
      changed: false,
      ignored: true,
    });
  });

  it("applies cancellation before shipping but does not flip cancelled orders back to processing", () => {
    expect(resolveMonotonicCjStatus("processing", "cancelled")).toEqual({
      status: "cancelled",
      changed: true,
      ignored: false,
    });

    expect(resolveMonotonicCjStatus("cancelled", "processing")).toEqual({
      status: "cancelled",
      changed: false,
      ignored: true,
    });
  });

  it("allows delivery failure before delivery but never after delivery", () => {
    expect(resolveMonotonicCjStatus("shipped", "failed")).toEqual({
      status: "failed",
      changed: true,
      ignored: false,
    });

    expect(resolveMonotonicCjStatus("delivered", "failed")).toEqual({
      status: "delivered",
      changed: false,
      ignored: true,
    });
  });

  it("ignores unknown incoming statuses", () => {
    expect(resolveMonotonicCjStatus("processing", "unexpected")).toEqual({
      status: "processing",
      changed: false,
      ignored: true,
    });

    expect(resolveMonotonicCjStatus(undefined, "unexpected")).toEqual({
      status: undefined,
      changed: false,
      ignored: true,
    });
  });
});

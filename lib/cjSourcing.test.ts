import { describe, expect, it } from "vitest";
import {
  buildCjSourcingPayload,
  canApproveCjSourcing,
  classifyCjSourcingStatus,
} from "./cjSourcing";

const validInput = {
  productName: "Baby cardigan",
  productImage: "https://cdn.example.com/cardigan.jpg",
  productUrl: "https://www.aliexpress.com/item/123.html",
  remark: "A".repeat(250),
  price: 19.95,
  thirdProductId: "product-123",
};

describe("CJ sourcing payload", () => {
  it("builds the documented payload and caps the remark at 200 characters", () => {
    const result = buildCjSourcingPayload(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.remark).toHaveLength(200);
    expect(result.payload.thirdProductId).toBe("product-123");
  });

  it.each([
    [{ productImage: undefined }, "MISSING_PRODUCT_IMAGE"],
    [{ productImage: "data:image/png;base64,abc" }, "INVALID_PRODUCT_IMAGE"],
    [{ productUrl: "javascript:alert(1)" }, "INVALID_PRODUCT_URL"],
    [{ productName: "A".repeat(201) }, "PRODUCT_NAME_TOO_LONG"],
    [{ productUrl: `https://example.com/${"x".repeat(201)}` }, "PRODUCT_URL_TOO_LONG"],
  ])("rejects an invalid provider payload: %s", (override, code) => {
    const result = buildCjSourcingPayload({ ...validInput, ...override });
    expect(result).toMatchObject({ ok: false, code });
  });
});

describe("CJ sourcing evidence", () => {
  it.each([
    [1, "pending"],
    ["2", "processing"],
    [3, "success"],
    ["9", "success"],
    [4, "failure"],
    ["5", "failure"],
    [7, "unknown"],
  ])("classifies status %s as %s", (status, evidence) => {
    expect(classifyCjSourcingStatus(status)).toBe(evidence);
  });

  it("never treats a product ID without catalog verification as approval", () => {
    expect(canApproveCjSourcing({ catalogVerified: false, cjProductId: "pid-1" })).toBe(false);
    expect(canApproveCjSourcing({ catalogVerified: true, cjProductId: "pid-1" })).toBe(true);
    expect(canApproveCjSourcing({ catalogVerified: true })).toBe(false);
  });
});

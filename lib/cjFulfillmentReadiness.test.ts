import { describe, expect, it } from "vitest";
import { evaluateCheckoutItemCjReadiness, evaluateProductCjReadiness } from "./cjFulfillmentReadiness";

describe("CJ fulfillment readiness", () => {
  const readyProduct = {
    name: "Mae Dress",
    inStock: true,
    cjSourcingStatus: "approved",
    cjProductId: "pid-1",
    cjInventoryByVariant: [
      {
        vid: "vid-2t",
        sku: "sku-2t",
        totalInventoryNum: 8,
        status: "in_stock" as const,
        lowStockThreshold: 3,
        lastCheckedAt: "2026-06-25T00:00:00.000Z",
      },
    ],
    variants: [
      {
        id: "size-2t",
        name: "2T",
        inStock: true,
        cjVariantId: "vid-2t",
        cjSku: "sku-2t",
      },
    ],
  };

  it("accepts an approved product with mapped sellable variants", () => {
    expect(evaluateProductCjReadiness(readyProduct)).toMatchObject({
      ready: true,
      errors: [],
    });
  });

  it("requires CJ product, variant, and SKU mappings", () => {
    const result = evaluateProductCjReadiness({
      name: "Mae Dress",
      cjSourcingStatus: "approved",
      variants: [{ id: "size-2t", name: "2T", inStock: true }],
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual([
      "Mae Dress is missing a CJ product ID.",
      "Mae Dress / 2T is missing a CJ variant ID.",
      "Mae Dress / 2T is missing a CJ SKU.",
    ]);
  });

  it("checks the selected checkout variant only", () => {
    const result = evaluateCheckoutItemCjReadiness(readyProduct, {
      variantId: "size-2t",
      quantity: 1,
    });

    expect(result.ready).toBe(true);
  });

  it("rejects checkout when a variant product has no selected variant", () => {
    const result = evaluateCheckoutItemCjReadiness(readyProduct, { quantity: 1 });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress requires a selected variant for CJ fulfillment.");
  });

  it("rejects out-of-stock selected variants", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        variants: [{ ...readyProduct.variants[0], inStock: false }],
      },
      { variantId: "size-2t", quantity: 1 },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress / 2T is marked out of stock.");
  });

  it("rejects products with no sellable variants", () => {
    const result = evaluateProductCjReadiness({
      ...readyProduct,
      variants: [{ ...readyProduct.variants[0], inStock: false }],
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress has no sellable variants.");
  });

  it("rejects invalid checkout quantities", () => {
    const result = evaluateCheckoutItemCjReadiness(readyProduct, {
      variantId: "size-2t",
      quantity: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress has an invalid quantity.");
  });

  it("rejects fractional checkout quantities", () => {
    const result = evaluateCheckoutItemCjReadiness(readyProduct, {
      variantId: "size-2t",
      quantity: 1.5,
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress has an invalid quantity.");
  });

  it("supports non-variant products with product-level CJ mappings", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        name: "Mae Blanket",
        cjSourcingStatus: "approved",
        cjProductId: "pid-blanket",
        cjVariantId: "vid-blanket",
        cjSku: "sku-blanket",
        cjInventoryStatus: "in_stock",
        cjInventoryTotal: 12,
        cjInventoryLastCheckedAt: "2026-06-25T00:00:00.000Z",
      },
      { quantity: 1 },
    );

    expect(result.ready).toBe(true);
  });

  it("rejects checkout when selected CJ inventory is below quantity", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        cjInventoryByVariant: [{
          vid: "vid-2t",
          sku: "sku-2t",
          totalInventoryNum: 1,
          status: "low_stock",
          lowStockThreshold: 3,
          lastCheckedAt: "2026-06-25T00:00:00.000Z",
        }],
      },
      { variantId: "size-2t", quantity: 2 },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress / 2T has insufficient CJ inventory (1 available).");
  });

  it("warns when selected CJ inventory is low but fulfillable", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        cjInventoryByVariant: [{
          vid: "vid-2t",
          sku: "sku-2t",
          totalInventoryNum: 2,
          status: "low_stock",
          lowStockThreshold: 3,
          lastCheckedAt: "2026-06-25T00:00:00.000Z",
        }],
      },
      { variantId: "size-2t", quantity: 1 },
    );

    expect(result.ready).toBe(true);
    expect(result.warnings).toContain("Mae Dress / 2T is low at CJ (2 available).");
  });

  it("blocks checkout strictly when CJ inventory has not been confirmed", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        cjInventoryByVariant: [],
      },
      { variantId: "size-2t", quantity: 1 },
      { strictInventory: true },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress / 2T inventory could not be confirmed with CJ.");
  });

  it("blocks checkout strictly when CJ inventory refresh errors", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        cjInventoryByVariant: [{
          vid: "vid-2t",
          sku: "sku-2t",
          status: "error",
          lowStockThreshold: 3,
          lastCheckedAt: "2026-06-25T00:00:00.000Z",
          error: "Too Many Requests",
        }],
      },
      { variantId: "size-2t", quantity: 1 },
      { strictInventory: true },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress / 2T inventory could not be refreshed from CJ: Too Many Requests");
  });

  it("blocks checkout strictly when CJ inventory is unknown", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        ...readyProduct,
        cjInventoryByVariant: [{
          vid: "vid-2t",
          sku: "sku-2t",
          status: "unknown",
          lowStockThreshold: 3,
          lastCheckedAt: "2026-06-25T00:00:00.000Z",
        }],
      },
      { variantId: "size-2t", quantity: 1 },
      { strictInventory: true },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Dress / 2T inventory could not be confirmed with CJ.");
  });

  it("rejects checkout when product-level CJ inventory is out", () => {
    const result = evaluateCheckoutItemCjReadiness(
      {
        name: "Mae Blanket",
        cjSourcingStatus: "approved",
        cjProductId: "pid-blanket",
        cjVariantId: "vid-blanket",
        cjSku: "sku-blanket",
        cjInventoryStatus: "out_of_stock",
        cjInventoryTotal: 0,
        cjInventoryLastCheckedAt: "2026-06-25T00:00:00.000Z",
      },
      { quantity: 1 },
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Mae Blanket has insufficient CJ inventory (0 available).");
  });
});

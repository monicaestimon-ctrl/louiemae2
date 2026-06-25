import { describe, expect, it } from "vitest";
import { evaluateCheckoutItemCjReadiness, evaluateProductCjReadiness } from "./cjFulfillmentReadiness";

describe("CJ fulfillment readiness", () => {
  const readyProduct = {
    name: "Mae Dress",
    inStock: true,
    cjSourcingStatus: "approved",
    cjProductId: "pid-1",
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
      },
      { quantity: 1 },
    );

    expect(result.ready).toBe(true);
  });
});

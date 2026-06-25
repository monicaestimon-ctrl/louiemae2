import { describe, expect, it } from "vitest";
import { mergePricingRefreshFailureWarning } from "./cjPricingRefreshFailure";

describe("CJ pricing refresh failure warnings", () => {
  it("adds a durable warning when a pricing refresh fails", () => {
    expect(mergePricingRefreshFailureWarning(undefined, "Failed to authenticate")).toEqual([
      "CJ pricing refresh failed: Failed to authenticate",
    ]);
  });

  it("replaces the previous CJ pricing refresh warning and preserves other warnings", () => {
    expect(mergePricingRefreshFailureWarning([
      "Missing source price",
      "CJ pricing refresh failed: Old failure",
      "Manual price lock is enabled",
    ], "CJ product query returned no catalog data")).toEqual([
      "Missing source price",
      "Manual price lock is enabled",
      "CJ pricing refresh failed: CJ product query returned no catalog data",
    ]);
  });
});

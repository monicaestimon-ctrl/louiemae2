import { describe, expect, it } from "vitest";
import { isLegacyWrappedUrlFragment, isObsoleteBatchImportError } from "./batchImportObsolete";

describe("batch import obsolete error detection", () => {
  it("recognizes Notes-wrapped 1688 continuation fragments", () => {
    expect(isLegacyWrappedUrlFragment("https://E5%95%86%E6%9C%BA&offerId=922839791630")).toBe(true);
  });

  it("recognizes truncated percent-encoded 1688 URLs from the old parser", () => {
    expect(isLegacyWrappedUrlFragment("https://detail.1688.com/offer/922839791630.html?optName=%E8%B6%8B%E5%8A%BF%")).toBe(true);
  });

  it("does not hide ordinary retryable product import failures", () => {
    expect(isObsoleteBatchImportError({
      status: "error",
      normalizedUrl: "https://detail.1688.com/offer/937477668728.html",
      error: "Uncaught ConvexError: {\"code\":\"SCRAPE_FAILED\",\"message\":\"Provider busy\"}",
    })).toBe(false);
  });

  it("hides old split-url errors that cannot be retried as real products", () => {
    expect(isObsoleteBatchImportError({
      status: "error",
      normalizedUrl: "https://E5%95%86%E6%9C%BA&offerId=922839791630",
      error: "Uncaught ConvexError: {\"code\":\"INVALID_URL\",\"message\":\"Invalid URL format\"}",
    })).toBe(true);
  });
});

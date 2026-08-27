import { describe, expect, it } from "vitest";
import {
  CJ_MAX_PROVIDER_PROCESSING_MS,
  CJ_DAILY_SOURCE_TARGET,
  getCjDailySourceCapacity,
  getCjQuotaDayStart,
  getCjQuotaResetAt,
  getLegacyCjInitialJobState,
  hasCjProcessingDeadlineExpired,
  isCjProviderAvailabilityFailure,
  isCjDailySourcingLimit,
  shouldDeadLetterCjWork,
} from "./cjSourcingPolicy";

describe("CJ sourcing durability policy", () => {
  it.each([
    [{ status: "pending", payloadValid: true }, "queued"],
    [{ status: "pending", sourcingId: "source-1", payloadValid: false }, "submitted"],
    [{ status: "approved", cjProductId: "pid-1", payloadValid: false }, "awaiting_catalog"],
    [{ status: "approved", payloadValid: true }, "reconciliation_required"],
    [{ status: "rejected", sourcingId: "source-1", payloadValid: true }, "rejected"],
    [{ status: "pending", payloadValid: false }, "needs_input"],
  ] as const)("maps legacy state %j to %s", (input, expected) => {
    expect(getLegacyCjInitialJobState(input)).toBe(expected);
  });

  it("stops unbounded provider processing after fourteen days", () => {
    const now = Date.now();
    expect(hasCjProcessingDeadlineExpired(now - CJ_MAX_PROVIDER_PROCESSING_MS, now)).toBe(true);
    expect(hasCjProcessingDeadlineExpired(now - CJ_MAX_PROVIDER_PROCESSING_MS + 1, now)).toBe(false);
    expect(hasCjProcessingDeadlineExpired(undefined, now)).toBe(false);
  });

  it("dead-letters only after the bounded transient failure threshold", () => {
    expect(shouldDeadLetterCjWork(9)).toBe(false);
    expect(shouldDeadLetterCjWork(10)).toBe(true);
  });

  it.each([
    [undefined, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [404, false],
  ])("classifies provider availability status %s", (status, expected) => {
    expect(isCjProviderAvailabilityFailure(status)).toBe(expected);
  });

  it.each([
    ["Daily sourcing limit reached", true],
    ["Sourcing requests maximum 5 per day", true],
    ["Daily quota has been exhausted", true],
    ["Too many requests", false],
    ["Product URL is unsupported", false],
  ])("classifies daily source quota message %s", (message, expected) => {
    expect(isCjDailySourcingLimit(message)).toBe(expected);
  });

  it("budgets twenty-five accepted or in-flight sourcing submissions per UTC day", () => {
    expect(CJ_DAILY_SOURCE_TARGET).toBe(25);
    expect(getCjDailySourceCapacity(0, 0)).toBe(25);
    expect(getCjDailySourceCapacity(7, 3)).toBe(15);
    expect(getCjDailySourceCapacity(20, 0)).toBe(5);
    expect(getCjDailySourceCapacity(21, 2)).toBe(2);
    expect(getCjDailySourceCapacity(24, 0)).toBe(1);
    expect(getCjDailySourceCapacity(24, 1)).toBe(0);
    expect(getCjDailySourceCapacity(25, 0)).toBe(0);
    expect(getCjDailySourceCapacity(26, 2)).toBe(0);
  });

  it("uses a stable UTC quota window instead of a drifting 24-hour block", () => {
    const now = Date.parse("2026-08-17T22:15:00.000Z");
    expect(getCjQuotaDayStart(now)).toBe(Date.parse("2026-08-17T00:00:00.000Z"));
    expect(getCjQuotaResetAt(now)).toBe(Date.parse("2026-08-18T00:00:00.000Z"));
  });
});

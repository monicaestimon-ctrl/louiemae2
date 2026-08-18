export const CJ_MAX_PROVIDER_PROCESSING_MS = 14 * 24 * 60 * 60 * 1000;
export const CJ_MAX_TRANSIENT_FAILURES = 10;
export const CJ_DAILY_SOURCE_TARGET = 20;

export const getCjQuotaDayStart = (now: number): number => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export const getCjQuotaResetAt = (now: number): number =>
  getCjQuotaDayStart(now) + 24 * 60 * 60 * 1000;

export const getCjDailySourceCapacity = (
  acceptedToday: number,
  activeSubmissions: number,
  target = CJ_DAILY_SOURCE_TARGET,
): number => Math.max(0, target - acceptedToday - activeSubmissions);

export type CjInitialJobState =
  | "needs_input"
  | "queued"
  | "submitted"
  | "awaiting_catalog"
  | "reconciliation_required"
  | "rejected";

export const getLegacyCjInitialJobState = (input: {
  status?: string;
  sourcingId?: string;
  cjProductId?: string;
  payloadValid: boolean;
}): CjInitialJobState => {
  if (input.status === "rejected") return "rejected";
  if (input.status === "approved" && input.cjProductId) return "awaiting_catalog";
  if (input.sourcingId) return "submitted";
  if (input.status === "approved") return "reconciliation_required";
  return input.payloadValid ? "queued" : "needs_input";
};

export const hasCjProcessingDeadlineExpired = (
  submittedAt: number | undefined,
  now: number,
) => Boolean(submittedAt && now - submittedAt >= CJ_MAX_PROVIDER_PROCESSING_MS);

export const shouldDeadLetterCjWork = (failureCount: number) =>
  failureCount >= CJ_MAX_TRANSIENT_FAILURES;

export const isCjProviderAvailabilityFailure = (httpStatus?: number) =>
  httpStatus === undefined || httpStatus === 429 || httpStatus >= 500;

export const isCjDailySourcingLimit = (message: string) =>
  /(?:daily\b.{0,30}\b(?:limit|maximum|quota|allowance)|(?:limit|maximum|quota|allowance|requests?)\b.{0,30}\bper\s+day|sourc\w*\b.{0,40}\bper\s+day)/i.test(message);

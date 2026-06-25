const PRICING_REFRESH_WARNING_PREFIX = "CJ pricing refresh failed:";

export const mergePricingRefreshFailureWarning = (
  existingWarnings: string[] | undefined,
  error: string,
): string[] => {
  const warning = `${PRICING_REFRESH_WARNING_PREFIX} ${error}`;
  const retainedWarnings = (existingWarnings || [])
    .filter((item) => !item.startsWith(PRICING_REFRESH_WARNING_PREFIX));

  return [...retainedWarnings, warning];
};

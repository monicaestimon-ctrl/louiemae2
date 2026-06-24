export type CjAutomationMode = "create_only" | "manual_payment" | "balance_payment";

export type CjAutomationEnv = Record<string, string | undefined>;

export type CjAutomationConfig = {
  autoFulfillmentEnabled: boolean;
  autoBalancePayEnabled: boolean;
  webhookSignatureVerificationRequired: boolean;
  apiKeyConfigured: boolean;
  webhookUrlConfigured: boolean;
  mode: CjAutomationMode;
  fulfillmentAutomationReady: boolean;
  balancePaymentReady: boolean;
  warnings: string[];
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export const readBooleanEnv = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
};

const hasValue = (value: string | undefined): boolean => typeof value === "string" && value.trim().length > 0;

export const getCjAutomationConfig = (env: CjAutomationEnv = process.env): CjAutomationConfig => {
  const autoFulfillmentEnabled = readBooleanEnv(env.CJ_AUTO_FULFILLMENT_ENABLED);
  const autoBalancePayEnabled = readBooleanEnv(env.CJ_AUTO_BALANCE_PAY_ENABLED);
  const webhookSignatureVerificationRequired = readBooleanEnv(env.CJ_WEBHOOK_VERIFY_SIGNATURE, true);
  const apiKeyConfigured = hasValue(env.CJ_API_KEY);
  const webhookUrlConfigured = hasValue(env.CJ_WEBHOOK_URL);

  const mode: CjAutomationMode = !autoFulfillmentEnabled
    ? "create_only"
    : autoBalancePayEnabled
      ? "balance_payment"
      : "manual_payment";

  const fulfillmentAutomationReady = autoFulfillmentEnabled && apiKeyConfigured;
  const balancePaymentReady =
    fulfillmentAutomationReady &&
    autoBalancePayEnabled &&
    webhookUrlConfigured &&
    webhookSignatureVerificationRequired;

  const warnings: string[] = [];
  if (!apiKeyConfigured) {
    warnings.push("CJ_API_KEY is not configured.");
  }
  if (autoBalancePayEnabled && !autoFulfillmentEnabled) {
    warnings.push("CJ_AUTO_BALANCE_PAY_ENABLED requires CJ_AUTO_FULFILLMENT_ENABLED.");
  }
  if (autoFulfillmentEnabled && !webhookUrlConfigured) {
    warnings.push("CJ_WEBHOOK_URL is not configured; CJ status updates will not be hands-off.");
  }
  if (autoBalancePayEnabled && !webhookSignatureVerificationRequired) {
    warnings.push("Automatic balance payment requires CJ_WEBHOOK_VERIFY_SIGNATURE=true.");
  }
  if (autoFulfillmentEnabled && !autoBalancePayEnabled) {
    warnings.push("CJ fulfillment automation can prepare orders, but balance payment remains manual.");
  }

  return {
    autoFulfillmentEnabled,
    autoBalancePayEnabled,
    webhookSignatureVerificationRequired,
    apiKeyConfigured,
    webhookUrlConfigured,
    mode,
    fulfillmentAutomationReady,
    balancePaymentReady,
    warnings,
  };
};


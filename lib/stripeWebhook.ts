export type StripeWebhookEnv = Record<string, string | undefined>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const isTrue = (value: string | undefined): boolean =>
  TRUE_VALUES.has((value ?? "").trim().toLowerCase());

export const shouldAllowUnsignedStripeWebhook = (env: StripeWebhookEnv = process.env): boolean => {
  const explicitTestFlag = isTrue(env.STRIPE_ALLOW_UNSIGNED_WEBHOOKS);
  // Never with live keys, whatever else is set (v2 S38).
  if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '')) return false;
  const nodeEnv = env.NODE_ENV;
  const nonProductionRuntime = nodeEnv === "test" || nodeEnv === "development";
  return explicitTestFlag && nonProductionRuntime;
};

export const getStripeWebhookVerificationError = (
  webhookSecret: string | undefined,
  signature: string | null,
  env: StripeWebhookEnv = process.env,
): string | null => {
  if (webhookSecret && signature) return null;
  if (shouldAllowUnsignedStripeWebhook(env)) return null;
  if (!webhookSecret) return "Stripe webhook signing secret is not configured.";
  return "Stripe webhook signature is missing.";
};

// Server-owned v2 feature flags (spec 02 §5). Each is a Convex environment variable and is on
// only when set to exactly "true". A flag never bypasses a source, policy or economics gate.
import { CommerceError } from './errors';

export const V2_FLAGS = [
  'CATALOG_PUBLICATION_V2_ENABLED',
  'RETAIL_ZUO_CHECKOUT_ENABLED',
  'TRADE_CHECKOUT_V2_ENABLED',
  'DELIVERY_AUTOMATION_ENABLED',
  'CREATOR_ENROLLMENT_V2_ENABLED',
  'RETAIL_LINK_GENERATION_V2_ENABLED',
  'COMMISSION_ACCRUAL_V2_ENABLED',
  'CREDIT_V2_ENABLED',
  'PAYOUT_EXECUTION_ENABLED',
  'HOLM_TRADE_ONLY_ENABLED',
  'ATTRIBUTION_V2_ENABLED',
  'EDI_ZUO_ENABLED',
] as const;
export type V2Flag = (typeof V2_FLAGS)[number];

type Env = Record<string, string | undefined>;
const defaultEnv = (): Env => (typeof process !== 'undefined' ? process.env : {});

export function flag(name: V2Flag, env: Env = defaultEnv()): boolean {
  return env[name] === 'true';
}

export function requireFlag(name: V2Flag, env: Env = defaultEnv()) {
  if (!flag(name, env)) throw new CommerceError('FEATURE_DISABLED', `${name} is off`);
}

/** All flags and their state, for the admin health screen (values are booleans, never secrets). */
export function flagStates(env: Env = defaultEnv()): Record<V2Flag, boolean> {
  return Object.fromEntries(V2_FLAGS.map((f) => [f, flag(f, env)])) as Record<V2Flag, boolean>;
}

/**
 * Only one automatic payout route may run. The legacy PARTNER_PAYOUTS_ENABLED run and the v2
 * PAYOUT_EXECUTION_ENABLED run must never both be on.
 */
export function payoutRoute(env: Env = defaultEnv()): 'legacy' | 'v2' | 'none' | 'conflict' {
  const legacy = env.PARTNER_PAYOUTS_ENABLED === 'true';
  const v2 = flag('PAYOUT_EXECUTION_ENABLED', env);
  return legacy && v2 ? 'conflict' : legacy ? 'legacy' : v2 ? 'v2' : 'none';
}

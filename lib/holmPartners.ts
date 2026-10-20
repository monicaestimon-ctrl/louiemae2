// House of Louie Mae partner program rules. Money in integer cents, rates in basis points.
// Commission is earned on retail-priced orders only; trade-priced orders earn nothing, and
// referring a business earns store credit instead.
export const HOLM_PARTNERS = {
  tiers: { base: 1000, active: 1200, top: 1500, elite: 1800 },
  ceilingBps: 2300,
  attributionDays: 30,
  clearingDays: 30,
  quoteHoldDays: 120, // unpaid partner-attributed quotes stop waiting for payment after this
  referralCreditCents: 10_000, // $100 store credit
  referralMinOrderCents: 50_000, // after a first paid order over $500
  channels: ['pinterest', 'instagram', 'email', 'website', 'tiktok', 'direct'],
} as const;

export function commissionCents(baseCents: number, rateBps: number) {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0;
  return Math.round((baseCents * Math.min(rateBps, HOLM_PARTNERS.ceilingBps)) / 10000);
}

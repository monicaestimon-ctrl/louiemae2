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
  referralMinOrderCents: 50_000, // once the referred business pays an order of $500 or more
  // Where a partner link was opened from. Every Share-sheet route tags its link with one of these.
  channels: ['story', 'pin', 'post', 'pdf', 'link', 'share', 'qr'],
} as const;

export type HolmChannel = (typeof HOLM_PARTNERS.channels)[number];
// Links shared before the fixed channel list keep counting under the nearest channel.
const LEGACY_CHANNELS: Record<string, HolmChannel> = {
  pinterest: 'pin',
  instagram: 'story',
  tiktok: 'post',
  email: 'share',
  website: 'link',
  direct: 'link',
};
export function holmChannel(raw: string | null | undefined): HolmChannel {
  const c = String(raw ?? '').toLowerCase();
  if ((HOLM_PARTNERS.channels as readonly string[]).includes(c)) return c as HolmChannel;
  return Object.prototype.hasOwnProperty.call(LEGACY_CHANNELS, c) ? LEGACY_CHANNELS[c] : 'link';
}

export function commissionCents(baseCents: number, rateBps: number) {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0;
  return Math.round((baseCents * Math.min(rateBps, HOLM_PARTNERS.ceilingBps)) / 10000);
}

export type HolmTier = keyof typeof HOLM_PARTNERS.tiers;
const pct = (bps: number) => `${bps / 100}%`;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/**
 * What the site may say about the program, built from the rules above so the copy can't
 * promise more than the program pays. Commission is earned on furniture today (House quotes);
 * other product types are added to the copy only when their sales are tracked.
 */
export function partnerCopy(tier?: HolmTier | null) {
  const t = HOLM_PARTNERS.tiers;
  const rateBps = tier ? t[tier] : t.base;
  return {
    rateBps,
    rateLabel: tier ? `your ${pct(rateBps)} rate` : `the ${pct(rateBps)} starting rate`,
    range: `${pct(t.base)}–${pct(t.elite)}`,
    commissionHeadline: tier ? pct(rateBps) : `${pct(t.base)}–${pct(t.elite)}`,
    referralHeadline: dollars(HOLM_PARTNERS.referralCreditCents),
    referralLine: `credit when a business you refer is verified and pays an order of ${dollars(HOLM_PARTNERS.referralMinOrderCents)} or more`,
    // Short forms for the trade pass card, which has room for a few words; the footnote
    // carries the full conditions next to it.
    cardCommission: 'commission on House orders via your links',
    cardReferral: 'credit per business you refer*',
    referralFootnote: `*Once the business is verified and pays an order of ${dollars(HOLM_PARTNERS.referralMinOrderCents)} or more.`,
  };
}

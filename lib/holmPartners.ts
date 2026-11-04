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

/** The shape of a partner's referral code. */
export const REF_CODE = /^[A-Z0-9]{4,16}$/;

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
export const HOLM_TIER_ORDER: readonly HolmTier[] = ['base', 'active', 'top', 'elite'];

// ---------- rates by product type (spec section 5A) ----------
// Margins differ by what's sold, so each tier has a rate per product type. The furniture
// column is the original single rate (HOLM_PARTNERS.tiers).
export type ProductType = 'furniture' | 'decor' | 'clothing';
export const PRODUCT_TYPES: readonly ProductType[] = ['furniture', 'decor', 'clothing'];
export const HOLM_RATES: Record<HolmTier, Record<ProductType, number>> = {
  base: { furniture: HOLM_PARTNERS.tiers.base, decor: 800, clothing: 500 },
  active: { furniture: HOLM_PARTNERS.tiers.active, decor: 900, clothing: 600 },
  top: { furniture: HOLM_PARTNERS.tiers.top, decor: 1000, clothing: 700 },
  elite: { furniture: HOLM_PARTNERS.tiers.elite, decor: 1200, clothing: 800 },
};
/**
 * The product type that sets a line's rate. House and Ashcroft pieces are furniture (lighting
 * included); other storefront products go by their collection or category.
 */
export function productTypeFor(provider: string, category = '', collection = ''): ProductType {
  if (provider === 'ashcroft' || provider === 'owner_managed') return 'furniture';
  const text = `${collection} ${category}`.toLowerCase();
  // Whole words only, furniture first, so a dresser or a shoe cabinet stays furniture.
  if (/\b(furniture|sofas?|chairs?|tables?|dressers?|cabinets?|beds?|benches?|stools?|desks?|shelv(?:es|ing)|consoles?|sideboards?|nightstands?|lighting|lamps?)\b/.test(text)) return 'furniture';
  if (/\b(fashion|kids|cloth(?:es|ing)?|apparel|wear|dress(?:es)?|outfits?|rompers?|tops?|bottoms?|leggings?|footwear|shoes?)\b/.test(text)) return 'clothing';
  if (/\b(d[eé]cor|vases?|candles?|pillows?|throws?|rugs?|art|mirrors?|baskets?|tabletop|frames?)\b/.test(text)) return 'decor';
  return 'furniture';
}

/** Commission on a line never takes more than this share of our profit on it. */
export const MARGIN_GUARD_BPS = 4000;
/** Card processing on the order: 2.9% plus 30¢, shared across lines by value. */
export const CARD_FEE = { bps: 290, fixedCents: 30 } as const;

export type CommissionLineInput = {
  key: string;
  type: ProductType;
  /** Unit price the customer paid, in cents. */
  unitCents: number;
  quantity: number;
  /** Our landed cost for one unit (supplier, shipping, supplier fees), or null when unknown. */
  unitCostCents: number | null;
};
export type CommissionLine = {
  key: string;
  type: ProductType;
  baseCents: number;
  rateBps: number;
  amountCents: number;
  /** True when the margin guard lowered the amount. */
  capped: boolean;
  /** False when we had no cost for the line, so the base rate for its type was used. */
  costKnown: boolean;
};

/**
 * Commission on an order, line by line: the tier's rate for each line's product type, capped
 * so it never exceeds 40% of our profit on that line (price minus landed cost and that line's
 * share of card fees). A line with no known cost earns the base rate for its type.
 */
export function lineCommissions(lines: CommissionLineInput[], tier: HolmTier, otherChargesCents = 0) {
  const valid = lines.filter((l) => Number.isFinite(l.unitCents) && l.unitCents > 0 && Number.isInteger(l.quantity) && l.quantity > 0);
  const linesCents = valid.reduce((t, l) => t + l.unitCents * l.quantity, 0);
  // Card fees are charged on the whole payment (delivery and tax too); each line carries its share.
  const paymentCents = linesCents + Math.max(0, otherChargesCents || 0);
  const feeCents = linesCents ? (paymentCents * CARD_FEE.bps) / 10000 + CARD_FEE.fixedCents : 0;
  const out: CommissionLine[] = valid.map((l) => {
    const baseCents = l.unitCents * l.quantity;
    const costKnown = l.unitCostCents !== null && Number.isFinite(l.unitCostCents) && l.unitCostCents > 0;
    const rateBps = Math.min(HOLM_RATES[costKnown ? tier : 'base'][l.type], HOLM_PARTNERS.ceilingBps);
    const byRate = commissionCents(baseCents, rateBps);
    if (!costKnown) return { key: l.key, type: l.type, baseCents, rateBps, amountCents: byRate, capped: false, costKnown };
    const fee = (feeCents * baseCents) / linesCents;
    const profit = baseCents - l.unitCostCents! * l.quantity - fee;
    const cap = Math.max(0, Math.floor((profit * MARGIN_GUARD_BPS) / 10000));
    const amountCents = Math.min(byRate, cap);
    return { key: l.key, type: l.type, baseCents, rateBps, amountCents, capped: amountCents < byRate, costKnown };
  });
  return {
    lines: out,
    baseCents: out.reduce((t, l) => t + l.baseCents, 0),
    amountCents: out.reduce((t, l) => t + l.amountCents, 0),
  };
}


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

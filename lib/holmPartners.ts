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
  payoutMinCents: 5_000, // monthly payouts on the 15th once the cleared balance is $50 or more
  payoutDay: 15,
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
    // Rates by product type, from the rate table.
    ratesLine: tier
      ? `Your rates (${TIER_NAMES[tier]}): ${PRODUCT_TYPES.map((p) => `${pct(HOLM_RATES[tier][p])} ${TYPE_SHORT[p]}`).join(', ')}`
      : `Earn ${typeRange('furniture')} on furniture, ${typeRange('decor')} on home décor and ${typeRange('clothing')} on clothing`,
    // Only Ashcroft furniture can be bought on louiemae.com today; say so next to the décor and clothing rates.
    typesNote: 'Home décor and clothing earn commission as they become available to order on louiemae.com.',
    // Program numbers for copy, so pages can't drift from the rules.
    profitCap: pct(MARGIN_GUARD_BPS),
    attributionDays: HOLM_PARTNERS.attributionDays,
    clearingDays: HOLM_PARTNERS.clearingDays,
  };
}

export const TIER_NAMES: Record<HolmTier, string> = { base: 'Base', active: 'Active', top: 'Top', elite: 'Elite' };
const TYPE_SHORT: Record<ProductType, string> = { furniture: 'furniture', decor: 'décor', clothing: 'clothing' };
const TYPE_NAMES: Record<ProductType, string> = { furniture: 'Furniture', decor: 'Home décor', clothing: 'Clothing' };
const typeRange = (p: ProductType) => `${pct(HOLM_RATES.base[p])}–${pct(HOLM_RATES.elite[p])}`;

/** The 12-month attributed sales that start each tier, in cents (spec section 5). */
export const TIER_THRESHOLDS_CENTS: Record<HolmTier, number> = { base: 0, active: 1_500_000, top: 5_000_000, elite: 10_000_000 };

/** The tier that 12-month attributed sales (in cents) earn. */
export function tierForSales(salesCents: number): HolmTier {
  let tier: HolmTier = 'base';
  for (const t of HOLM_TIER_ORDER) if (salesCents >= TIER_THRESHOLDS_CENTS[t]) tier = t;
  return tier;
}
export const tierRank = (t: HolmTier) => HOLM_TIER_ORDER.indexOf(t);

/** How far a partner is from the next tier, for the Hub. */
export function tierProgress(tier: HolmTier, salesCents: number) {
  const next = HOLM_TIER_ORDER[tierRank(tier) + 1] ?? null;
  const toNextCents = next ? Math.max(0, TIER_THRESHOLDS_CENTS[next] - Math.max(0, salesCents)) : 0;
  return {
    next,
    toNextCents,
    line: next
      ? toNextCents > 0
        ? `${dollars(Math.ceil(toNextCents / 100) * 100)} more in sales to reach ${TIER_NAMES[next]}`
        : `${TIER_NAMES[next]} starts with your next order, once tonight's update runs`
      : 'Top of the program',
  };
}

/** Calendar quarter (UTC) of a moment, as a number that changes once a quarter. */
export const quarterOf = (t: number) => {
  const d = new Date(t);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
};

/** The rate table as rows for display: tier, the sales that start it, and its rate per product type. */
export function rateRows() {
  return HOLM_TIER_ORDER.map((tier, i) => {
    const next = HOLM_TIER_ORDER[i + 1];
    const from = dollars(TIER_THRESHOLDS_CENTS[tier]);
    return {
      tier,
      name: TIER_NAMES[tier],
      sales: next ? `${from}–${dollars(TIER_THRESHOLDS_CENTS[next] - 100)}` : `${from}+`,
      rates: PRODUCT_TYPES.map((p) => ({ type: p, label: TYPE_NAMES[p], rate: pct(HOLM_RATES[tier][p]) })),
    };
  });
}

/**
 * The partner terms (spec section 9), written from the program rules so the terms can't say
 * something the code doesn't do.
 */
export function partnerTerms() {
  const P = HOLM_PARTNERS;
  return [
    {
      title: 'Who can join',
      items: [
        'Anyone with a Louie Mae account can join: creators who share Louie Mae on their socials, blog or links, and verified trade businesses.',
        'We may pause or remove a partner account for misuse, such as misleading posts, buying through your own link or spam.',
      ],
    },
    {
      title: 'What you earn',
      items: [
        `Rates are set by your tier and the type of product: ${PRODUCT_TYPES.map((p) => `${TYPE_SHORT[p]} ${typeRange(p)}`).join(', ')}.`,
        `Your tier comes from attributed sales over the last 12 months: ${rateRows().map((r) => `${r.name} ${r.sales}`).join(', ')}.`,
        `Commission on any order line never exceeds ${MARGIN_GUARD_BPS / 100}% of our profit on that line (price minus supplier cost, shipping, supplier fees and card fees). This only lowers commission on low-margin items.`,
        'The rate is fixed for each order line when the order is paid.',
        'If we do not yet have our cost for an item, the Base rate for its product type applies and the profit limit is not used.',
        'Home décor and clothing earn commission as they become available to order on louiemae.com.',
      ],
    },
    {
      title: 'What counts',
      items: [
        `Paid orders at retail price, placed within ${P.attributionDays} days of a visit through your link. If someone visits through more than one partner's link, the most recent one counts.`,
        'Orders you place yourself, or for your own account, do not earn commission.',
        'Trade-priced orders do not earn commission.',
      ],
    },
    {
      title: 'Clearing, refunds and disputes',
      items: [
        `Commission is pending for ${P.clearingDays} days after payment, then clears.`,
        'A refund lowers the commission by the refunded share, and a disputed payment voids it. If the dispute is decided in our favour, the commission comes back.',
        'If a refund or dispute happens after you were paid, the amount comes off your next payout.',
      ],
    },
    {
      title: 'Payouts',
      items: [
        'Cleared commission is paid monthly, on the 15th, once your cleared balance is $50 or more. Smaller balances carry over to the next month.',
        'Payouts go by Stripe to the bank account you connect, or by another method we agree with you. We never see or store your bank details.',
      ],
    },
    {
      title: 'Store credit',
      items: [
        `You earn ${dollars(P.referralCreditCents)} in store credit when a business you refer is verified and pays an order of ${dollars(P.referralMinOrderCents)} or more.`,
        'Store credit has no cash value and does not expire.',
      ],
    },
    {
      title: 'Disclosure',
      items: [
        'Label every post that includes your link, for example "#ad" or "I earn a commission". The FTC requires this.',
      ],
    },
    {
      title: 'Tax',
      items: [
        'Commission is reported as nonemployee compensation on Form 1099-NEC when your payments for the year reach the federal reporting threshold. We need your tax details (a W-9, or the details Stripe collects) before we pay you.',
      ],
    },
  ];
}

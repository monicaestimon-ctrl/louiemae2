// House of Louie Mae trade pricing. All money is integer USD cents.
// Trade is retail less the trade discount, never below landed cost plus the margin floor,
// and never above retail. Project pricing adds a tiered discount on a project's trade
// subtotal, again never below each piece's floor.

export const HOLM_RULES = {
  tradeDiscountBps: 2500, // trade = retail − 25%
  minMarginBps: 2500, // no discount takes a piece below landed cost + 25% gross margin
  projectTiers: [
    { minCents: 1_000_000, bps: 300 }, // over $10,000 trade → extra 3%
    { minCents: 2_500_000, bps: 500 }, // over $25,000 trade → extra 5%
  ],
} as const;

export type HolmRules = {
  tradeDiscountBps: number;
  minMarginBps: number;
  projectTiers: readonly { minCents: number; bps: number }[];
};

/** Lowest unit price that keeps the margin floor. 0 when cost is unknown. */
export function floorCents(costCents: number, rules: HolmRules = HOLM_RULES) {
  if (!Number.isFinite(costCents) || costCents <= 0) return 0;
  return Math.ceil(costCents / (1 - rules.minMarginBps / 10000));
}

/** Trade unit price for one variant. */
export function tradeCents(retailCents: number, costCents: number, rules: HolmRules = HOLM_RULES) {
  if (!Number.isSafeInteger(retailCents) || retailCents <= 0) return 0;
  const listed = Math.round((retailCents * (10000 - rules.tradeDiscountBps)) / 10000);
  return Math.min(retailCents, Math.max(listed, floorCents(costCents, rules)));
}

/** The project tier a trade subtotal reaches, and the next tier to aim for. */
export function projectTier(tradeSubtotalCents: number, rules: HolmRules = HOLM_RULES) {
  const tiers = [...rules.projectTiers].sort((a, b) => a.minCents - b.minCents);
  let bps = 0;
  for (const t of tiers) if (tradeSubtotalCents >= t.minCents) bps = t.bps;
  const next = tiers.find((t) => tradeSubtotalCents < t.minCents) ?? null;
  return { bps, next };
}

export type PricedLine = { unitCents: number; quantity: number; floorCents: number };

/**
 * Applies project pricing to trade lines. The tier is set by the whole trade subtotal;
 * each line's unit price drops by up to the tier rate but never below its floor.
 */
export function applyProjectPricing(lines: PricedLine[], rules: HolmRules = HOLM_RULES) {
  const subtotal = lines.reduce((t, l) => t + l.unitCents * l.quantity, 0);
  const { bps, next } = projectTier(subtotal, rules);
  const units = lines.map((l) =>
    bps ? Math.max(l.floorCents, Math.round((l.unitCents * (10000 - bps)) / 10000)) : l.unitCents
  );
  const discounted = units.reduce((t, u, i) => t + u * lines[i].quantity, 0);
  return { units, bps, next, subtotalCents: subtotal, discountCents: subtotal - discounted };
}

/** Price a designer shows their client, from the designer's trade price. */
export function clientSellCents(
  retailCents: number,
  tradeUnitCents: number,
  show: 'cost' | 'markup' | 'retail',
  markupBps: number
) {
  if (show === 'cost') return tradeUnitCents;
  if (show === 'retail') return retailCents;
  return Math.round((tradeUnitCents * (10000 + markupBps)) / 10000);
}

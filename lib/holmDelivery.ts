// House of Louie Mae delivery. Supplier freight is built into each piece's cost (and so into
// the trade price floor); customers pay one flat delivery fee per order, tiered by subtotal.
// Money is integer USD cents.

/**
 * Supplier freight allowance per selling unit, by Ashcroft SKU prefix. From the October 2026
 * dealer pricing sheet (TX 77469 / FL 33331 samples, higher of the two). `OTT` covers both
 * benches and ottomans, so it takes the ottoman allowance.
 */
export const FREIGHT_BY_PREFIX: Record<string, number> = {
  SCH: 199_00, // swivel chairs
  LCH: 199_00, // lounge and arm chairs
  BEN: 119_00, // benches
  BWS: 119_00, // benches with storage
  OTT: 169_00, // ottomans
  DCH: 99_00, // dining chairs
  STL: 99_00, // stools
  DTB: 299_00, // dining tables
  PNL: 40_00, // pendants
  FLL: 40_00, // floor lamps
  SEC: 459_00, // sectionals
  MSC: 459_00, // modular sectionals
  CSC: 459_00, // corner sectionals
  SOF: 349_00, // sofas
  RSF: 349_00, // reclining sofas
  LVS: 349_00, // loveseats
};

/** Used when a SKU's prefix is not in the table; the admin pricing report flags these. */
export const DEFAULT_FREIGHT_CENTS = 199_00;

export function freightFor(sku: string) {
  const prefix = (sku.trim().toUpperCase().match(/^[A-Z]+/) || [''])[0];
  const known = prefix in FREIGHT_BY_PREFIX;
  return { cents: known ? FREIGHT_BY_PREFIX[prefix] : DEFAULT_FREIGHT_CENTS, known };
}

/** Flat delivery per order, by the order subtotal after trade and project pricing. */
export const DELIVERY_TIERS = [
  { underCents: 1_000_00, feeCents: 49_00 },
  { underCents: 2_500_00, feeCents: 79_00 },
  { underCents: 5_000_00, feeCents: 99_00 },
  { underCents: 10_000_00, feeCents: 129_99 },
  { underCents: 25_000_00, feeCents: 149_99 },
  { underCents: Infinity, feeCents: 199_99 },
] as const;

export function deliveryCents(subtotalCents: number) {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return DELIVERY_TIERS.find((t) => subtotalCents < t.underCents)!.feeCents;
}

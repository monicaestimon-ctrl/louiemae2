// Physical pieces, sellable packs and cartons are separate counts (spec S11, v2 §4, §11).
// A set of two chairs is always two physical pieces in cost, handling, allocation, MAP,
// cartons, price, inventory and customer copy.
import { CommerceError } from './errors';
import { divRound } from './money';

export type PackVariant = { piecesPerPack: number; orderMinimumPacks: number; orderIncrementPacks: number };
export type Carton = { cartonsPerPack: number; lengthMm: number; widthMm: number; heightMm: number; grossWeightG: number };

export function assertPackVariant(v: PackVariant) {
  for (const [k, x] of Object.entries(v)) if (!Number.isInteger(x) || x < 1) throw new CommerceError('INVALID_INPUT', `${k} must be a whole number of at least 1`);
}

export function physicalUnits(v: Pick<PackVariant, 'piecesPerPack'>, packs: number) {
  if (!Number.isInteger(packs) || packs < 0) throw new CommerceError('INVALID_INPUT', 'Quantity must be a whole number of packs');
  return v.piecesPerPack * packs;
}

/** Checks an ordered pack quantity against the minimum and increment. */
export function checkPackQuantity(v: PackVariant, packs: number) {
  if (!Number.isInteger(packs) || packs < 1) throw new CommerceError('INVALID_INPUT', 'Choose at least one');
  if (packs < v.orderMinimumPacks) throw new CommerceError('INVALID_INPUT', `The minimum order is ${v.orderMinimumPacks}`);
  if ((packs - v.orderMinimumPacks) % v.orderIncrementPacks !== 0) throw new CommerceError('INVALID_INPUT', `Order in steps of ${v.orderIncrementPacks}`);
}

/** Every physical carton for an order of `packs`, each listed separately (dimensions are never averaged). */
export function cartonsFor(cartons: readonly Carton[], packs: number): Carton[] {
  if (!cartons.length) throw new CommerceError('COST_REVIEW_REQUIRED', 'Carton data missing');
  const out: Carton[] = [];
  for (let p = 0; p < packs; p++) for (const c of cartons) for (let i = 0; i < c.cartonsPerPack; i++) out.push(c);
  return out;
}

/** Informational per-piece price; the pack price is the authoritative selling price. */
export const piecePriceInfo = (packPriceMinor: number, piecesPerPack: number) => Number(divRound(BigInt(packPriceMinor), BigInt(piecesPerPack), 'half_up'));

/** Customer-facing pack label: "Set of 2" for multi-piece packs. */
export const packLabel = (piecesPerPack: number) => (piecesPerPack > 1 ? `Set of ${piecesPerPack}` : '');

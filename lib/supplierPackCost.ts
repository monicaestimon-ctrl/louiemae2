import { cmp, minorRat, mul, parseDecimal, rat, toMinor } from './decimal';
import { CommerceError } from './errors';

type PieceCost = { wholesaleMinor: number | null; wholesalePrecise?: string };

/** Supplier source prices are per piece. Round only after converting to a selling pack. */
export function supplierPackCostMinor(
  cost: PieceCost | null,
  piecesPerPack: number
): number | null {
  if (!Number.isSafeInteger(piecesPerPack) || piecesPerPack < 1)
    throw new CommerceError('INVALID_INPUT', 'Invalid supplier pack basis');
  if (!cost) return null;
  if (cost.wholesalePrecise === undefined && cost.wholesaleMinor === null) return null;
  if (cost.wholesalePrecise === undefined && !Number.isSafeInteger(cost.wholesaleMinor))
    throw new CommerceError('INVALID_INPUT', 'Invalid supplier piece cost');
  const piece =
    cost.wholesalePrecise !== undefined
      ? mul(parseDecimal(cost.wholesalePrecise), rat(100))
      : minorRat(cost.wholesaleMinor!);
  if (cmp(piece, rat(0)) < 0) throw new CommerceError('INVALID_INPUT', 'Negative supplier cost');
  return toMinor(mul(piece, rat(piecesPerPack)), 'half_up');
}

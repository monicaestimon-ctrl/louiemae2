import type { Doc } from './_generated/dataModel';
import { cmp, mul, parseDecimal, rat, toMinor } from '../lib/decimal';

/** Structural cost integrity is independent of approval/freshness and never infers zero. */
export function costIntegrityIssue(cost: Doc<'catCostRevisions'> | null, variant: Doc<'catVariants'>, now: number): string | null {
  if (!cost || cost.variantId !== variant._id) return 'Current cost must belong to this variant';
  if (cost.currency !== 'USD' || !Number.isSafeInteger(cost.wholesaleMinor) || cost.wholesaleMinor! <= 0)
    return 'Wholesale requires a positive whole-cent USD amount';
  if (!Number.isSafeInteger(cost.effectiveFrom) || cost.effectiveFrom > now ||
    (cost.effectiveTo !== undefined && (!Number.isSafeInteger(cost.effectiveTo) || cost.effectiveTo <= now)))
    return 'Cost effective period is not current';
  for (const amount of [cost.dutiesMinor, cost.inboundFreightMinor, cost.supplierFeesMinor])
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) return 'Expenses require nonnegative whole cents';
  if (cost.wholesalePrecise !== undefined) {
    try {
      const precise = mul(parseDecimal(cost.wholesalePrecise), rat(100));
      if (cmp(precise, rat(0)) <= 0 || ![toMinor(precise, 'ceil'), toMinor(precise, 'half_up')].includes(cost.wholesaleMinor!))
        return 'Precise wholesale conflicts with its stored cents';
    } catch { return 'Precise wholesale is invalid'; }
  }
  if (cost.mapMinor !== null && (!Number.isSafeInteger(cost.mapMinor) || cost.mapMinor < 0)) return 'MAP requires nonnegative whole cents';
  if (cost.mapApplicability === 'applies' && (cost.mapMinor === null || cost.mapMinor <= 0))
    return 'Applicable MAP requires a positive whole-cent amount';
  for (const quantity of [variant.piecesPerPack, variant.orderMinimumPacks, variant.orderIncrementPacks])
    if (!Number.isSafeInteger(quantity) || quantity < 1) return 'Pack basis requires positive whole quantities';
  return null;
}

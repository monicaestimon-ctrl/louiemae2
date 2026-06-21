export type PricingStage =
  | 'source_estimate'
  | 'cj_catalog_confirmed'
  | 'cj_freight_confirmed'
  | 'manual_locked'
  | 'order_reconciled';

export type CollectionShippingMap = Record<string, number>;

export type PricingFees = {
  serviceFee?: number;
  taxesFee?: number;
  clearanceFee?: number;
  remoteFee?: number;
  otherFee?: number;
};

export type PricingBreakdown = {
  productCost: number;
  shippingCost: number;
  serviceFee: number;
  taxesFee: number;
  clearanceFee: number;
  remoteFee: number;
  otherFee: number;
  landedCost: number;
  retailMultiplier: number;
  suggestedRetailPrice: number;
  currentRetailPrice: number;
  estimatedProfit: number;
  marginPercent: number;
  pricingSource: PricingStage;
  warnings: string[];
};

export const DEFAULT_RETAIL_MULTIPLIER = 3;
export const ESTIMATED_CJ_COST_MULTIPLIER = 1.4;

export const DEFAULT_COLLECTION_SHIPPING: CollectionShippingMap = {
  fashion: 8,
  kids: 8,
  decor: 12,
  furniture: 22,
  default: 10,
};

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

const roundNonNegativeMoney = (value: number | undefined): number => {
  return roundMoney(Math.max(0, value || 0));
};

export const getEstimatedShipping = (
  collection: string | undefined,
  shippingMap: CollectionShippingMap = DEFAULT_COLLECTION_SHIPPING,
): number => {
  const key = (collection || '').trim().toLowerCase();
  return shippingMap[key] ?? shippingMap.default ?? 10;
};

export const charmRoundTo99 = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundMoney(Math.ceil(value) - 0.01);
};

export const calculateEstimatedCjProductCost = (sourcePriceUsd: number): number => {
  return roundMoney(Math.max(0, sourcePriceUsd || 0) * ESTIMATED_CJ_COST_MULTIPLIER);
};

export const calculateLandedCost = (
  productCost: number,
  shippingCost: number,
  fees: PricingFees = {},
): number => {
  return roundMoney(
    Math.max(0, productCost || 0) +
      Math.max(0, shippingCost || 0) +
      Math.max(0, fees.serviceFee || 0) +
      Math.max(0, fees.taxesFee || 0) +
      Math.max(0, fees.clearanceFee || 0) +
      Math.max(0, fees.remoteFee || 0) +
      Math.max(0, fees.otherFee || 0),
  );
};

export const calculateRetailFromLandedCost = (
  landedCost: number,
  retailMultiplier = DEFAULT_RETAIL_MULTIPLIER,
): number => {
  return charmRoundTo99(Math.max(0, landedCost || 0) * retailMultiplier);
};

export const calculatePricingBreakdown = (args: {
  sourcePriceUsd?: number;
  collection?: string;
  confirmedProductCost?: number;
  confirmedShippingCost?: number;
  fees?: PricingFees;
  currentRetailPrice?: number;
  adminLockedPrice?: boolean;
  retailMultiplier?: number;
  pricingSource?: PricingStage;
}): PricingBreakdown => {
  const warnings: string[] = [];
  const hasConfirmedProductCost = Number.isFinite(args.confirmedProductCost);
  const hasConfirmedShippingCost = Number.isFinite(args.confirmedShippingCost);
  const productCost = hasConfirmedProductCost
    ? roundMoney(args.confirmedProductCost ?? 0)
    : calculateEstimatedCjProductCost(args.sourcePriceUsd ?? 0);
  const shippingCost = hasConfirmedShippingCost
    ? roundMoney(args.confirmedShippingCost ?? 0)
    : getEstimatedShipping(args.collection);

  if (!hasConfirmedProductCost) {
    warnings.push('CJ product cost is estimated until catalog pricing is confirmed.');
  }
  if (!hasConfirmedShippingCost) {
    warnings.push('CJ shipping is estimated until freight is confirmed.');
  }

  const landedCost = calculateLandedCost(productCost, shippingCost, args.fees);
  const retailMultiplier = args.retailMultiplier ?? DEFAULT_RETAIL_MULTIPLIER;
  const suggestedRetailPrice = calculateRetailFromLandedCost(landedCost, retailMultiplier);
  const currentRetailPrice = roundMoney(args.currentRetailPrice ?? suggestedRetailPrice);
  const estimatedProfit = roundMoney(currentRetailPrice - landedCost);
  const marginPercent = currentRetailPrice > 0
    ? roundMoney((estimatedProfit / currentRetailPrice) * 100)
    : 0;

  if (args.adminLockedPrice && Math.abs(currentRetailPrice - suggestedRetailPrice) >= 0.01) {
    warnings.push('Admin price is locked; suggested CJ price was not applied automatically.');
  }

  return {
    productCost,
    shippingCost,
    serviceFee: roundNonNegativeMoney(args.fees?.serviceFee),
    taxesFee: roundNonNegativeMoney(args.fees?.taxesFee),
    clearanceFee: roundNonNegativeMoney(args.fees?.clearanceFee),
    remoteFee: roundNonNegativeMoney(args.fees?.remoteFee),
    otherFee: roundNonNegativeMoney(args.fees?.otherFee),
    landedCost,
    retailMultiplier,
    suggestedRetailPrice,
    currentRetailPrice,
    estimatedProfit,
    marginPercent,
    pricingSource: args.pricingSource ?? (hasConfirmedShippingCost ? 'cj_freight_confirmed' : hasConfirmedProductCost ? 'cj_catalog_confirmed' : 'source_estimate'),
    warnings,
  };
};

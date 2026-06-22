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

export type OrderPricingItem = {
  quantity: number;
  productCost?: number;
  estimatedShippingCost?: number;
  retailPrice?: number;
};

export type OrderPricingReconciliation = {
  productCostTotal: number;
  estimatedShippingTotal: number;
  shippingCost: number;
  taxesFee: number;
  clearanceFee: number;
  landedCost: number;
  customerShippingCollected: number;
  retailSubtotal: number;
  estimatedProfit: number;
  warnings: string[];
};

export type CheckoutShippingTier = {
  minSubtotal: number;
  maxSubtotal?: number;
  amount: number;
  label: string;
};

export const DEFAULT_RETAIL_MULTIPLIER = 3;
export const ESTIMATED_CJ_COST_MULTIPLIER = 1.4;

export const DEFAULT_COLLECTION_SHIPPING: CollectionShippingMap = {
  fashion: 22,
  kids: 22,
  decor: 69.99,
  furniture: 120,
  default: 22,
};

export const CHECKOUT_SHIPPING_TIERS: CheckoutShippingTier[] = [
  { minSubtotal: 0, maxSubtotal: 199.99, amount: 49.99, label: 'Standard Shipping' },
  { minSubtotal: 200, maxSubtotal: 348.99, amount: 69.99, label: 'Standard Shipping' },
  { minSubtotal: 349, maxSubtotal: 499.99, amount: 89.99, label: 'Standard Shipping' },
  { minSubtotal: 500, amount: 99.99, label: 'Standard Shipping' },
];

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
  return shippingMap[key] ?? shippingMap.default ?? 22;
};

export const getCheckoutShippingForSubtotal = (
  subtotal: number,
  tiers: CheckoutShippingTier[] = CHECKOUT_SHIPPING_TIERS,
): CheckoutShippingTier => {
  const safeSubtotal = Math.max(0, Number.isFinite(subtotal) ? subtotal : 0);
  const tier = tiers.find((candidate) => {
    const isAtOrAboveMin = safeSubtotal >= candidate.minSubtotal;
    const isBelowMax = candidate.maxSubtotal === undefined || safeSubtotal <= candidate.maxSubtotal;
    return isAtOrAboveMin && isBelowMax;
  });

  return tier ?? tiers[0] ?? { minSubtotal: 0, amount: 49.99, label: 'Standard Shipping' };
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

export const calculateOrderPricingReconciliation = (args: {
  items: OrderPricingItem[];
  quotedShippingCost?: number;
  quotedTaxesFee?: number;
  quotedClearanceFee?: number;
  customerShippingCollected?: number;
  orderSubtotal?: number;
  freightQuoteAvailable: boolean;
}): OrderPricingReconciliation => {
  const productCostTotal = roundMoney(args.items.reduce((total, item) =>
    total + Math.max(0, item.productCost ?? 0) * Math.max(0, item.quantity), 0));
  const estimatedShippingTotal = roundMoney(args.items.reduce((total, item) =>
    total + Math.max(0, item.estimatedShippingCost ?? 0) * Math.max(0, item.quantity), 0));
  const shippingCost = roundNonNegativeMoney(args.quotedShippingCost);
  const taxesFee = roundNonNegativeMoney(args.quotedTaxesFee);
  const clearanceFee = roundNonNegativeMoney(args.quotedClearanceFee);
  const landedCost = roundMoney(productCostTotal + shippingCost + taxesFee + clearanceFee);
  const retailSubtotal = roundMoney(args.orderSubtotal ?? args.items.reduce((total, item) =>
    total + Math.max(0, item.retailPrice ?? 0) * Math.max(0, item.quantity), 0));
  const customerShippingCollected = roundNonNegativeMoney(args.customerShippingCollected);
  const estimatedProfit = roundMoney(retailSubtotal + customerShippingCollected - landedCost);
  const warnings: string[] = [];

  if (!args.freightQuoteAvailable) {
    warnings.push('CJ freight quote was unavailable before order forwarding.');
  }
  if (args.items.some(item => item.productCost === undefined)) {
    warnings.push('One or more CJ product costs were missing; order profit may be understated.');
  }
  if (args.quotedShippingCost !== undefined && estimatedShippingTotal > 0 && args.quotedShippingCost > estimatedShippingTotal * 1.25) {
    warnings.push('Actual destination freight is more than 25% above product-level shipping assumptions.');
  }

  return {
    productCostTotal,
    estimatedShippingTotal,
    shippingCost,
    taxesFee,
    clearanceFee,
    landedCost,
    customerShippingCollected,
    retailSubtotal,
    estimatedProfit,
    warnings,
  };
};

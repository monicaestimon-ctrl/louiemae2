import { calculateRetailFromProductCost } from './pricing';

export type CjPriceQuote = {
  vid: string;
  sku: string;
  name: string;
  itemCost?: number;
  shippingCost?: number;
  taxesFee?: number;
  clearanceFee?: number;
  logisticsName?: string;
  origin?: string;
  error?: string;
};
export type CjPricingReview = {
  cjProductId: string;
  checkedAt: number;
  destination: string;
  quantity: number;
  quotes: CjPriceQuote[];
};
export type CjPricedProduct = {
  price?: number;
  cjProductId?: string;
  cjSourcingStatus?: string;
  sourceUrl?: string;
  cjSourcingJobId?: string;
  cjSourcingState?: string;
  cjPricingError?: string;
  cjVariantId?: string;
  cjSku?: string;
  cjPricingReview?: CjPricingReview;
  variants?: Array<{
    id: string;
    name: string;
    inStock: boolean;
    cjVariantId?: string;
    cjSku?: string;
    priceAdjustment: number;
  }>;
};
export const cjListingUrl = (pid: string) =>
  `https://cjdropshipping.com/product/-p-${encodeURIComponent(pid)}.html`;
export const cjMoney = (value: unknown): number | undefined => {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === ''
  )
    return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};
export const quoteComplete = (q: CjPriceQuote) =>
  !q.error &&
  (cjMoney(q.itemCost) ?? 0) > 0 &&
  cjMoney(q.shippingCost) !== undefined &&
  [q.taxesFee, q.clearanceFee].every((f) => f === undefined || cjMoney(f) !== undefined) &&
  Boolean(q.logisticsName && q.origin);
export const quoteLanded = (q: CjPriceQuote) =>
  (q.itemCost ?? 0) + (q.shippingCost ?? 0) + (q.taxesFee ?? 0) + (q.clearanceFee ?? 0);
export const quoteRetail = (q: CjPriceQuote) =>
  calculateRetailFromProductCost(q.itemCost ?? 0, q.shippingCost ?? 0, {
    taxesFee: q.taxesFee,
    clearanceFee: q.clearanceFee,
  });
export const pricingSelections = (p: CjPricedProduct) =>
  p.variants?.length
    ? p.variants
        .filter((v) => v.inStock !== false)
        .map((v) => ({ ...v, retail: (p.price ?? 0) + v.priceAdjustment }))
    : [
        {
          id: 'base',
          name: 'Default',
          cjVariantId: p.cjVariantId,
          cjSku: p.cjSku,
          retail: p.price ?? 0,
        },
      ];
export const pricingFingerprint = (p: CjPricedProduct) =>
  JSON.stringify({
    pid: p.cjProductId,
    price: p.price,
    variants: p.variants,
    vid: p.cjVariantId,
    sku: p.cjSku,
  });

export function cjPricingBlocks(p: CjPricedProduct, now = Date.now()): string[] {
  if (
    !p.cjProductId &&
    !p.cjVariantId &&
    !p.cjSku &&
    !p.cjSourcingJobId &&
    !p.cjSourcingState &&
    (!p.cjSourcingStatus || p.cjSourcingStatus === 'none') &&
    !p.variants?.some((v) => v.cjVariantId || v.cjSku)
  )
    return [];
  const review = p.cjPricingReview;
  if (p.cjPricingError) return [`CJ price check failed: ${p.cjPricingError}`];
  if (!review || review.cjProductId !== p.cjProductId)
    return ['Refresh CJ prices and shipping before publishing.'];
  if (review.checkedAt > now || now - review.checkedAt > 24 * 60 * 60 * 1000)
    return ['CJ quotes are over 24 hours old. Refresh before publishing.'];
  if (review.destination !== 'US' || review.quantity !== 1)
    return ['Pricing requires a one-unit U.S. shipping estimate.'];
  const selected = pricingSelections(p);
  if (!selected.length) return ['No sellable variants are selected.'];
  return selected.flatMap((v) => {
    const q = review.quotes.find((q) => q.vid === v.cjVariantId && q.sku === v.cjSku);
    if (!q || !quoteComplete(q))
      return [`${v.name}: confirmed CJ item cost and shipping are required.`];
    if (!Number.isFinite(v.retail) || Math.round(v.retail * 100) < Math.round(quoteRetail(q) * 100))
      return [
        `${v.name}: retail must be at least $${quoteRetail(q).toFixed(2)} under the current pricing rule.`,
      ];
    return [];
  });
}
export function assertCjPricingReady(p: CjPricedProduct) {
  const reasons = cjPricingBlocks(p);
  if (reasons.length) throw new Error(reasons.join(' '));
}

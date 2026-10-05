import type { Doc } from '../convex/_generated/dataModel';

type QueueProduct = Pick<Doc<'products'>, 'cjSourcingStatus' | 'cjSourcingState' | 'cjSourcingJobId' | 'cjProductId' | 'cjVariantId' | 'cjSku' | 'cjVariants' | 'variants' | 'cjFulfillmentReadiness'>;

export type CjQueueFilter = 'all' | 'ready' | 'needs_attention' | 'awaiting_approval' | 'unmapped' | 'missing_customer' | 'missing_cj';
export function matchesCjQueueFilter(issues: string[], filter: CjQueueFilter) {
  if (filter === 'all') return true;
  if (filter === 'ready') return issues.includes('READY');
  if (filter === 'needs_attention') return !issues.includes('READY');
  if (filter === 'awaiting_approval') return issues.some(code => ['CJ_APPROVAL_PENDING', 'CJ_REJECTED', 'CJ_NOT_APPROVED'].includes(code));
  if (filter === 'unmapped') return issues.some(code => ['UNMAPPED_CUSTOMER_VARIANTS', 'INVALID_CJ_MAPPINGS', 'DUPLICATE_CJ_MAPPINGS'].includes(code));
  return issues.includes(filter === 'missing_customer' ? 'MISSING_CUSTOMER_VARIANTS' : 'MISSING_CJ_VARIANTS');
}

// Keep each value separate: joining values introduces cross-field matches.
// All options remain searchable, including those beyond list display limits.
export function cjQueueSearchValues(product: Doc<'products'>) {
  return [...new Set([product.name, product.cjProductId, product.sourceUrl,
    ...(product.variants ?? []).flatMap(variant => [variant.name, variant.cjSku, variant.cjVariantId]),
    ...(product.cjVariants ?? []).flatMap(variant => [variant.name, variant.sku, variant.vid]),
  ].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()))];
}

export const hasCjVariantQueueFootprint = (product: QueueProduct) => Boolean(
  (product.cjSourcingStatus && product.cjSourcingStatus !== 'none') || product.cjSourcingJobId
  || product.cjProductId || product.cjVariantId || product.cjSku || (product.cjVariants?.length ?? 0) > 0,
);

// Shared with the legacy queue and selected detail endpoint. Preserve existing
// issue order, treatment of out-of-stock options and duplicate/invalid mappings.
export function getCjVariantMappingSummary(product: QueueProduct) {
  const customerVariants = product.variants ?? [];
  const providerVariants = product.cjVariants ?? [];
  const providerById = new Map(providerVariants.map(variant => [variant.vid, variant]));
  const mappedVariants = customerVariants.filter(variant => variant.cjVariantId && variant.cjSku);
  const unmappedVariants = customerVariants.filter(variant => variant.inStock !== false && (!variant.cjVariantId || !variant.cjSku));
  const invalidMappings = mappedVariants.filter(variant => {
    const provider = providerById.get(variant.cjVariantId!);
    return !provider || provider.sku !== variant.cjSku;
  });
  const mappedIds = mappedVariants.map(variant => variant.cjVariantId!);
  const duplicateMappingCount = mappedIds.length - new Set(mappedIds).size;
  const issueCodes: string[] = [];
  if (product.cjSourcingStatus === 'pending') issueCodes.push('CJ_APPROVAL_PENDING');
  if (product.cjSourcingStatus === 'rejected') issueCodes.push('CJ_REJECTED');
  if (!product.cjSourcingStatus || product.cjSourcingStatus === 'none') issueCodes.push('CJ_NOT_APPROVED');
  if (product.cjSourcingStatus === 'approved' && !product.cjProductId) issueCodes.push('MISSING_CJ_PRODUCT_ID');
  if (product.cjSourcingStatus === 'approved' && providerVariants.length === 0) issueCodes.push('MISSING_CJ_VARIANTS');
  if (providerVariants.length > 1 && customerVariants.length === 0) issueCodes.push('MISSING_CUSTOMER_VARIANTS');
  if (unmappedVariants.length > 0) issueCodes.push('UNMAPPED_CUSTOMER_VARIANTS');
  if (invalidMappings.length > 0) issueCodes.push('INVALID_CJ_MAPPINGS');
  if (duplicateMappingCount > 0) issueCodes.push('DUPLICATE_CJ_MAPPINGS');
  if (product.cjSourcingState === 'reconciliation_required') issueCodes.push('RECONCILIATION_REQUIRED');
  if (product.cjSourcingState === 'needs_input') issueCodes.push('NEEDS_INPUT');
  if (issueCodes.length === 0 && product.cjSourcingStatus === 'approved' && product.cjSourcingState === 'fulfillment_ready' && product.cjFulfillmentReadiness === 'ready') issueCodes.push('READY');
  return { issueCodes, customerVariantCount: customerVariants.length, mappedVariantCount: mappedVariants.length,
    unmappedVariantCount: unmappedVariants.length, cjVariantCount: providerVariants.length,
    unmatchedCjVariantCount: Math.max(0, providerVariants.length - new Set(mappedIds).size),
    invalidMappingCount: invalidMappings.length + duplicateMappingCount };
}

export function compareCjVariantQueueRows(left: { mappingSummary: ReturnType<typeof getCjVariantMappingSummary> }, right: { mappingSummary: ReturnType<typeof getCjVariantMappingSummary> }) {
  const leftReady = left.mappingSummary.issueCodes.includes('READY') ? 1 : 0;
  const rightReady = right.mappingSummary.issueCodes.includes('READY') ? 1 : 0;
  return leftReady !== rightReady ? leftReady - rightReady : right.mappingSummary.unmappedVariantCount - left.mappingSummary.unmappedVariantCount;
}

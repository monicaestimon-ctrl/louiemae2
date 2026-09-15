import type { Product } from '../types';

export type CjProductConnectionState =
  | 'not_linked'
  | 'pending'
  | 'rejected'
  | 'approved_needs_setup'
  | 'ready'
  | 'attention';

export type CjProductStatus = {
  state: CjProductConnectionState;
  label: string;
  detail: string;
  isApproved: boolean;
  isCatalogLinked: boolean;
  isMappingComplete: boolean;
  mappedVariantCount: number;
  sellableVariantCount: number;
};

const hasValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const pendingStates = new Set([
  'queued',
  'submitting',
  'submitted',
  'processing',
  'awaiting_catalog',
  'retry_wait',
]);

const rejectedStates = new Set(['rejected', 'dead_letter', 'canceled']);

export const getCjProductStatus = (product: Pick<Product,
  | 'cjSourcingStatus'
  | 'cjSourcingState'
  | 'cjFulfillmentReadiness'
  | 'cjSourcingJobId'
  | 'cjProductId'
  | 'cjVariantId'
  | 'cjSku'
  | 'cjVariants'
  | 'variants'
>): CjProductStatus => {
  const sellableVariants = (product.variants ?? []).filter((variant) => variant.inStock !== false);
  const mappedVariantCount = sellableVariants.filter((variant) => hasValue(variant.cjVariantId) && hasValue(variant.cjSku)).length;
  const hasCustomerVariants = (product.variants?.length ?? 0) > 0;
  const isMappingComplete = hasCustomerVariants
    ? sellableVariants.length > 0 && mappedVariantCount === sellableVariants.length
    : hasValue(product.cjVariantId) && hasValue(product.cjSku);
  const isCatalogLinked = hasValue(product.cjProductId) && (
    (product.cjVariants?.length ?? 0) > 0 || (!hasCustomerVariants && isMappingComplete)
  );
  const isApproved = product.cjSourcingStatus === 'approved';
  const hasCjFootprint = Boolean(
    (product.cjSourcingStatus && product.cjSourcingStatus !== 'none') ||
    product.cjSourcingJobId ||
    product.cjSourcingState ||
    product.cjProductId ||
    product.cjVariantId ||
    product.cjSku ||
    (product.cjVariants?.length ?? 0) > 0
  );
  const base = {
    isApproved,
    isCatalogLinked,
    isMappingComplete,
    mappedVariantCount,
    sellableVariantCount: sellableVariants.length,
  };

  if (!hasCjFootprint) {
    return { ...base, state: 'not_linked', label: 'CJ not linked', detail: 'Not submitted or connected to a CJ catalog product.' };
  }
  if (product.cjSourcingStatus === 'rejected' || rejectedStates.has(product.cjSourcingState ?? '')) {
    return { ...base, state: 'rejected', label: 'CJ rejected', detail: 'CJ sourcing was rejected or canceled; it is not ready for mapping.' };
  }
  if (product.cjSourcingStatus === 'pending' || pendingStates.has(product.cjSourcingState ?? '')) {
    return { ...base, state: 'pending', label: 'CJ approval pending', detail: 'Submitted to CJ; catalog linkage and mapping are not approved yet.' };
  }
  if (isApproved) {
    const workflowReady = product.cjSourcingState === 'fulfillment_ready' && product.cjFulfillmentReadiness === 'ready';
    if (workflowReady && isCatalogLinked && isMappingComplete) {
      return { ...base, state: 'ready', label: 'CJ synced & ready', detail: 'Approved by CJ, catalog-linked, and fully mapped for fulfillment.' };
    }
    return {
      ...base,
      state: 'approved_needs_setup',
      label: 'CJ approved · setup needed',
      detail: !isCatalogLinked
        ? 'CJ approved this product, but its catalog product or variants are not fully linked.'
        : !isMappingComplete
          ? 'CJ approved and linked this product; one or more sellable variants still need mapping.'
          : 'CJ approved and mapped this product; the fulfillment workflow has not reached ready status.',
    };
  }
  return { ...base, state: 'attention', label: 'CJ link needs review', detail: 'CJ identifiers exist, but there is no confirmed sourcing approval.' };
};

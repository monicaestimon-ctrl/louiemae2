import type { Doc } from '../convex/_generated/dataModel';
import { isCjProductStorefrontReady } from './cjFulfillmentReadiness';
import { cjQueueSearchValues, getCjVariantMappingSummary, hasCjVariantQueueFootprint } from './cjVariantQueue';
import { getCjProductStatus } from './cjProductStatus';

export const CATALOG_VERSION = 4;
export const MAX_INLINE_ADMIN_SEARCH_LENGTH = 16_000;

export function adminCatalogSearchText(product: Doc<'products'>, status = getCjProductStatus(product)) {
  return [product.name, product.description, product.category, product.collection,
    product.sourceUrl, product.cjProductId, product.cjVariantId, product.cjSku, status.label, status.detail,
    ...(product.variants ?? []).flatMap(variant => [variant.name, variant.cjVariantId, variant.cjSku]),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function isCatalogProductPublic(product: Doc<'products'>) {
  return (!product.storefrontStatus || product.storefrontStatus === 'published')
    && isCjProductStorefrontReady(product)
    && product.inStock !== false && product.cjInventoryStatus !== 'out_of_stock';
}

// Explicit allowlist: supplier payloads, raw HTML, generation evidence, and
// description audits must never be copied into a public response.
export function publicCatalogProduct(product: Doc<'products'>) {
  return {
    _id: product._id, _creationTime: product._creationTime,
    name: product.name, price: product.price,
    descriptionExcerpt: product.description.slice(0, 2000),
    descriptionTruncated: product.description.length > 2000,
    images: product.images.slice(0, 24), category: product.category,
    imageCount: product.images.filter(Boolean).length, variantCount: product.variants?.length ?? 0,
    collection: product.collection, subcategory: product.subcategory,
    subcategoryIds: product.subcategoryIds, primarySubcategoryId: product.primarySubcategoryId,
    isNew: product.isNew, inStock: product.inStock, publishedAt: product.publishedAt,
    storefrontStatus: product.storefrontStatus,
    variants: product.variants?.slice(0, 100).map(variant => ({
      id: variant.id, name: variant.name, image: variant.image,
      priceAdjustment: variant.priceAdjustment, inStock: variant.inStock,
    })),
  };
}

// The row contains only information used by list/status screens. Editors and
// variant mapping continue to fetch the authoritative product by ID.
export function adminCatalogProduct(product: Doc<'products'>) {
  return {
    sourceUrl: product.sourceUrl, productRevision: product.productRevision,
    cjSourcingStatus: product.cjSourcingStatus, cjSourcingState: product.cjSourcingState,
    cjFulfillmentReadiness: product.cjFulfillmentReadiness,
    cjSourcingJobId: product.cjSourcingJobId, cjSourcingId: product.cjSourcingId,
    cjSubmittedAt: product.cjSubmittedAt, cjApprovedAt: product.cjApprovedAt,
    cjSourcingError: product.cjSourcingError,
    cjProductId: product.cjProductId, cjVariantId: product.cjVariantId, cjSku: product.cjSku,
    cjInventoryStatus: product.cjInventoryStatus, cjInventoryTotal: product.cjInventoryTotal,
    cjInventoryLastCheckedAt: product.cjInventoryLastCheckedAt,
    cjInventoryNeedsReview: product.cjInventoryNeedsReview,
    cjInventoryReviewReason: product.cjInventoryReviewReason,
    launchBatchId: product.launchBatchId, launchAddedAt: product.launchAddedAt, launchedAt: product.launchedAt,
    imageCount: product.images.filter(Boolean).length,
    variantImageCount: product.variants?.filter(variant => Boolean(variant.image)).length ?? 0,
    connectionStatus: getCjProductStatus(product),
    mappingSummary: getCjVariantMappingSummary(product),
  };
}

export function catalogProjection(product: Doc<'products'>) {
  const adminData = adminCatalogProduct(product);
  const mapping = adminData.mappingSummary;
  const published = product.publishedAt ? Date.parse(product.publishedAt) : NaN;
  const adminSearch = adminCatalogSearchText(product, adminData.connectionStatus);
  const adminSearchNeedsDetail = adminSearch.length > MAX_INLINE_ADMIN_SEARCH_LENGTH;
  return {
    productId: product._id, version: CATALOG_VERSION,
    productCreatedAt: product._creationTime,
    name: product.name, collection: product.collection, category: product.category,
    price: product.price, featuredPriority: product.isNew ? 0 : 1,
    arrivalKind: product.publishedAt ? (Number.isFinite(published) ? 'dated' : 'none') : product.isNew ? 'legacy' : 'none',
    arrivalOrder: Number.isFinite(published) ? -published : 0,
    connectionState: adminData.connectionStatus.state,
    // Oversized text is searched from bounded authoritative records on explicit
    // searches only, rather than duplicating a near-limit source into this row.
    adminSearchText: adminSearchNeedsDetail ? '' : adminSearch, adminSearchNeedsDetail,
    visible: isCatalogProductPublic(product),
    sourcingStatus: product.cjSourcingStatus ?? 'none',
    inVariantQueue: hasCjVariantQueueFootprint(product),
    queueReady: mapping.issueCodes.includes('READY') ? 1 : 0,
    queueUnmappedOrder: -mapping.unmappedVariantCount,
    queueSearchValues: cjQueueSearchValues(product),
    approvedAt: product.cjApprovedAt ?? '',
    searchText: [product.name, product.description, product.category, product.collection,
      product.subcategory, ...(product.subcategoryIds ?? [])].filter(Boolean).join(' ').toLowerCase().slice(0, 8000),
    publicData: publicCatalogProduct(product), adminData,
  };
}

// Convex omits undefined object fields. Normalize that representation when
// comparing projections so telemetry-only product writes do not invalidate lists.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
export const sameCatalogValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

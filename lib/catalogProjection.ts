import type { Doc } from '../convex/_generated/dataModel';
import { isCjProductStorefrontReady } from './cjFulfillmentReadiness';

export const CATALOG_VERSION = 1;

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
    name: product.name, price: product.price, description: product.description,
    images: product.images.slice(0, 24), category: product.category,
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
    ...publicCatalogProduct(product),
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
    launchBatchId: product.launchBatchId, launchedAt: product.launchedAt,
  };
}

export function catalogProjection(product: Doc<'products'>) {
  return {
    productId: product._id, version: CATALOG_VERSION,
    productCreatedAt: product._creationTime,
    name: product.name, collection: product.collection, category: product.category,
    visible: isCatalogProductPublic(product),
    sourcingStatus: product.cjSourcingStatus ?? 'none',
    approvedAt: product.cjApprovedAt ?? '',
    searchText: [product.name, product.description, product.category, product.collection,
      product.subcategory, ...(product.subcategoryIds ?? [])].filter(Boolean).join(' ').toLowerCase().slice(0, 8000),
    publicData: publicCatalogProduct(product), adminData: adminCatalogProduct(product),
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

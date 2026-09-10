import type { SourceProduct, CollectionType } from '../types';
export interface ImportableProduct extends SourceProduct {
    batchItemId?: string;
    sourceSnapshotId?: import('../convex/_generated/dataModel').Id<'productSourceSnapshots'>;
    sourceScopeStatus?: 'whole_listing' | 'confirmed_subset' | 'needs_confirmation';
    sourceEvidenceOverrides?: { facts?: string; attributeKeys?: string[]; useDescription?: boolean };
    smartDescriptionSuggestion?: import('../lib/smartDescription').SmartDescriptionResponse;
    selected: boolean;
    customName?: string;
    customPrice?: number;
    customDescription?: string;
    targetCollection?: CollectionType;
    targetSubcategory?: string;
    targetSubcategoryIds?: string[];
    primarySubcategoryId?: string;
    nameClaimId?: string;
    nameOwnerKey?: string;
    audience?: 'girls' | 'boys' | 'unisex' | 'adult' | 'home' | 'unknown';
    canonicalProductType?: string;
    isEnhancing?: boolean;
    selectedImages?: number[]; // Indices of selected images for import
    imageOrder?: number[]; // Custom ordering of selectedImages — position 0 = main listing image
    selectedVariants?: string[]; // IDs of selected variants for import
    originalVariants?: Array<{ id: string; name: string; image?: string }>; // Snapshot of variant state (post-translation) for revert
    variantImageMap?: Record<string, number>; // Maps variant ID → image index for variant-specific images
    descriptionImages?: string[]; // Marketing/description images from 1688 GetItemDescription
    rawSourceDescription?: string; // Cleaned source listing/detail text for smart descriptions
    rawHtmlDescription?: string; // Raw source listing/detail HTML for smart descriptions
    sourceCurrency?: string; // Original currency code (e.g. 'CNY', 'USD') for audit trail
    sourcePriceOriginal?: number; // Original price in source currency for audit trail
    sourcePriceCny?: number; // Upstream CNY price for two-stage pricing
    smartDescription?: import('../types').Product['smartDescription'];
    descriptionAuditId?: string;
    smartDescriptionAdminEdited?: boolean;
    smartDescriptionWarnings?: string[];
    smartDescriptionSourceQuality?: number;
    smartDescriptionFallbackUsed?: boolean;
}

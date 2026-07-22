import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Check, X, DollarSign, Wand2, Package, ChevronDown, AlertCircle, Link, ChevronLeft, ChevronRight, Globe, Filter, Upload, Image as ImageIcon, RotateCcw, Clock3, RefreshCw, ListChecks } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { aliexpressService } from '../services/aliexpressService';
import { CollectionType, Product, CollectionConfig } from '../types';
import { translateVariantNames } from '../services/geminiService';
import { translateProductFields, detectChinese } from '../services/translateService';
import { extractOtapiSourceProperties, cleanOtapiDescription, isPlaceholderSourceDescription } from '../lib/otapiHelpers';
import { FadeIn } from './FadeIn';
import { ProductImageGallery } from './ProductImageGallery';
import { ProductCard, ImportableProduct } from './import/ProductCard';
import { SafeImage } from './SafeImage';
import { useMutation, useAction, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { buildSourceProductSnapshot, SourceAttribute } from '../lib/smartDescription';
import { calculatePricingBreakdown, getEstimatedShipping } from '../lib/pricing';
import { getUserFacingErrorMessage } from '../lib/errorMessages';
import { normalizeImageUrl, shouldCacheImageUrl } from '../lib/imageUrls';
import { normalizeProductImportUrl, parseProductImportUrls } from '../lib/importUrl';
import { buildBatchImportProduct } from '../lib/batchImportProduct';
import { isObsoleteBatchImportError } from '../lib/batchImportObsolete';

interface ProductImportProps {
    collections: CollectionConfig[];
    onImportProducts: (products: Omit<Product, 'id'>[]) => void;
}

// Pricing rules configuration
interface PricingRule {
    type: 'percentage' | 'fixed';
    value: number;
    roundUp: boolean;
}

const DEFAULT_PRICING_RULE: PricingRule = {
    type: 'percentage',
    value: 45, // 45% markup
    roundUp: true
};

const REVIEW_BATCH_SIZE = 12;
const SEARCH_PAGE_SIZE = 24;
const MAX_RESTORED_PRODUCTS = 60;
const MAX_RESTORED_DRAFT_BYTES = 1_500_000;

const isMobileImportBrowser = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

const clearStoredImportDraft = () => {
    try {
        sessionStorage.removeItem('import-search-results');
        sessionStorage.removeItem('import-step');
        sessionStorage.removeItem('import-review-index');
        localStorage.removeItem('import-draft-results');
        localStorage.removeItem('import-draft-step');
        localStorage.removeItem('import-draft-review-index');
    } catch {
        /* ignore storage errors */
    }
};

const getStoredImportDraft = (): ImportableProduct[] => {
    try {
        if (isMobileImportBrowser()) {
            clearStoredImportDraft();
            return [];
        }
        const saved = sessionStorage.getItem('import-search-results') || localStorage.getItem('import-draft-results');
        if (!saved) return [];
        if (saved.length > MAX_RESTORED_DRAFT_BYTES) {
            clearStoredImportDraft();
            return [];
        }
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.slice(0, MAX_RESTORED_PRODUCTS) : [];
    } catch {
        return [];
    }
};

const hasSelectedStoredImportDraft = (): boolean => {
    try {
        return getStoredImportDraft().some((product: any) => product?.selected);
    } catch {
        return false;
    }
};

const persistImportSessionResults = (results: ImportableProduct[]) => {
    try {
        if (isMobileImportBrowser()) return;
        const serialized = JSON.stringify(results.slice(0, MAX_RESTORED_PRODUCTS));
        if (serialized.length > MAX_RESTORED_DRAFT_BYTES) {
            sessionStorage.removeItem('import-search-results');
            return;
        }
        sessionStorage.setItem('import-search-results', serialized);
    } catch {
        /* ignore sessionStorage errors */
    }
};

// Approximate exchange rates for pre-sourcing estimation (CJ confirms final pricing)
const CURRENCY_RATES_TO_USD: Record<string, number> = {
    USD: 1,
    CNY: 0.14,
    RMB: 0.14, // alias for CNY
    GBP: 1.27,
    EUR: 1.09,
    CAD: 0.74,
    AUD: 0.66,
    JPY: 0.0067,
    KRW: 0.00075,
    HKD: 0.13,
    SGD: 0.75,
    MYR: 0.22,
    THB: 0.029,
    INR: 0.012,
};

/** Converts a price from a source currency to approximate USD. Throws for unsupported currencies. */
const convertToUsd = (price: number, currency: string): { usd: number; rate: number } => {
    const code = currency.toUpperCase().trim();
    const rate = CURRENCY_RATES_TO_USD[code];
    if (rate) return { usd: +(price * rate).toFixed(2), rate };
    // Unknown currency — surface error to reviewer
    throw new Error(`Unsupported currency "${code}". Only ${Object.keys(CURRENCY_RATES_TO_USD).filter(c => c !== 'RMB').join(', ')} are supported.`);
};

export const ProductImport: React.FC<ProductImportProps> = ({ collections, onImportProducts }) => {
    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResultsRaw] = useState<ImportableProduct[]>(() => {
        return getStoredImportDraft();
    });
    const setSearchResults = (resultsOrUpdater: ImportableProduct[] | ((prev: ImportableProduct[]) => ImportableProduct[])) => {
        if (typeof resultsOrUpdater === 'function') {
            setSearchResultsRaw(prev => {
                const next = resultsOrUpdater(prev);
                persistImportSessionResults(next);
                return next;
            });
        } else {
            setSearchResultsRaw(resultsOrUpdater);
            persistImportSessionResults(resultsOrUpdater);
        }
    };

    const [currentPage, setCurrentPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState(1);

    // URL Import state
    const [importUrl, setImportUrl] = useState('');
    const [isImportingUrl, setIsImportingUrl] = useState(false);
    const [batchUrls, setBatchUrls] = useState('');
    const [isImportingBatch, setIsImportingBatch] = useState(false);
    const [activeBatchJobId, setActiveBatchJobId] = useState<Id<'batchImportJobs'> | null>(() => {
        try { return localStorage.getItem('active-batch-import-job') as Id<'batchImportJobs'> | null; } catch { return null; }
    });
    const [autoEnhanceAi, setAutoEnhanceAi] = useState(true);

    // Filters
    const [minPrice, setMinPrice] = useState<string>('');
    const [maxPrice, setMaxPrice] = useState<string>('');

    const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'orders'>('default');

    // Import settings
    const [targetCollection, setTargetCollection] = useState<string>(collections[0]?.id || 'furniture');
    const [targetSubcategory, setTargetSubcategory] = useState<string>('');
    const pricingRule = DEFAULT_PRICING_RULE;

    // Actions
    const scrapeProduct = useAction(api.scraper.scrapeProduct);
    const generateSmartDescription = useAction(api.smartDescriptions.generateSmartDescription);
    const generateSmartName = useAction(api.smartNames.generateSmartName);
    const cacheImageUrls = useAction(api.productImages.cacheImageUrls);
    const createBatchImport = useMutation(api.batchImports.create);
    const retryBatchItem = useMutation(api.batchImports.retry);
    const cancelBatchImport = useMutation(api.batchImports.cancel);
    const skipObsoleteBatchErrors = useMutation(api.batchImports.skipObsoleteErrors);
    const markBatchPreparationError = useMutation(api.batchImports.markPreparationError);
    const markBatchItemsImported = useMutation(api.batchImports.markImported);
    const latestBatchJob = useQuery(api.batchImports.getLatest);
    const effectiveBatchJobId = activeBatchJobId || latestBatchJob?._id || null;
    const batchJob = useQuery(api.batchImports.getJob, effectiveBatchJobId ? { jobId: effectiveBatchJobId } : 'skip');
    const batchItems = useQuery(api.batchImports.getItems, effectiveBatchJobId ? { jobId: effectiveBatchJobId } : 'skip');
    const reportedPreparationErrors = useRef(new Set<string>());

    // Convex file upload mutations
    const generateUploadUrl = useMutation(api.files.generateUploadUrl);
    const saveFile = useMutation(api.files.saveFile);
    const imageUploadRef = useRef<HTMLInputElement>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [openImagePicker, setOpenImagePicker] = useState<string | null>(null);
    const [previewImageIdx, setPreviewImageIdx] = useState<number | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [reviewGalleryIdx, setReviewGalleryIdx] = useState<Record<string, number>>({});
    /** Draft text for price override inputs — keyed by variantId. Stored as raw string to avoid coercing transient values (e.g. "0.", ".5"). */
    const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
    /** Stamp mode: index of the "active stamp" image. Click a variant to assign this image. */
    const [activeStampImage, setActiveStampImage] = useState<number | null>(null);
    /** Last image assigned to a variant — used as sticky first option in per-variant picker */
    const [lastUsedImage, setLastUsedImage] = useState<number | null>(null);
    /** Drag-reorder state for image ordering strip */
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

    const buildSnapshotForImportProduct = (product: ImportableProduct) => {
        const attributes: SourceAttribute[] = Object.entries(product.sourceProperties || {}).map(([key, value]) => ({
            key,
            value: String(value),
            source: 'otapi_property',
            confidence: 0.9,
        }));
        return buildSourceProductSnapshot({
            sourceUrl: product.productUrl,
            name: product.name,
            description: isPlaceholderSourceDescription(product.description)
                ? (product.rawSourceDescription || '')
                : (product.description || ''),
            rawDescription: product.rawSourceDescription || product.description || '',
            htmlDescription: product.rawHtmlDescription || '',
            price: product.salePrice || product.price,
            currency: product.sourceCurrency || 'USD',
            images: product.images || [],
            descriptionImages: product.descriptionImages || [],
            variants: product.variants || [],
            attributes,
            category: product.category || product.targetSubcategory || '',
            subcategory: product.targetSubcategory || '',
            collection: product.targetCollection || targetCollection,
            sellerName: product.seller?.name,
            sellerRating: product.seller?.rating,
            salesCount: product.reviewCount,
            sourceMetadata: {
                sourceId: product.sourceId,
                originalPrice: product.originalPrice,
                sourcePriceCny: product.sourcePriceCny,
                source: product.source,
            },
        });
    };

    // Handle image upload for current review product
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be less than 5MB');
            return;
        }
        setIsUploadingImage(true);
        try {
            const uploadUrl = await generateUploadUrl();
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': file.type },
                body: file,
            });
            if (!response.ok) throw new Error('Upload failed');
            const { storageId } = await response.json();
            const result = await saveFile({ storageId, fileName: file.name, fileType: file.type, purpose: 'product' });
            if (result.url) {
                    // Capture the product ID before the functional updater
                    const target = searchResults.filter(p => p.selected)[reviewIndex];
                    if (!target) return;
                    const productId = target.id;
                    // Use a single functional updater so all rebases use latest state
                    setSearchResults(prev => prev.map(p => {
                        if (p.id !== productId) return p;
                        const prevCount = (p.images || []).length;
                        const rebase = (idx: number) => (idx >= prevCount ? idx + 1 : idx);
                        const updatedImages = [...(p.images || []), result.url];
                        const baseline = p.selectedImages ?? Array.from({ length: prevCount }, (_, i) => i);
                        const rebasedSelected = baseline.map(rebase);
                        const newSelected = [...new Set([...rebasedSelected, prevCount])].sort((a, b) => a - b);
                        const newMap = p.variantImageMap
                            ? Object.fromEntries(Object.entries(p.variantImageMap).map(([vid, idx]) => [vid, rebase(idx as number)]))
                            : p.variantImageMap;
                        const newOrder = p.imageOrder ? p.imageOrder.map(rebase) : p.imageOrder;
                        return { ...p, images: updatedImages, selectedImages: newSelected, variantImageMap: newMap, imageOrder: newOrder };
                    }));
                    // Rebase previewImageIdx when upload shifts combined-image indices
                    const previousImageCount = (target.images || []).length;
                    setPreviewImageIdx(prev =>
                        prev !== null && prev >= previousImageCount ? prev + 1 : prev
                    );
                    toast.success('Image uploaded!');
            }
        } catch (err) {
            console.error('Image upload error:', err);
            toast.error('Failed to upload image');
        } finally {
            setIsUploadingImage(false);
            if (imageUploadRef.current) imageUploadRef.current.value = '';
        }
    };


    // Get subcategories for a specific collection (for per-product selection)
    const getSubcategoriesForCollection = (collectionId: string) => {
        const collection = collections.find(c => c.id === collectionId);
        return collection?.subcategories || [];
    };

    // Selection state
    const [selectAll, setSelectAll] = useState(false);

    // Two-stage pricing: cost-stack formula
    // Stage 1 (Pre-Sourcing): estimated_cj = source price x 1.2, selling = (estimated_cj x 2) + shipping.
    const getShippingEstimate = (collection: string): number => getEstimatedShipping(collection);

    const calculateCostStackPrice = (basePriceUsd: number, collection: string): {
        estimatedCjCost: number;
        estimatedShipping: number;
        sellingPrice: number;
    } => {
        const breakdown = calculatePricingBreakdown({
            sourcePriceUsd: basePriceUsd,
            collection,
        });
        const estimatedCjCost = breakdown.productCost;
        const estimatedShipping = breakdown.shippingCost;
        const sellingPrice = pricingRule.roundUp
            ? breakdown.suggestedRetailPrice
            : Math.round(((estimatedCjCost * breakdown.retailMultiplier) + estimatedShipping) * 100) / 100;

        return {
            estimatedCjCost: Math.round(estimatedCjCost * 100) / 100,
            estimatedShipping,
            sellingPrice: Math.max(sellingPrice, 0),
        };
    };

    // Per-product price calculation using the product's own collection (not global default)
    const calculateProductPrice = (product: ImportableProduct): number => {
        const collection = product.targetCollection || targetCollection;
        return calculateCostStackPrice(product.salePrice || product.price, collection).sellingPrice;
    };

    // Legacy wrapper for search results display
    const calculateFinalPrice = (basePrice: number): number => {
        return calculateCostStackPrice(basePrice, targetCollection).sellingPrice;
    };

    useEffect(() => {
        if (!effectiveBatchJobId) return;
        setActiveBatchJobId(effectiveBatchJobId);
        try { localStorage.setItem('active-batch-import-job', effectiveBatchJobId); } catch { /* storage unavailable */ }
    }, [effectiveBatchJobId]);

    useEffect(() => {
        if (!batchJob || (batchJob.status !== 'completed' && batchJob.status !== 'cancelled')) return;
        if (activeBatchJobId === batchJob._id) {
            setActiveBatchJobId(null);
            try { localStorage.removeItem('active-batch-import-job'); } catch { /* storage unavailable */ }
        }
    }, [batchJob, activeBatchJobId]);

    useEffect(() => {
        if (!batchItems) return;
        for (const item of batchItems) {
            if (item.status !== 'ready') reportedPreparationErrors.current.delete(item._id);
        }
        const readyRows = batchItems.filter(item => item.status === 'ready' && 'result' in item && item.result);
        if (readyRows.length === 0) return;
        setSearchResults(prev => {
            const known = new Set(prev.map(product => product.batchItemId).filter(Boolean));
            const additions: ImportableProduct[] = [];
            for (const row of readyRows) {
                if (known.has(row._id)) continue;
                try {
                    additions.push(buildBatchImportProduct(row as any, targetCollection, calculateFinalPrice));
                } catch (error) {
                    console.error('[Batch Import] Could not prepare ready product', row._id, error);
                    if (!reportedPreparationErrors.current.has(row._id)) {
                        reportedPreparationErrors.current.add(row._id);
                        void markBatchPreparationError({
                            itemId: row._id,
                            error: error instanceof Error ? error.message : 'Could not prepare this product for review.',
                        });
                    }
                }
            }
            return additions.length ? [...prev, ...additions] : prev;
        });
    }, [batchItems, targetCollection]);

    useEffect(() => {
        if (!batchJob || !batchItems?.some(item => isObsoleteBatchImportError(item))) return;
        void skipObsoleteBatchErrors({ jobId: batchJob._id });
    }, [batchJob, batchItems, skipObsoleteBatchErrors]);

    /**
     * Shared helper: compute a variant's selling price with optional markup scaling.
     * Used by both confirmImport() and getVariantSellingPrice() for preview parity.
     */
    const getScaledVariantSelling = (
        variantPrice1688: number,
        collection: string,
        markupRatio: number,
        hasCustomPrice: boolean,
    ): number => {
        const raw = calculateCostStackPrice(variantPrice1688, collection).sellingPrice;
        // Preserve the user's exact base price when scaling variant selling prices.
        const scaled = hasCustomPrice ? raw * markupRatio : raw;
        return Number(scaled.toFixed(2));
    };

    // Search handler
    const handleSearch = async (page = 1) => {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setError(null);
        console.log(`[Import Search] Starting search: query="${searchQuery}", page=${page}`);
        toast.loading('Searching 1688 catalog...', { id: 'search-progress' });

        try {
            const result = await aliexpressService.searchAllSources({
                query: searchQuery,
                page,
                pageSize: SEARCH_PAGE_SIZE,
                minPrice: minPrice ? parseFloat(minPrice) : undefined,
                maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
                sortBy: sortBy === 'default' ? undefined : sortBy,
                sources: ['1688'],
            });

            console.log(`[Import Search] Got ${result.products.length} products, totalCount: ${result.totalCount}`);
            if (result.errors && result.errors.length > 0) {
                console.warn('[Import Search] Partial errors:', result.errors);
            }

            const filteredProducts = result.products
                .map(p => ({
                    ...p,
                    selected: false,
                    targetCollection: targetCollection as CollectionType,
                    customPrice: calculateFinalPrice(p.salePrice || p.price),
                    originalVariants: p.variants?.map(v => ({
                        id: v.id,
                        name: v.name,
                        image: v.image,
                    })),
                }));

            setSearchResults(filteredProducts);
            setTotalPages(result.totalPages || Math.ceil(result.totalCount / SEARCH_PAGE_SIZE));
            setCurrentPage(page);
            setSelectAll(false);
            toast.dismiss('search-progress');

            if (filteredProducts.length === 0 && result.totalCount === 0) {
                toast.info('No products found', { description: 'Try different keywords or adjust your filters.' });
            } else {
                toast.success(`Found ${filteredProducts.length} products`);
            }
        } catch (err) {
            console.error('[Import Search] Search FAILED:', err);
            toast.dismiss('search-progress');

            let errorMsg = 'Search failed';
            if (err instanceof Error) {
                errorMsg = err.message;
                // Add guidance for common errors
                if (errorMsg.includes('RapidAPI key not configured')) {
                    errorMsg = 'RapidAPI key not configured. Go to Convex Dashboard → Environment Variables and set RAPIDAPI_KEY.';
                } else if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
                    errorMsg = 'API rate limit reached. Please wait a moment and try again.';
                } else if (errorMsg.includes('timed out') || errorMsg.includes('AbortError')) {
                    errorMsg = 'Search request timed out. The 1688 API may be slow — please try again.';
                } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
                    errorMsg = 'Network error — could not reach the search API. Check your internet connection.';
                }
            }

            setError(errorMsg);
            toast.error('Search failed', { description: errorMsg, duration: 8000 });
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    // Toggle product selection
    const toggleProductSelection = (productId: string) => {
        setSearchResults(prev => prev.map(p =>
            p.id === productId ? { ...p, selected: !p.selected } : p
        ));
    };

    // Toggle select all
    const handleSelectAll = () => {
        const newSelectAll = !selectAll;
        setSelectAll(newSelectAll);
        setSearchResults(prev => prev.map(p => ({ ...p, selected: newSelectAll })));
    };

    // Update product custom field
    const updateProductField = (productId: string, field: keyof ImportableProduct, value: any) => {
        setSearchResults(prev => prev.map(p =>
            p.id === productId ? { ...p, [field]: value } : p
        ));
    };

    // AI Enhancement with full product context - enhances BOTH name and description
    const enhanceProductWithAI = async (productId: string) => {
        const product = searchResults.find(p => p.id === productId);
        if (!product) return;

        updateProductField(productId, 'isEnhancing', true);

        try {
            const sourceSnapshot = buildSnapshotForImportProduct(product);
            const [smartNameSettled, smartDescriptionSettled] = await Promise.allSettled([
                generateSmartName({
                    request: {
                        sourceSnapshot,
                        adminContext: {
                            selectedCategory: product.category || '',
                            selectedSubcategory: product.targetSubcategory || targetSubcategory,
                            selectedCollection: product.targetCollection || targetCollection,
                        },
                        generationMode: 'manual_generate',
                        options: {
                            allowImageAnalysis: true,
                            forceFreshVariation: true,
                        },
                    },
                } as any),
                generateSmartDescription({
                    request: {
                        sourceSnapshot,
                        adminContext: {
                            selectedCategory: product.category || '',
                            selectedSubcategory: product.targetSubcategory || targetSubcategory,
                            selectedCollection: product.targetCollection || targetCollection,
                        },
                        generationMode: 'manual_generate',
                        options: {
                            allowImageAnalysis: true,
                            allowSeoKeywords: true,
                            forceFreshVariation: true,
                        },
                    },
                } as any),
            ]);
            const smartName = smartNameSettled.status === 'fulfilled' ? smartNameSettled.value as any : null;
            const smartDescription = smartDescriptionSettled.status === 'fulfilled' ? smartDescriptionSettled.value as any : null;
            const enhancedName = smartName?.ok && smartName.name
                ? smartName.name
                : (product.customName || product.name);

            updateProductField(productId, 'customName', enhancedName);
            if (smartDescription?.ok && smartDescription.description) {
                updateProductField(productId, 'customDescription', smartDescription.description);
                updateProductField(productId, 'descriptionAuditId', smartDescription.auditId);
                updateProductField(productId, 'smartDescriptionAdminEdited', false);
                updateProductField(productId, 'smartDescriptionWarnings', smartDescription.warnings || []);
                updateProductField(productId, 'smartDescriptionSourceQuality', smartDescription.facts?.sourceQuality?.score);
                updateProductField(productId, 'smartDescriptionFallbackUsed', smartDescription.fallbackUsed);
            } else {
                toast.error(smartDescription?.error || 'Smart description failed');
                return;
            }

            toast.success('AI enhancement complete', {
                description: `Enhanced "${enhancedName}"`
            });
        } catch (err) {
            console.error('AI enhancement failed:', err);
            toast.error('AI enhancement failed', {
                description: 'Please try again later.'
            });
        } finally {
            updateProductField(productId, 'isEnhancing', false);
        }
    };

    // AI Enhancement for NAME only
    const enhanceNameWithAI = async (productId: string) => {
        const product = searchResults.find(p => p.id === productId);
        if (!product) return;

        updateProductField(productId, 'isEnhancing', true);

        try {
            const smartName = await generateSmartName({
                request: {
                    sourceSnapshot: buildSnapshotForImportProduct(product),
                    adminContext: {
                        selectedCategory: product.category || '',
                        selectedSubcategory: product.targetSubcategory || targetSubcategory,
                        selectedCollection: product.targetCollection || targetCollection,
                    },
                    generationMode: 'manual_generate',
                    options: {
                        allowImageAnalysis: true,
                        forceFreshVariation: true,
                    },
                },
            } as any);
            if (!(smartName as any)?.ok || !(smartName as any).name) {
                throw new Error((smartName as any)?.error || 'Smart name failed');
            }
            const enhancedName = (smartName as any).name;
            updateProductField(productId, 'customName', enhancedName);

            toast.success('Name enhanced', {
                description: `"${enhancedName}"`
            });
        } catch (err) {
            console.error('AI name enhancement failed:', err);
            toast.error('Name enhancement failed');
        } finally {
            updateProductField(productId, 'isEnhancing', false);
        }
    };

    // AI Enhancement for DESCRIPTION only
    const enhanceDescriptionWithAI = async (productId: string) => {
        const product = searchResults.find(p => p.id === productId);
        if (!product) return;

        updateProductField(productId, 'isEnhancing', true);

        try {
            const smartDescription = await generateSmartDescription({
                request: {
                    sourceSnapshot: buildSnapshotForImportProduct(product),
                    adminContext: {
                        selectedCategory: product.category || '',
                        selectedSubcategory: product.targetSubcategory || targetSubcategory,
                        selectedCollection: product.targetCollection || targetCollection,
                    },
                    generationMode: 'manual_generate',
                    options: {
                        allowImageAnalysis: true,
                        allowSeoKeywords: true,
                        forceFreshVariation: true,
                    },
                },
            } as any);
            if ((smartDescription as any)?.ok && (smartDescription as any).description) {
                updateProductField(productId, 'customDescription', (smartDescription as any).description);
                updateProductField(productId, 'descriptionAuditId', (smartDescription as any).auditId);
                updateProductField(productId, 'smartDescriptionAdminEdited', false);
                updateProductField(productId, 'smartDescriptionWarnings', (smartDescription as any).warnings || []);
                updateProductField(productId, 'smartDescriptionSourceQuality', (smartDescription as any).facts?.sourceQuality?.score);
                updateProductField(productId, 'smartDescriptionFallbackUsed', (smartDescription as any).fallbackUsed);
            } else {
                throw new Error((smartDescription as any)?.error || 'Smart description failed');
            }

            toast.success('Description enhanced');
        } catch (err) {
            console.error('AI description enhancement failed:', err);
            toast.error('Description enhancement failed');
        } finally {
            updateProductField(productId, 'isEnhancing', false);
        }
    };

    // Enhance all selected
    const enhanceAllSelected = async () => {
        const selectedProducts = searchResults.filter(p => p.selected);
        for (const product of selectedProducts) {
            await enhanceProductWithAI(product.id);
        }
    };

    // Import Multi-Step Workflow State
    const [importStep, setImportStepRaw] = useState<'search' | 'review' | 'final-review'>(() => {
        try {
            const savedStep = sessionStorage.getItem('import-step') || localStorage.getItem('import-draft-step');
            if (savedStep === 'review' || savedStep === 'final-review') {
                if (hasSelectedStoredImportDraft()) {
                    return savedStep;
                }
            }
        } catch { /* ignore sessionStorage errors */ }
        return 'search';
    });
    const setImportStep = (step: 'search' | 'review' | 'final-review') => {
        setImportStepRaw(step);
        if (step !== 'final-review') setPriceDrafts({});
        try {
            sessionStorage.setItem('import-step', step);
            if (step === 'search') {
                sessionStorage.removeItem('import-search-results');
                sessionStorage.removeItem('import-review-index');
                localStorage.removeItem('import-draft-results');
                localStorage.removeItem('import-draft-step');
                localStorage.removeItem('import-draft-review-index');
            }
        } catch { /* ignore sessionStorage errors */ }
    };
    const [reviewIndex, setReviewIndexRaw] = useState(() => {
        try {
            const saved = sessionStorage.getItem('import-review-index') || localStorage.getItem('import-draft-review-index');
            return saved ? parseInt(saved, 10) : 0;
        } catch { return 0; }
    });
    const [reviewBatchNumber, setReviewBatchNumber] = useState(1);
    const getReviewBatch = (products = searchResults.filter(p => p.selected)) =>
        products.slice(0, REVIEW_BATCH_SIZE);

    // Reset preview and stamp/drag state when switching products or entering review mode
    useEffect(() => {
        setPreviewImageIdx(null);
        setActiveStampImage(null);
        setLastUsedImage(null);
        setDragIdx(null);
        setDragOverIdx(null);
        setOpenImagePicker(null);
    }, [reviewIndex, importStep]);
    const setReviewIndex = (idxOrUpdater: number | ((prev: number) => number)) => {
        if (typeof idxOrUpdater === 'function') {
            setReviewIndexRaw(prev => {
                const next = idxOrUpdater(prev);
                try { sessionStorage.setItem('import-review-index', String(next)); } catch { /* ignore sessionStorage errors */ }
                return next;
            });
        } else {
            setReviewIndexRaw(idxOrUpdater);
            try { sessionStorage.setItem('import-review-index', String(idxOrUpdater)); } catch { /* ignore sessionStorage errors */ }
        }
    };

    const handleSaveImportDraft = () => {
        try {
            const serializedResults = JSON.stringify(searchResults.slice(0, MAX_RESTORED_PRODUCTS));
            if (serializedResults.length > MAX_RESTORED_DRAFT_BYTES) {
                toast.error('This import draft is too large to save in the browser. Import a smaller review batch first.');
                return;
            }
            sessionStorage.setItem('import-search-results', serializedResults);
            sessionStorage.setItem('import-step', importStep);
            sessionStorage.setItem('import-review-index', String(reviewIndex));
            localStorage.setItem('import-draft-results', serializedResults);
            localStorage.setItem('import-draft-step', importStep);
            localStorage.setItem('import-draft-review-index', String(reviewIndex));
            toast.success('Import draft saved. You can return to this import review later from this browser.');
        } catch {
            toast.error('Could not save import draft in this browser.');
        }
    };

    // Modify handleImport to start review instead of direct import
    const handleImport = () => {
        const selectedProducts = searchResults.filter(p => p.selected);

        if (selectedProducts.length === 0) {
            setError('Please select at least one product to import');
            return;
        }

        // Initialize review step
        setImportStep('review');
        setReviewIndex(0);
        setReviewBatchNumber(1);
        setError(null);
    };

    /** Resolves selected images in the user's custom display order, normalizing URLs. */
    const getOrderedImages = (p: ImportableProduct): string[] => {
        const combinedImages = [...(p.images || []), ...(p.descriptionImages || [])];
        const selected = p.selectedImages && p.selectedImages.length > 0
            ? p.selectedImages : (p.images || []).map((_, i) => i);
        const ordered = p.imageOrder && p.imageOrder.length > 0
            ? p.imageOrder.filter(i => selected.includes(i)) : [...selected];
        const missing = selected.filter(i => !ordered.includes(i));
        return [...ordered, ...missing]
            .map(idx => combinedImages[idx])
            .filter(Boolean)
            .map(img => img.startsWith('//') ? 'https:' + img : img);
    };

    const cacheProductImageUrls = async (args: {
        images: string[];
        variants?: Product['variants'];
        sourceUrl?: string;
        productName: string;
    }) => {
        const urls = [
            ...args.images,
            ...(args.variants || []).map((variant) => variant.image).filter((image): image is string => Boolean(image)),
        ].map(normalizeImageUrl).filter(Boolean);
        const cacheable = urls.filter(shouldCacheImageUrl);
        if (cacheable.length === 0) {
            return { images: args.images.map(normalizeImageUrl), variants: args.variants };
        }

        try {
            const result = await cacheImageUrls({
                urls: cacheable,
                sourceUrl: args.sourceUrl,
            }) as { results: Array<{ originalUrl: string; finalUrl: string; error?: string }> };
            const replacements = new Map<string, string>(result.results.map((entry) => [entry.originalUrl, entry.finalUrl]));
            const failed = result.results.filter((entry) => entry.error);
            if (failed.length > 0) {
                toast.warning(`Some images for "${args.productName}" could not be cached; storefront fallback will still try to render them.`);
            }

            return {
                images: args.images.map((image) => replacements.get(normalizeImageUrl(image)) || normalizeImageUrl(image)),
                variants: args.variants?.map((variant) => ({
                    ...variant,
                    image: variant.image ? (replacements.get(normalizeImageUrl(variant.image)) || normalizeImageUrl(variant.image)) : undefined,
                })),
            };
        } catch (error) {
            console.warn('Image caching failed; saving normalized remote URLs instead.', error);
            toast.warning(`Image caching could not finish for "${args.productName}"; storefront fallback will still try to render them.`);
            return {
                images: args.images.map(normalizeImageUrl),
                variants: args.variants?.map((variant) => ({
                    ...variant,
                    image: variant.image ? normalizeImageUrl(variant.image) : undefined,
                })),
            };
        }
    };

    // Final Import Action
    const confirmImport = async () => {
        if (isImporting) return;
        setIsImporting(true);
        const selectedProducts = getReviewBatch();

        const productsToImport: Omit<Product, 'id'>[] = selectedProducts.map(p => {
            const productCollection = p.targetCollection || targetCollection;
            const productSubcategory = p.targetSubcategory || targetSubcategory;
            const subcategories = getSubcategoriesForCollection(productCollection);
            const subcategoryTitle = subcategories.find(s => s.id === productSubcategory)?.title || productSubcategory || p.category || 'General';

            const finalImages = getOrderedImages(p);

            // Detect if collection was changed from the default
            const collectionChanged = p.targetCollection && p.targetCollection !== targetCollection;
            const sourcePriceUsd = p.salePrice || p.price;
            const formulaPricing = calculateCostStackPrice(sourcePriceUsd, productCollection);
            const hasCustomRetailPrice = typeof p.customPrice === 'number' && Number.isFinite(p.customPrice);
            const selectedRetailPrice = hasCustomRetailPrice ? p.customPrice! : formulaPricing.sellingPrice;
            const adminPriceLocked = hasCustomRetailPrice && Math.abs(p.customPrice! - formulaPricing.sellingPrice) >= 0.01;
            const pricingBreakdown = calculatePricingBreakdown({
                sourcePriceUsd,
                collection: productCollection,
                currentRetailPrice: selectedRetailPrice,
                adminLockedPrice: adminPriceLocked,
                pricingSource: adminPriceLocked ? 'manual_locked' : 'source_estimate',
            });

            return {
                // Always prefer user edits over originals
                name: p.customName || p.name,
                price: selectedRetailPrice,
                description: p.customDescription || p.description || '',
                images: finalImages,
                category: subcategoryTitle,
                collection: productCollection as CollectionType,
                isNew: true,
                inStock: p.inStock,
                storefrontStatus: 'hidden' as const,
                // Filter variants: undefined = all, [] = none, [...ids] = only those
                // Normalize variant prices so they round-trip correctly after import
                variants: (() => {
                    const raw = p.selectedVariants === undefined
                        ? p.variants
                        : p.variants?.filter(v => p.selectedVariants!.includes(v.id));
                    if (!raw) return raw;
                    const finalPrice = (typeof p.customPrice === 'number' && Number.isFinite(p.customPrice))
                        ? p.customPrice
                        : calculateProductPrice(p);
                    const costStackBase = calculateCostStackPrice(p.salePrice || p.price, p.targetCollection || targetCollection).sellingPrice;
                    // Fix 5: If user set a custom price, compute markup ratio and propagate to variants
                    const hasCustomPrice = typeof p.customPrice === 'number' && Number.isFinite(p.customPrice);
                    const markupRatio = hasCustomPrice && costStackBase > 0 ? p.customPrice! / costStackBase : 1;
                    const collection = p.targetCollection || targetCollection;
                    return raw.map(v => {
                        // If user set an explicit override, convert to priceAdjustment relative to product.price
                        if (typeof v.sellingPriceOverride === 'number' && Number.isFinite(v.sellingPriceOverride)) {
                            return { ...v, priceAdjustment: v.sellingPriceOverride - finalPrice, sellingPriceOverride: undefined };
                        }
                        const scaledSelling = getScaledVariantSelling(
                            (p.salePrice || p.price) + v.priceAdjustment, collection, markupRatio, hasCustomPrice
                        );
                        return { ...v, priceAdjustment: scaledSelling - finalPrice };
                    }).map(({ sellingPriceOverride: _drop, ...rest }) => rest);
                })(),
                sourceUrl: p.productUrl || '',
                batchImportItemId: p.batchItemId as Id<'batchImportItems'> | undefined,
                cjSourcingStatus: p.productUrl ? 'pending' as const : 'none' as const,
                smartDescription: p.descriptionAuditId && (p.customDescription || p.description)
                    ? {
                        description: p.customDescription || p.description || '',
                        auditId: p.descriptionAuditId as any,
                        generatedAt: Date.now(),
                        model: 'server-configured',
                        promptVersion: 'smart-description-v2.0.0',
                        sourceSnapshotHash: 'pending-link',
                        adminEdited: Boolean(p.smartDescriptionAdminEdited),
                        status: p.smartDescriptionFallbackUsed ? 'fallback' as const : 'generated' as const,
                    }
                    : undefined,
                descriptionSource: p.descriptionAuditId
                    ? (p.smartDescriptionAdminEdited
                        ? 'ai_generated_admin_edited' as const
                        : 'ai_generated' as const)
                    : (p.description ? 'source_original' as const : 'safe_fallback' as const),
                // Two-stage pricing metadata — use upstream CNY if available (from sourcePriceCny on the product)
                sourcePriceCny: p.sourcePriceCny || undefined,
                rawSourceDescription: p.rawSourceDescription || undefined,
                rawHtmlDescription: p.rawHtmlDescription || undefined,
                descriptionImages: p.descriptionImages || undefined,
                estimatedCjCost: pricingBreakdown.productCost,
                estimatedShipping: pricingBreakdown.shippingCost,
                estimatedCjProductCost: pricingBreakdown.productCost,
                estimatedCjShippingCost: pricingBreakdown.shippingCost,
                estimatedCjServiceFee: pricingBreakdown.serviceFee,
                estimatedLandedCost: pricingBreakdown.landedCost,
                suggestedRetailPrice: pricingBreakdown.suggestedRetailPrice,
                adminPriceLocked,
                pricingSource: pricingBreakdown.pricingSource,
                pricingUpdatedAt: Date.now(),
                pricingWarnings: pricingBreakdown.warnings,
                pricingStage: 'estimated' as const,


                // Subcategory — clear if collection changed to avoid stale category
                subcategory: collectionChanged ? undefined : (productSubcategory || undefined),
            };
        });

        try {
            toast.loading('Securing product images...', { id: 'cache-product-images' });
            for (let index = 0; index < productsToImport.length; index++) {
                const sourceProduct = selectedProducts[index];
                const product = productsToImport[index];
                const cached = await cacheProductImageUrls({
                    images: product.images,
                    variants: product.variants,
                    sourceUrl: sourceProduct?.productUrl,
                    productName: product.name,
                });
                productsToImport[index] = {
                    ...product,
                    images: cached.images,
                    variants: cached.variants,
                };
            }
            toast.dismiss('cache-product-images');
            await Promise.resolve(onImportProducts(productsToImport));
            const importedBatchItemIds = selectedProducts
                .map(product => product.batchItemId)
                .filter((id): id is Id<'batchImportItems'> => Boolean(id));
            if (importedBatchItemIds.length > 0) {
                await markBatchItemsImported({ itemIds: importedBatchItemIds });
            }
            const importedIds = new Set(selectedProducts.map(p => p.id));
            const remainingSelected = searchResults.filter(p => p.selected && !importedIds.has(p.id));
            setSearchResults(prev => prev.map(p => importedIds.has(p.id) ? { ...p, selected: false } : p));
            setSelectAll(false);
            setReviewIndex(0);
            if (remainingSelected.length > 0) {
                setReviewBatchNumber(prev => prev + 1);
                setImportStep('review');
                toast.success(`${productsToImport.length} imported. ${remainingSelected.length} product${remainingSelected.length === 1 ? '' : 's'} ready in the next review batch.`);
            } else {
                setImportStep('search');
                try { sessionStorage.removeItem('import-search-results'); } catch { /* ignore */ }
                try {
                    localStorage.removeItem('import-draft-results');
                    localStorage.removeItem('import-draft-step');
                    localStorage.removeItem('import-draft-review-index');
                } catch { /* ignore */ }
            }
        } finally {
            toast.dismiss('cache-product-images');
            setIsImporting(false);
        }
    };

    // Helper to update current review item
    const updateReviewProduct = (field: keyof ImportableProduct, value: any) => {
        const currentProduct = searchResults.filter(p => p.selected)[reviewIndex];
        if (!currentProduct) return;
        updateProductField(currentProduct.id, field, value);
    };

    // Render Review Screen
    if (importStep === 'review') {
        const allSelectedProducts = searchResults.filter(p => p.selected);
        const selectedProducts = getReviewBatch(allSelectedProducts);
        const currentProduct = selectedProducts[reviewIndex];
        const progress = ((reviewIndex + 1) / selectedProducts.length) * 100;

        if (!currentProduct) return <div>Error: Product not found</div>;

        return (
            <div className="min-h-[80vh] flex flex-col items-center justify-start py-4 relative z-20 w-full">

                <FadeIn className="w-full max-w-full" mobileFast>
                    <div className="bg-white/20 backdrop-blur-3xl rounded-2xl overflow-hidden relative shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-white/50">
                        {/* Header / Progress */}
                        <div className="bg-white/10 px-4 py-3 md:px-6 md:py-4 border-b border-white/20 flex flex-col md:flex-row gap-3 md:gap-0 justify-between md:items-center relative overflow-hidden backdrop-blur-xl">
                            <div className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-bronze/20 to-transparent transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                            <div className="relative z-10 flex items-center gap-4">
                                <button
                                    onClick={() => setImportStep('search')}
                                    className="flex items-center gap-1.5 text-earth/60 hover:text-earth transition-colors text-[10px] uppercase tracking-widest font-bold"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Back
                                </button>
                                <div className="h-4 w-px bg-earth/10"></div>
                                <span className="text-base font-serif text-earth">Review batch {reviewBatchNumber} · {reviewIndex + 1} of {selectedProducts.length} <span className="text-xs text-earth/50">({allSelectedProducts.length} in pipeline)</span></span>
                            </div>
                            {/* Translate button */}
                            <div className="relative z-10 flex items-center gap-2 mr-auto md:mr-0">
                                {(() => {
                                    const hasChineseText = detectChinese(currentProduct.customName || currentProduct.name) ||
                                        detectChinese(currentProduct.customDescription || currentProduct.description || '') ||
                                        (currentProduct.variants || []).some(v => detectChinese(v.name));
                                    if (!hasChineseText) return null;
                                    return (
                                        <button
                                            onClick={async () => {
                                                const productId = currentProduct.id;
                                                const variantsAtStart = currentProduct.variants ?? [];
                                                const nameAtRequest = currentProduct.customName || currentProduct.name;
                                                const descAtRequest = currentProduct.customDescription || currentProduct.description || '';
                                                setIsTranslating(true);
                                                try {
                                                    const result = await translateProductFields({
                                                        name: nameAtRequest,
                                                        description: descAtRequest,
                                                        variantNames: variantsAtStart.map(v => v.name),
                                                    });
                                                    // Merge all translated fields via functional updater
                                                    // Only overwrite name/description if the user hasn't edited them while translating
                                                    const translatedMap = new Map<string, { requested: string; translated: string }>();
                                                    variantsAtStart.forEach((v, i) => {
                                                        if (result.variantNames[i]) {
                                                            translatedMap.set(v.id, {
                                                                requested: v.name,
                                                                translated: result.variantNames[i],
                                                            });
                                                        }
                                                    });
                                                    setSearchResults(prev => prev.map(p => {
                                                        if (p.id !== productId) return p;
                                                        const updates: Partial<typeof p> = {};
                                                        // Only apply translated name if user hasn't changed it
                                                        const currentName = p.customName || p.name;
                                                        if (currentName === nameAtRequest) updates.customName = result.name;
                                                        // Only apply translated description if user hasn't changed it
                                                        const currentDesc = p.customDescription || p.description || '';
                                                        if (currentDesc === descAtRequest) updates.customDescription = result.description;
                                                        // Merge translated variant names only if user hasn't edited them
                                                        if (translatedMap.size > 0) {
                                                            const translatedIds = new Set<string>();
                                                            updates.variants = (p.variants || []).map(v => {
                                                                const entry = translatedMap.get(v.id);
                                                                if (!entry || v.name !== entry.requested) return v;
                                                                translatedIds.add(v.id);
                                                                return { ...v, name: entry.translated };
                                                            });
                                                            // Update originalVariants so translated names become the new baseline
                                                            if (p.originalVariants) {
                                                                updates.originalVariants = p.originalVariants.map(v => {
                                                                    const entry = translatedIds.has(v.id) ? translatedMap.get(v.id) : undefined;
                                                                    return entry ? { ...v, name: entry.translated } : v;
                                                                });
                                                            }
                                                        }
                                                        return { ...p, ...updates };
                                                    }));
                                                    toast.success('Translation complete');
                                                } catch (err) {
                                                    console.error('Translation failed:', err);
                                                    toast.error('Translation failed');
                                                } finally {
                                                    setIsTranslating(false);
                                                }
                                            }}
                                            disabled={isTranslating}
                                            className="px-3 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-all text-[10px] uppercase tracking-widest font-bold flex items-center gap-1 disabled:opacity-50"
                                        >
                                            {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                                            Translate
                                        </button>
                                    );
                                })()}
                            </div>
                            <div className="relative z-10 flex flex-wrap gap-2 md:gap-4">
                                <button
                                    onClick={handleSaveImportDraft}
                                    className="px-4 py-2 rounded-full border border-bronze/30 bg-white/20 backdrop-blur-md hover:bg-white/40 transition-all text-[10px] uppercase tracking-widest font-bold text-bronze"
                                >
                                    Save Draft
                                </button>
                                <button
                                    onClick={() => setReviewIndex(prev => Math.max(0, prev - 1))}
                                    disabled={reviewIndex === 0}
                                    className="px-4 py-2 rounded-full border border-white/40 bg-white/20 backdrop-blur-md hover:bg-white/40 disabled:opacity-30 transition-all text-[10px] uppercase tracking-widest font-bold text-earth"
                                >
                                    Previous
                                </button>
                                {reviewIndex < selectedProducts.length - 1 ? (
                                    <button
                                        onClick={() => setReviewIndex(prev => Math.min(selectedProducts.length - 1, prev + 1))}
                                        className="px-5 py-2 rounded-full bg-earth text-cream hover:bg-bronze transition-all text-[10px] uppercase tracking-widest font-bold shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:-translate-y-0.5"
                                    >
                                        Next Item
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setImportStep('final-review')}
                                        className="px-5 py-2 rounded-full bg-green-600 border border-green-500/50 text-white hover:bg-green-500 transition-all text-[10px] uppercase tracking-widest font-bold shadow-[0_8px_20px_rgba(34,197,94,0.25)] hover:-translate-y-0.5"
                                    >
                                        Review this batch → ({selectedProducts.length})
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col overflow-y-auto custom-scrollbar relative pb-12" style={{ maxHeight: '75vh' }}>
                            {/* SECTION 1: VISUALS */}
                            <div className="w-full bg-white/30 backdrop-blur-md border-b border-white/20 flex flex-col relative">
                                {/* Section Title */}
                                <div className="text-center pt-5 pb-3 px-4">
                                    <h3 className="font-serif text-lg text-earth">Step 1: Curate Visuals</h3>
                                    <p className="text-earth/60 font-light mt-1 max-w-md mx-auto text-xs">Select, reorder, and preview images. First image = main listing image.</p>
                                </div>

                                {/* Main Preview — full-size scrollable gallery */}
                                <div className="px-4 md:px-8 pb-3">
                                    <div className="max-w-md mx-auto aspect-square rounded-xl overflow-hidden shadow-[0_10px_20px_rgba(0,0,0,0.06)] border border-white/60 bg-white relative group">
                                    {((currentProduct.images?.length ?? 0) > 0 || previewImageIdx !== null) ? (
                                        <>
                                            {(() => {
                                                const allImages = [...(currentProduct.images || []), ...(currentProduct.descriptionImages || [])];
                                                if (allImages.length === 0) return null;
                                                const fallbackIdx = (() => {
                                                    const sel = currentProduct.selectedImages && currentProduct.selectedImages.length > 0
                                                        ? currentProduct.selectedImages
                                                        : (currentProduct.images || []).map((_, i) => i);
                                                    const ord = currentProduct.imageOrder && currentProduct.imageOrder.length > 0
                                                        ? currentProduct.imageOrder.filter(i => sel.includes(i))
                                                        : [...sel];
                                                    return ord[0] ?? sel[0] ?? 0;
                                                })();
                                                const currentIdx = previewImageIdx !== null && previewImageIdx < allImages.length
                                                    ? previewImageIdx
                                                    : fallbackIdx;
                                                const displayUrl = allImages[currentIdx];
                                                return (
                                                    <>
                                                        <SafeImage
                                                            src={displayUrl}
                                                            alt="Main Preview"
                                                            className="w-full h-full object-contain p-3"
                                                        />
                                                        {allImages.length > 1 && (
                                                            <>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const prev = currentIdx <= 0 ? allImages.length - 1 : currentIdx - 1;
                                                                        setPreviewImageIdx(prev);
                                                                    }}
                                                                    aria-label="Previous image"
                                                                    className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur hover:bg-white text-earth/60 hover:text-earth rounded-full w-6 h-6 flex items-center justify-center shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-xs"
                                                                >
                                                                    ‹
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const next = currentIdx >= allImages.length - 1 ? 0 : currentIdx + 1;
                                                                        setPreviewImageIdx(next);
                                                                    }}
                                                                    aria-label="Next image"
                                                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur hover:bg-white text-earth/60 hover:text-earth rounded-full w-6 h-6 flex items-center justify-center shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-xs"
                                                                >
                                                                    ›
                                                                </button>
                                                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full text-[10px] font-medium text-earth/60 shadow-sm">
                                                                    {currentIdx + 1} / {allImages.length}
                                                                </div>
                                                            </>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </>
                                    ) : (
                                        <div
                                            onClick={() => imageUploadRef.current?.click()}
                                            className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-bronze/5 transition-colors"
                                        >
                                            <ImageIcon className="w-12 h-12 text-earth/10 mb-3" />
                                            <p className="text-sm text-earth/30 font-medium">No images yet</p>
                                            <p className="text-xs text-earth/20 mt-1">Tap to upload</p>
                                        </div>
                                    )}
                                    {(currentProduct.images?.length ?? 0) > 0 && (
                                        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-bold text-earth shadow-sm border border-white/50 tracking-widest uppercase">
                                            {(currentProduct.selectedImages?.length || currentProduct.images?.length || 0)} / {(currentProduct.images?.length || 0) + (currentProduct.descriptionImages?.length || 0)} Selected
                                        </div>
                                    )}
                                    </div>
                                </div>
                                
                                <div className="px-4 md:px-6 pb-5 w-full">
                                {/* Selectable Image Grid - CLICK TO SELECT */}
                                <div className="mb-4">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-earth/50 font-bold mb-2">Select Images for Import</p>
                                </div>
                                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                    {(currentProduct.images || []).map((img, i) => {
                                        const isSelected = currentProduct.selectedImages
                                            ? currentProduct.selectedImages.includes(i)
                                            : true; // By default all are selected
                                        const isPreviewing = (previewImageIdx ?? 0) === i;
                                        return (
                                            <div
                                                key={i}
                                                role="button"
                                                tabIndex={0}
                                                aria-pressed={isSelected}
                                                // Make the whole card toggle selection
                                                onClick={() => {
                                                    const currentSelected = currentProduct.selectedImages ||
                                                        (currentProduct.images || []).map((_, idx) => idx);
                                                    const newSelected = isSelected
                                                        ? currentSelected.filter(idx => idx !== i)
                                                        : [...currentSelected, i].sort((a, b) => a - b);
                                                    if (newSelected.length > 0) {
                                                        updateReviewProduct('selectedImages', newSelected);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        const currentSelected = currentProduct.selectedImages ||
                                                            (currentProduct.images || []).map((_, idx) => idx);
                                                        const newSelected = isSelected
                                                            ? currentSelected.filter(idx => idx !== i)
                                                            : [...currentSelected, i].sort((a, b) => a - b);
                                                        if (newSelected.length > 0) {
                                                            updateReviewProduct('selectedImages', newSelected);
                                                        }
                                                    }
                                                }}
                                                className={`aspect-square rounded-lg border-2 overflow-hidden bg-white/50 cursor-pointer transition-all duration-300 relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50
                                                    ${isPreviewing ? 'ring-2 ring-bronze/30 shadow-md' : ''}
                                                    ${isSelected ? 'border-green-500 shadow-[0_4px_12px_rgba(34,197,94,0.15)]' : 'border-white/40 opacity-50 hover:opacity-100 hover:border-earth/20'}`}
                                            >
                                                <SafeImage src={img} alt={`Product image ${i + 1}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                                
                                                {/* Selection Overlay */}
                                                <div className={`absolute inset-0 transition-opacity duration-300 ${isSelected ? 'bg-green-500/10' : 'bg-black/0 group-hover:bg-black/5'}`} />

                                                {/* Preview Button (Overlay) */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPreviewImageIdx(i);
                                                    }}
                                                    className="absolute inset-0 m-auto w-8 h-8 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 shadow-lg text-earth hover:text-bronze"
                                                    title="Preview Image"
                                                >
                                                    <Search className="w-3.5 h-3.5" />
                                                </button>

                                                {/* Checkbox Icon */}
                                                <div
                                                    className={`absolute top-1.5 right-1.5 rounded-full w-5 h-5 flex items-center justify-center shadow-sm transition-all duration-300 transform
                                                        ${isSelected ? 'bg-green-500 text-white scale-100' : 'bg-white/80 backdrop-blur border border-earth/10 text-earth/20 scale-90 group-hover:scale-100'}`}
                                                >
                                                    <Check className="w-3 h-3" />
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Upload Image Button */}
                                    <button
                                        type="button"
                                        onClick={() => !isUploadingImage && imageUploadRef.current?.click()}
                                        disabled={isUploadingImage}
                                        aria-label="Upload image"
                                        className="aspect-square rounded-lg border-2 border-dashed border-earth/20 bg-white/30 backdrop-blur-sm cursor-pointer hover:border-bronze/40 hover:bg-white/50 transition-all duration-300 flex flex-col items-center justify-center gap-1.5 shadow-inner disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50"
                                    >
                                        {isUploadingImage ? (
                                            <Loader2 className="w-5 h-5 text-bronze animate-spin" />
                                        ) : (
                                            <>
                                                <div className="p-2 bg-white/50 rounded-full shadow-sm"><Upload className="w-4 h-4 text-earth/50" /></div>
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-earth/50 font-bold">Upload</span>
                                            </>
                                        )}
                                    </button>
                                    <input
                                        ref={imageUploadRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleImageUpload}
                                    />
                                </div>

                                {/* Image Order Strip — drag/reorder selected images, green ✓ = main */}
                                {(() => {
                                    const combinedImages = [...(currentProduct.images || []), ...(currentProduct.descriptionImages || [])];
                                    const selected = currentProduct.selectedImages || (currentProduct.images || []).map((_, i) => i);
                                    // Use custom order if set, otherwise natural order of selected
                                    const ordered = currentProduct.imageOrder && currentProduct.imageOrder.length > 0
                                        ? currentProduct.imageOrder.filter(i => selected.includes(i))
                                        : [...selected];
                                    // Add any newly selected images not yet in the order
                                    const missing = selected.filter(i => !ordered.includes(i));
                                    const finalOrder = [...ordered, ...missing];

                                    if (finalOrder.length === 0) return null;

                                    return (
                                        <div className="mt-3 mb-2">
                                            <p className="text-[10px] uppercase tracking-widest text-earth/50 font-bold mb-2">Image Order <span className="normal-case text-earth/30">(drag to reorder · first = main listing image)</span></p>
                                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                                {finalOrder.map((imgIdx, pos) => {
                                                    const isMain = pos === 0;
                                                    const imgSrc = combinedImages[imgIdx];
                                                    if (!imgSrc) return null;
                                                    const isDragging = dragIdx === pos;
                                                    const isDragOver = dragOverIdx === pos;
                                                    return (
                                                        <div
                                                            key={imgIdx}
                                                            draggable
                                                            onDragStart={(e) => {
                                                                setDragIdx(pos);
                                                                e.dataTransfer.effectAllowed = 'move';
                                                                // Set a transparent drag image for cleaner look
                                                                const img = new Image();
                                                                img.src = imgSrc;
                                                                e.dataTransfer.setDragImage(img, 28, 28);
                                                            }}
                                                            onDragOver={(e) => {
                                                                e.preventDefault();
                                                                e.dataTransfer.dropEffect = 'move';
                                                                if (dragIdx !== null && dragIdx !== pos) {
                                                                    setDragOverIdx(pos);
                                                                }
                                                            }}
                                                            onDragLeave={() => {
                                                                if (dragOverIdx === pos) setDragOverIdx(null);
                                                            }}
                                                            onDrop={(e) => {
                                                                e.preventDefault();
                                                                if (dragIdx !== null && dragIdx !== pos) {
                                                                    const newOrder = [...finalOrder];
                                                                    const [moved] = newOrder.splice(dragIdx, 1);
                                                                    newOrder.splice(pos, 0, moved);
                                                                    updateReviewProduct('imageOrder', newOrder);
                                                                    setPreviewImageIdx(newOrder[0]);
                                                                }
                                                                setDragIdx(null);
                                                                setDragOverIdx(null);
                                                            }}
                                                            onDragEnd={() => {
                                                                setDragIdx(null);
                                                                setDragOverIdx(null);
                                                            }}
                                                            onTouchStart={() => {
                                                                // Touch start - drag is handled by HTML5 on desktop
                                                                // Arrow buttons below serve as mobile/keyboard fallback
                                                            }}
                                                            className={`relative flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all cursor-grab active:cursor-grabbing select-none
                                                                ${isMain ? 'border-green-500 ring-2 ring-green-300/40' : 'border-earth/10 hover:border-earth/30'}
                                                                ${isDragging ? 'opacity-40 scale-90' : ''}
                                                                ${isDragOver ? 'ring-2 ring-bronze/50 scale-105 border-bronze' : ''}`}
                                                        >
                                                            <SafeImage src={imgSrc} alt={`Order ${pos + 1}`} className="w-full h-full object-cover pointer-events-none" />
                                                            {/* Position badge */}
                                                            <div className={`absolute top-0.5 left-0.5 rounded-full w-5 h-5 flex items-center justify-center text-[9px] font-bold shadow-sm
                                                                ${isMain ? 'bg-green-500 text-white' : 'bg-white/90 backdrop-blur text-earth/60'}`}
                                                                title={isMain ? 'Main listing image' : `Position ${pos + 1}`}
                                                            >
                                                                {isMain ? <Check className="w-3 h-3" /> : pos + 1}
                                                            </div>
                                                            {/* Click to set as main (non-main only) */}
                                                            {!isMain && (
                                                                <button
                                                                    aria-label={`Set image ${pos + 1} as the main listing image`}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const newOrder = [imgIdx, ...finalOrder.filter(i => i !== imgIdx)];
                                                                        updateReviewProduct('imageOrder', newOrder);
                                                                        setPreviewImageIdx(newOrder[0]);
                                                                    }}
                                                                    className="absolute top-0.5 right-0.5 bg-white/90 hover:bg-green-100 backdrop-blur rounded-full w-5 h-5 flex items-center justify-center transition-colors shadow-sm"
                                                                    title="Set as main image"
                                                                >
                                                                    <Check className="w-3 h-3 text-earth/40" />
                                                                </button>
                                                            )}
                                                            {/* Arrow buttons — mobile/keyboard reorder fallback */}
                                                            <div className="absolute bottom-0.5 right-0.5 flex gap-px">
                                                                {pos > 0 && (
                                                                    <button
                                                                        aria-label={`Move image ${pos + 1} left`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const newOrder = [...finalOrder];
                                                                            [newOrder[pos - 1], newOrder[pos]] = [newOrder[pos], newOrder[pos - 1]];
                                                                            updateReviewProduct('imageOrder', newOrder);
                                                                            if (previewImageIdx === null || previewImageIdx === finalOrder[0]) setPreviewImageIdx(newOrder[0]);
                                                                        }}
                                                                        className="bg-white/90 hover:bg-white backdrop-blur rounded-sm w-5 h-5 flex items-center justify-center text-earth/50 hover:text-earth transition-colors"
                                                                        title="Move left"
                                                                    >
                                                                        <ChevronLeft className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                                {pos < finalOrder.length - 1 && (
                                                                    <button
                                                                        aria-label={`Move image ${pos + 1} right`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const newOrder = [...finalOrder];
                                                                            [newOrder[pos], newOrder[pos + 1]] = [newOrder[pos + 1], newOrder[pos]];
                                                                            updateReviewProduct('imageOrder', newOrder);
                                                                            if (previewImageIdx === null || previewImageIdx === finalOrder[0]) setPreviewImageIdx(newOrder[0]);
                                                                        }}
                                                                        className="bg-white/90 hover:bg-white backdrop-blur rounded-sm w-5 h-5 flex items-center justify-center text-earth/50 hover:text-earth transition-colors"
                                                                        title="Move right"
                                                                    >
                                                                        <ChevronRight className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Empty state when no images */}
                                {(currentProduct.images?.length ?? 0) === 0 && (
                                    <div className="flex flex-col items-center justify-center py-6 text-center">
                                        <ImageIcon className="w-10 h-10 text-earth/15 mb-3" />
                                        <p className="text-xs text-earth/40 mb-3">No images available</p>
                                        <button
                                            onClick={() => imageUploadRef.current?.click()}
                                            className="px-4 py-2 bg-earth text-cream rounded-xl text-[10px] uppercase tracking-widest font-bold hover:bg-bronze transition-colors shadow-sm"
                                        >
                                            <Upload className="w-3 h-3 inline mr-1" /> Upload Images
                                        </button>
                                    </div>
                                )}
                                {/* Description/Marketing Images from 1688 */}
                                {currentProduct.descriptionImages && currentProduct.descriptionImages.length > 0 && (
                                    <div className="mt-8">
                                        <div className="flex items-center gap-2 mb-4">
                                            <h4 className="text-[10px] uppercase tracking-[0.2em] text-earth/50 font-bold">
                                                Additional Details ({currentProduct.descriptionImages.length})
                                            </h4>
                                            <div className="h-px flex-1 bg-gradient-to-r from-earth/10 to-transparent" />
                                        </div>
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                            {currentProduct.descriptionImages.map((img, idx) => {
                                                // Marketing images are offset by main images count for selection indices
                                                const globalIdx = (currentProduct.images?.length || 0) + idx;
                                                const isSelected = currentProduct.selectedImages
                                                    ? currentProduct.selectedImages.includes(globalIdx)
                                                    : false; // Marketing images not selected by default
                                                const isPreviewing = previewImageIdx === globalIdx;
                                                return (
                                                    <div
                                                        key={`mktg-${idx}`}
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-pressed={isSelected}
                                                        onClick={() => {
                                                            const currentSelected = currentProduct.selectedImages || (currentProduct.images || []).map((_, i) => i);
                                                            const newSelected = isSelected
                                                                ? currentSelected.filter(id => id !== globalIdx)
                                                                : [...currentSelected, globalIdx].sort((a, b) => a - b);
                                                            updateReviewProduct('selectedImages', newSelected);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                const currentSelected = currentProduct.selectedImages || (currentProduct.images || []).map((_, i) => i);
                                                                const newSelected = isSelected
                                                                    ? currentSelected.filter(id => id !== globalIdx)
                                                                    : [...currentSelected, globalIdx].sort((a, b) => a - b);
                                                                updateReviewProduct('selectedImages', newSelected);
                                                            }
                                                        }}
                                                        className={`aspect-square rounded-[1.5rem] border-[3px] overflow-hidden bg-white/50 cursor-pointer transition-all duration-300 relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50
                                                            ${isPreviewing ? 'ring-4 ring-bronze/30 shadow-lg' : ''}
                                                            ${isSelected ? 'border-green-500 shadow-[0_10px_20px_rgba(34,197,94,0.2)]' : 'border-white/40 opacity-50 hover:opacity-100 hover:border-earth/20'}`}
                                                    >
                                                        <SafeImage
                                                            src={img}
                                                            alt={`Marketing ${idx + 1}`}
                                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                                        />
                                                        
                                                        <div className={`absolute inset-0 transition-opacity duration-300 ${isSelected ? 'bg-green-500/10' : 'bg-black/0 group-hover:bg-black/5'}`} />

                                                        {/* Preview Button (Overlay) */}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPreviewImageIdx(globalIdx);
                                                            }}
                                                            className="absolute inset-0 m-auto w-12 h-12 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 shadow-xl text-earth hover:text-bronze"
                                                            title="Preview Image"
                                                        >
                                                            <Search className="w-5 h-5" />
                                                        </button>

                                                        {/* Checkbox Icon */}
                                                        <div
                                                            className={`absolute top-3 right-3 rounded-full w-8 h-8 flex items-center justify-center shadow-lg transition-all duration-300 transform
                                                                ${isSelected ? 'bg-green-500 text-white scale-100' : 'bg-white/80 backdrop-blur border border-earth/10 text-earth/20 scale-90 group-hover:scale-100'}`}
                                                        >
                                                            <Check className="w-4 h-4" />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-8 space-y-6">
                                    <div>
                                        <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold block mb-2">Original URL</label>
                                        <a href={currentProduct.productUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-bronze hover:underline text-sm truncate">
                                            <Link className="w-3 h-3" />
                                            {currentProduct.productUrl || 'No Link'}
                                        </a>
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold block mb-2">Original Price</label>
                                        <span className="text-lg font-serif text-earth/60 line-through decoration-bronze/30">
                                            ${(currentProduct.salePrice || currentProduct.price).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                                </div> {/* End Visuals Section Content */}
                            </div>

                            {/* SECTION 2: PRODUCT DETAILS */}
                            <div className="w-full bg-white/40 backdrop-blur-md p-4 md:p-6 border-b border-earth/10">
                                <div className="text-center mb-6">
                                    <h3 className="font-serif text-lg text-earth">Step 2: Details & Story</h3>
                                    <p className="text-earth/60 font-light mt-1 max-w-md mx-auto text-xs">Enhance the product name, set pricing margins, and generate a description.</p>
                                </div>
                                
                                <div className="space-y-6">
                                        {/* Product Name */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">Product Name</label>
                                                <button
                                                    onClick={() => enhanceNameWithAI(currentProduct.id)}
                                                    disabled={currentProduct.isEnhancing}
                                                    className="text-[10px] uppercase tracking-widest text-purple-600 flex items-center gap-1 hover:text-purple-700 font-bold disabled:opacity-50"
                                                >
                                                    <Wand2 className="w-3 h-3" /> Smart Name
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                value={currentProduct.customName || currentProduct.name}
                                                onChange={(e) => updateReviewProduct('customName', e.target.value)}
                                                className="w-full p-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-lg font-serif text-sm text-earth focus:bg-white/80 focus:ring-2 ring-bronze/30 focus:border-bronze transition-all shadow-sm placeholder-earth/40"
                                            />
                                        </div>

                                        {/* Categorization */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">Collection</label>
                                                <div className="relative">
                                                    <select
                                                        value={currentProduct.targetCollection || targetCollection}
                                                        onChange={(e) => {
                                                            const newCollection = e.target.value;
                                                            updateReviewProduct('targetCollection', newCollection);
                                                            updateReviewProduct('targetSubcategory', '');
                                                            // Recalculate price for the new collection's shipping cost
                                                            const newPrice = calculateCostStackPrice(
                                                                currentProduct.salePrice || currentProduct.price,
                                                                newCollection
                                                            ).sellingPrice;
                                                            updateReviewProduct('customPrice', newPrice);
                                                        }}
                                                        className="w-full p-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-lg text-xs text-earth appearance-none focus:bg-white/80 focus:ring-2 ring-bronze/30 shadow-sm font-medium transition-all"
                                                    >
                                                        {collections.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                                                    </select>
                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-earth/40 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">Sub-Category</label>
                                                <div className="relative">
                                                    <select
                                                        value={currentProduct.targetSubcategory || targetSubcategory}
                                                        onChange={(e) => updateReviewProduct('targetSubcategory', e.target.value)}
                                                        className="w-full p-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-lg text-xs text-earth appearance-none focus:bg-white/80 focus:ring-2 ring-bronze/30 shadow-sm font-medium transition-all"
                                                    >
                                                        <option value="">Select Sub-Category</option>
                                                        {getSubcategoriesForCollection(currentProduct.targetCollection || targetCollection as string).map(s => (
                                                            <option key={s.id} value={s.id}>{s.title}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-earth/40 pointer-events-none" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Pricing */}
                                        {(() => {
                                            const pCollection = currentProduct.targetCollection || targetCollection;
                                            const pStack = calculateCostStackPrice(currentProduct.salePrice || currentProduct.price, pCollection);
                                            const hasCustomPrice =
                                                typeof currentProduct.customPrice === 'number' && Number.isFinite(currentProduct.customPrice);
                                            const displayPrice = hasCustomPrice ? currentProduct.customPrice! : pStack.sellingPrice;
                                            return (
                                                <div className="bg-white/40 backdrop-blur-md p-4 md:p-5 rounded-xl border border-white/40 shadow-md space-y-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">Your Price ($)</label>
                                                            <input
                                                                type="number"
                                                                min="0.01"
                                                                defaultValue={displayPrice}
                                                                key={`price-${currentProduct.id}-${displayPrice}`}
                                                                onBlur={(e) => {
                                                                    const value = Number(e.target.value);
                                                                    updateReviewProduct('customPrice', Number.isFinite(value) && value > 0 ? value : undefined);
                                                                }}
                                                                className="w-full p-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-lg font-serif text-lg text-bronze font-bold focus:bg-white/80 focus:ring-2 ring-bronze/30 shadow-sm transition-all"
                                                            />
                                                        </div>
                                                        <div className="space-y-1 flex flex-col justify-center">
                                                            <div className="flex justify-between text-xs text-earth/60">
                                                                <span>1688 Cost (USD):</span>
                                                                <span>${(currentProduct.salePrice || currentProduct.price).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs text-earth/60">
                                                                <span>Est. CJ Cost (×1.2):</span>
                                                                <span>${pStack.estimatedCjCost.toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs text-earth/60">
                                                                <span>Shipping ({pCollection}):</span>
                                                                <span>${pStack.estimatedShipping.toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs text-earth/60 border-t border-earth/10 pt-1 mt-1">
                                                                <span>Selling (×2):</span>
                                                                <span className="font-bold">${pStack.sellingPrice.toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs font-bold text-green-700 border-t border-earth/10 pt-1 mt-1">
                                                                <span>Profit:</span>
                                                                <span>${(displayPrice - (pStack.estimatedCjCost + pStack.estimatedShipping)).toFixed(2)}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {hasCustomPrice && currentProduct.customPrice !== pStack.sellingPrice && (
                                                        <button
                                                            onClick={() => updateReviewProduct('customPrice', pStack.sellingPrice)}
                                                            className="text-[10px] text-bronze hover:underline flex items-center gap-1"
                                                        >
                                                            <RotateCcw className="w-3 h-3" /> Reset to formula price (${pStack.sellingPrice.toFixed(2)})
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* Description */}
                                        <div className="space-y-2 flex-1">
                                            <div className="flex justify-between">
                                                <label className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">Description</label>
                                                <button
                                                    onClick={() => enhanceDescriptionWithAI(currentProduct.id)}
                                                    disabled={currentProduct.isEnhancing}
                                                    className="text-[10px] uppercase tracking-widest text-purple-600 flex items-center gap-1 hover:text-purple-700 font-bold disabled:opacity-50"
                                                >
                                                    <Wand2 className="w-3 h-3" /> Smart Description
                                                </button>
                                            </div>
                                            <textarea
                                                rows={4}
                                                value={currentProduct.customDescription || currentProduct.description || ''}
                                                onChange={(e) => {
                                                    updateReviewProduct('customDescription', e.target.value);
                                                    if (currentProduct.descriptionAuditId) {
                                                        updateReviewProduct('smartDescriptionAdminEdited', true);
                                                    }
                                                }}
                                                className="w-full p-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-lg text-xs text-earth/90 focus:bg-white/80 focus:ring-2 ring-bronze/30 shadow-sm resize-none transition-all"
                                            />
                                            {(currentProduct.descriptionAuditId || currentProduct.smartDescriptionSourceQuality !== undefined || (currentProduct.smartDescriptionWarnings?.length ?? 0) > 0) && (
                                                <div className="mt-2 rounded-lg border border-purple-100 bg-purple-50/70 p-2 text-[10px] text-earth/60 space-y-1">
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                        {currentProduct.smartDescriptionSourceQuality !== undefined && (
                                                            <span>Source quality: {currentProduct.smartDescriptionSourceQuality}/100</span>
                                                        )}
                                                        {currentProduct.descriptionAuditId && (
                                                            <span>Audit: {String(currentProduct.descriptionAuditId).slice(0, 10)}...</span>
                                                        )}
                                                        {currentProduct.smartDescriptionFallbackUsed && (
                                                            <span className="text-amber-700">Fallback used</span>
                                                        )}
                                                    </div>
                                                    {currentProduct.smartDescriptionWarnings?.map((warning, index) => (
                                                        <p key={`${warning}-${index}`} className="text-amber-700">{warning}</p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            
                            {/* SECTION 3: VARIANTS */}
                            {currentProduct.variants && currentProduct.variants.length > 0 && (
                                <div className="w-full p-4 md:p-6 mt-3">
                                    <div className="text-center mb-6">
                                        <h3 className="font-serif text-lg text-earth">Step 3: Variants</h3>
                                        <p className="text-earth/60 font-light mt-1 max-w-md mx-auto text-xs">Manage styles, sizes, stock status, and assign images.</p>
                                    </div>
                                    
                                    <div className="w-full bg-white/40 backdrop-blur-md p-4 md:p-6 rounded-xl border border-white/40 shadow-lg overflow-hidden">
                                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-earth/10">
                                            <h4 className="text-xs uppercase tracking-[0.2em] text-earth font-bold">
                                                Active Variants ({currentProduct.selectedVariants?.length ?? currentProduct.variants.length}/{currentProduct.variants.length})
                                            </h4>
                                            <button
                                                onClick={() => {
                                                    const allIds = currentProduct.variants!.map(v => v.id);
                                                    const currentSelected = currentProduct.selectedVariants;
                                                    const allCurrentlySelected = currentSelected === undefined || currentSelected.length === allIds.length;
                                                    const newSelected = allCurrentlySelected ? [] : undefined;
                                                    updateReviewProduct('selectedVariants', newSelected);
                                                }}
                                                className="text-xs text-bronze hover:underline font-bold tracking-widest uppercase bg-bronze/10 px-4 py-2 rounded-full transition-all"
                                            >
                                                {(currentProduct.selectedVariants?.length ?? currentProduct.variants.length) === currentProduct.variants.length ? 'Deselect All' : 'Select All'}
                                            </button>
                                        </div>

                                        {/* ── STAMP MODE: Image Gallery for batch variant assignment ── */}
                                        {(() => {
                                            const allImages = [...(currentProduct.images || []), ...(currentProduct.descriptionImages || [])];
                                            const selected = currentProduct.selectedImages || (currentProduct.images || []).map((_: string, i: number) => i);
                                            const ordered = currentProduct.imageOrder && currentProduct.imageOrder.length > 0
                                                ? currentProduct.imageOrder.filter((i: number) => selected.includes(i))
                                                : [...selected];
                                            const missing = selected.filter((i: number) => !ordered.includes(i));
                                            const stampImages = [...ordered, ...missing];

                                            if (stampImages.length === 0) return null;

                                            return (
                                                <div className="mb-4 pb-4 border-b border-earth/10">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <p className="text-[10px] uppercase tracking-widest text-earth/50 font-bold">
                                                            {activeStampImage !== null ? (
                                                                <span className="text-bronze">🎯 Stamp Mode Active — tap variants below to assign</span>
                                                            ) : (
                                                                <span>Tap an image to stamp it onto variants</span>
                                                            )}
                                                        </p>
                                                        {activeStampImage !== null && (
                                                            <button
                                                                onClick={() => setActiveStampImage(null)}
                                                                className="text-[10px] uppercase tracking-widest text-red-500 hover:text-red-700 bg-red-50 px-3 py-1 rounded-full font-bold transition-colors flex items-center gap-1"
                                                            >
                                                                <X className="w-3 h-3" /> Cancel Stamp
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
                                                        {stampImages.map((imgIdx: number) => {
                                                            const imgSrc = allImages[imgIdx];
                                                            if (!imgSrc) return null;
                                                            const isActiveStamp = activeStampImage === imgIdx;
                                                            // Count variants using this image
                                                            const variantsUsingThis = currentProduct.variants!.filter(v => {
                                                                const mapped = currentProduct.variantImageMap?.[v.id];
                                                                return mapped === imgIdx;
                                                            }).length;

                                                            return (
                                                                <button
                                                                    key={imgIdx}
                                                                    type="button"
                                                                    onClick={() => setActiveStampImage(isActiveStamp ? null : imgIdx)}
                                                                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all duration-200
                                                                        ${isActiveStamp
                                                                            ? 'border-bronze ring-2 ring-bronze/30 shadow-lg scale-[1.05] z-10'
                                                                            : 'border-earth/10 hover:border-earth/30 hover:shadow-sm'}`}
                                                                >
                                                                    <SafeImage src={imgSrc} alt={`Stamp ${imgIdx + 1}`} className="w-full h-full object-cover" />
                                                                    {isActiveStamp && (
                                                                        <div className="absolute inset-0 bg-bronze/20 flex items-center justify-center">
                                                                            <div className="bg-white/90 rounded-full p-1 shadow-md">
                                                                                <Check className="w-4 h-4 text-bronze" />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {variantsUsingThis > 0 && !isActiveStamp && (
                                                                        <div className="absolute bottom-0.5 right-0.5 bg-green-500 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow-sm">
                                                                            {variantsUsingThis}
                                                                        </div>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                            {currentProduct.variants.map((variant) => {
                                                const isSelected = currentProduct.selectedVariants ? currentProduct.selectedVariants.includes(variant.id) : true;
                                                const originalName = currentProduct.originalVariants?.find(ov => ov.id === variant.id)?.name;
                                                const nameWasEdited = originalName && variant.name !== originalName;
                                                const allImages = [...(currentProduct.images || []), ...(currentProduct.descriptionImages || [])];
                                                const allocatedIdx = currentProduct.variantImageMap?.[variant.id];
                                                const allocatedImage = allocatedIdx !== undefined ? allImages[allocatedIdx] : undefined;
                                                const displayImage = allocatedImage || variant.image || currentProduct.images?.[0];
                                                const isStampMode = activeStampImage !== null;
                                                
                                                return (
                                                    <div
                                                        key={variant.id}
                                                        className={`rounded-3xl transition-all border-4 overflow-hidden relative
                                                            ${isStampMode ? 'cursor-pointer hover:scale-[1.01] hover:shadow-xl' : ''}
                                                            ${isSelected
                                                                ? 'bg-white border-green-500 shadow-lg'
                                                                : 'bg-white/30 border-white/40 opacity-60 hover:opacity-100 hover:border-earth/20'}`}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                // STAMP MODE: assign the active stamp image to this variant
                                                                if (isStampMode) {
                                                                    updateReviewProduct('variantImageMap', { ...(currentProduct.variantImageMap || {}), [variant.id]: activeStampImage });
                                                                    updateReviewProduct('variants', currentProduct.variants!.map(v => v.id === variant.id ? { ...v, image: allImages[activeStampImage!] } : v));
                                                                    setLastUsedImage(activeStampImage);
                                                                    return;
                                                                }
                                                                // NORMAL MODE: toggle variant selection
                                                                const allIds = currentProduct.variants!.map(v => v.id);
                                                                const currentSelectedVars = currentProduct.selectedVariants || allIds;
                                                                const newSelected = isSelected ? currentSelectedVars.filter(id => id !== variant.id) : [...currentSelectedVars, variant.id];
                                                                updateReviewProduct('selectedVariants', newSelected);
                                                            }}
                                                            className="flex items-center gap-4 p-4 md:p-5 cursor-pointer w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bronze/50"
                                                        >
                                                            {/* Variant Image */}
                                                            <div
                                                                role="button"
                                                                tabIndex={0}
                                                                aria-label={`Assign image for ${variant.name}`}
                                                                className="w-20 h-20 rounded-2xl border-2 border-earth/10 bg-white flex items-center justify-center overflow-hidden flex-shrink-0 relative group/img cursor-pointer hover:border-bronze shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const pickerKey = `${currentProduct.id}:${variant.id}`;
                                                                    setOpenImagePicker(prev => prev === pickerKey ? null : pickerKey);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        const pickerKey = `${currentProduct.id}:${variant.id}`;
                                                                        setOpenImagePicker(prev => prev === pickerKey ? null : pickerKey);
                                                                    }
                                                                }}
                                                            >
                                                                {displayImage ? (
                                                                    <SafeImage src={displayImage} alt={variant.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <Package className="w-8 h-8 text-earth/20" />
                                                                )}
                                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                                                    <ImageIcon className="w-6 h-6 text-white" />
                                                                </div>
                                                            </div>
                                                            
                                                            <div className="flex-1 min-w-0 pr-4">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <input
                                                                        type="text"
                                                                        value={variant.name}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onChange={(e) => {
                                                                            const updatedVariants = currentProduct.variants!.map(v => v.id === variant.id ? { ...v, name: e.target.value } : v);
                                                                            updateReviewProduct('variants', updatedVariants);
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            if (!e.target.value.trim() && originalName) {
                                                                                const updatedVariants = currentProduct.variants!.map(v => v.id === variant.id ? { ...v, name: originalName } : v);
                                                                                updateReviewProduct('variants', updatedVariants);
                                                                            }
                                                                        }}
                                                                        className="w-full bg-earth/5 font-medium text-earth text-sm border border-transparent hover:border-earth/20 focus:border-bronze focus:bg-white focus:outline-none truncate px-3 py-1 rounded-lg transition-all"
                                                                        placeholder={originalName || 'Variant name'}
                                                                    />
                                                                    {nameWasEdited && (
                                                                        <button onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const updatedVariants = currentProduct.variants!.map(v => v.id === variant.id ? { ...v, name: originalName! } : v);
                                                                            updateReviewProduct('variants', updatedVariants);
                                                                        }} className="p-1.5 bg-earth/5 rounded-full text-earth/50 hover:text-earth hover:bg-earth/10 transition-colors" title={`Reset to: ${originalName}`}>
                                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {originalName && nameWasEdited && <p className="text-[10px] text-earth/40 ml-1 mb-2 truncate">Ref: {originalName}</p>}
                                                                
                                                                <div className="flex items-center gap-3 mt-2 text-xs font-bold pl-1">
                                                                    <span className={variant.inStock ? 'text-green-600 bg-green-50 px-2 py-0.5 rounded-full' : 'text-red-500 bg-red-50 px-2 py-0.5 rounded-full'}>
                                                                        {variant.inStock ? 'In Stock' : 'Out of Stock'}
                                                                    </span>
                                                                    {variant.priceAdjustment !== 0 && (
                                                                        <span className={`${variant.priceAdjustment > 0 ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50'} px-2 py-0.5 rounded-full`}>
                                                                            {variant.priceAdjustment > 0 ? '+' : ''}${variant.priceAdjustment.toFixed(2)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all shadow-md
                                                                ${isSelected ? 'bg-green-500 text-white scale-100' : 'bg-white border-2 border-earth/20 text-transparent scale-90'}`}>
                                                                <Check className="w-5 h-5" />
                                                            </div>
                                                        </button>
                                                        
                                                        {openImagePicker === `${currentProduct.id}:${variant.id}` && (
                                                            <div className="border-t-2 border-earth/5 p-4 bg-white/95">
                                                                <p className="text-[10px] uppercase tracking-widest text-earth/50 font-bold mb-3">
                                                                    Assign specific image
                                                                    {lastUsedImage !== null && <span className="text-bronze ml-2">(★ = last used)</span>}
                                                                </p>
                                                                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                                                    {/* Sort images: last-used first, then by index */}
                                                                    {(() => {
                                                                        const imageIndices = allImages.map((_: string, i: number) => i);
                                                                        // Move lastUsedImage to front if set
                                                                        if (lastUsedImage !== null && lastUsedImage < allImages.length) {
                                                                            const idx = imageIndices.indexOf(lastUsedImage);
                                                                            if (idx > 0) {
                                                                                imageIndices.splice(idx, 1);
                                                                                imageIndices.unshift(lastUsedImage);
                                                                            }
                                                                        }
                                                                        return imageIndices.map((imgIdx: number) => (
                                                                            <div
                                                                                key={imgIdx}
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                aria-label={`Assign image ${imgIdx + 1} to variant`}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    updateReviewProduct('variantImageMap', { ...(currentProduct.variantImageMap || {}), [variant.id]: imgIdx });
                                                                                    updateReviewProduct('variants', currentProduct.variants!.map(v => v.id === variant.id ? { ...v, image: allImages[imgIdx] } : v));
                                                                                    setLastUsedImage(imgIdx);
                                                                                    setOpenImagePicker(null);
                                                                                }}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                                                        e.preventDefault();
                                                                                        e.stopPropagation();
                                                                                        updateReviewProduct('variantImageMap', { ...(currentProduct.variantImageMap || {}), [variant.id]: imgIdx });
                                                                                        updateReviewProduct('variants', currentProduct.variants!.map(v => v.id === variant.id ? { ...v, image: allImages[imgIdx] } : v));
                                                                                        setLastUsedImage(imgIdx);
                                                                                        setOpenImagePicker(null);
                                                                                    }
                                                                                }}
                                                                                className={`relative w-14 h-14 md:w-16 md:h-16 flex-shrink-0 rounded-xl border-2 cursor-pointer overflow-hidden hover:opacity-80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50
                                                                                ${allocatedIdx === imgIdx ? 'border-bronze ring-2 ring-transparent shadow-lg' : imgIdx === lastUsedImage ? 'border-amber-400/60' : 'border-earth/10'}`}>
                                                                                <SafeImage src={allImages[imgIdx]} alt={`Option ${imgIdx + 1}`} className="w-full h-full object-cover" />
                                                                                {imgIdx === lastUsedImage && allocatedIdx !== imgIdx && (
                                                                                    <div className="absolute top-0.5 left-0.5 bg-amber-400 text-white text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center shadow-sm">★</div>
                                                                                )}
                                                                            </div>
                                                                        ));
                                                                    })()}
                                                                </div>
                                                                {allocatedIdx !== undefined && (
                                                                    <div className="mt-3 flex justify-end">
                                                                        <button onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const newMap = { ...(currentProduct.variantImageMap || {}) };
                                                                            delete newMap[variant.id];
                                                                            updateReviewProduct('variantImageMap', newMap);
                                                                            const origVariant = currentProduct.originalVariants?.find(ov => ov.id === variant.id);
                                                                            updateReviewProduct('variants', currentProduct.variants!.map(v => v.id === variant.id ? { ...v, image: origVariant?.image || undefined } : v));
                                                                            setOpenImagePicker(null);
                                                                        }} className="text-[10px] uppercase tracking-widest font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1">
                                                                            <X className="w-3 h-3" /> Clear Assignment
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                            
                            <div className="h-32 flex-shrink-0"></div> {/* Bottom spacer padding */}
                        </div>
                    </div>
                </FadeIn>
                <nav aria-label="Mobile product review actions" className="fixed inset-x-3 bottom-3 z-[70] grid grid-cols-3 gap-2 rounded-2xl border border-white/60 bg-white/85 p-2 shadow-2xl backdrop-blur-2xl md:hidden">
                    <button type="button" onClick={() => enhanceNameWithAI(currentProduct.id)} disabled={currentProduct.isEnhancing} className="min-h-12 rounded-xl bg-purple-50 px-2 text-[9px] font-bold uppercase tracking-wider text-purple-700 disabled:opacity-50">
                        <Wand2 className="mx-auto mb-1 h-4 w-4" />Name
                    </button>
                    <button type="button" onClick={() => enhanceDescriptionWithAI(currentProduct.id)} disabled={currentProduct.isEnhancing} className="min-h-12 rounded-xl bg-purple-50 px-2 text-[9px] font-bold uppercase tracking-wider text-purple-700 disabled:opacity-50">
                        <Wand2 className="mx-auto mb-1 h-4 w-4" />Description
                    </button>
                    {reviewIndex < selectedProducts.length - 1 ? (
                        <button type="button" onClick={() => setReviewIndex(prev => Math.min(selectedProducts.length - 1, prev + 1))} className="min-h-12 rounded-xl bg-earth px-2 text-[9px] font-bold uppercase tracking-wider text-cream">
                            Next <ChevronRight className="mx-auto mt-1 h-4 w-4" />
                        </button>
                    ) : (
                        <button type="button" onClick={() => setImportStep('final-review')} className="min-h-12 rounded-xl bg-green-700 px-2 text-[9px] font-bold uppercase tracking-wider text-white">
                            Batch <Check className="mx-auto mt-1 h-4 w-4" />
                        </button>
                    )}
                </nav>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FINAL REVIEW PAGE — Storefront-style preview before import
    // ═══════════════════════════════════════════════════════════════════════
    if (importStep === 'final-review') {
        const selectedProducts = getReviewBatch();

        // Per-variant selling price calculator (returns explicit override when present)
        const getVariantSellingPrice = (product: ImportableProduct, variant: { priceAdjustment: number; sellingPriceOverride?: number }) => {
            if (typeof variant.sellingPriceOverride === 'number' && Number.isFinite(variant.sellingPriceOverride)) {
                return variant.sellingPriceOverride;
            }
            const basePrice = product.salePrice || product.price;
            const variantPrice1688 = basePrice + variant.priceAdjustment;
            const collection = product.targetCollection || targetCollection;
            // Apply same scaling logic as confirmImport for preview parity
            const costStackBase = calculateCostStackPrice(product.salePrice || product.price, collection).sellingPrice;
            const hasCustomPrice = typeof product.customPrice === 'number' && Number.isFinite(product.customPrice);
            const markupRatio = hasCustomPrice && costStackBase > 0 ? product.customPrice! / costStackBase : 1;
            return getScaledVariantSelling(variantPrice1688, collection, markupRatio, hasCustomPrice);
        };


        return (
            <div className="min-h-[80vh] flex flex-col items-center p-4 md:p-8 relative z-20">


                <FadeIn className="w-full max-w-6xl" mobileFast>
                    <div className="glass-panel rounded-[2.5rem] overflow-hidden relative shadow-2xl border border-white/60">
                        {/* Header */}
                        <div className="bg-cream/50 p-4 md:p-8 border-b border-earth/5 flex flex-col md:flex-row gap-3 md:gap-0 justify-between md:items-center">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setImportStep('review')}
                                    className="flex items-center gap-2 text-earth/60 hover:text-earth transition-colors text-xs uppercase tracking-widest font-bold"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Back to Review
                                </button>
                                <div className="h-4 w-px bg-earth/10"></div>
                                <span className="text-xl font-serif text-earth">Final Preview — {selectedProducts.length} Product{selectedProducts.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleSaveImportDraft}
                                    className="px-5 py-3 rounded-full border border-bronze/30 bg-white/50 text-bronze hover:bg-white transition-all text-xs uppercase tracking-widest font-bold"
                                >
                                    Save Draft
                                </button>
                                <button
                                    onClick={confirmImport}
                                    disabled={isImporting}
                                    className="px-8 py-3 rounded-full bg-green-700 text-white hover:bg-green-600 transition-all text-xs uppercase tracking-widest font-bold shadow-lg shadow-green-900/20 flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Check className="w-4 h-4" /> Confirm & Import ({selectedProducts.length})
                                </button>
                            </div>
                        </div>

                        {/* Product Cards */}
                        <div className="p-4 md:p-8 space-y-8 max-h-[70vh] overflow-y-auto">
                            {selectedProducts.map((product, productIdx) => {
                                const pCollection = product.targetCollection || targetCollection;
                                const pStack = calculateCostStackPrice(product.salePrice || product.price, pCollection);
                                const hasCustomPrice = typeof product.customPrice === 'number' && Number.isFinite(product.customPrice);
                                const displayPrice = hasCustomPrice ? product.customPrice! : pStack.sellingPrice;
                                const orderedImages = getOrderedImages(product);
                                const filteredVariants = product.selectedVariants === undefined
                                    ? product.variants
                                    : product.variants?.filter(v => product.selectedVariants!.includes(v.id));

                                return (
                                    <div key={product.id} className="bg-white rounded-2xl border border-earth/10 overflow-hidden shadow-sm">
                                        <div className="flex flex-col lg:flex-row">
                                            {/* Image Gallery — Scrollable Slideshow */}
                                            <div className="lg:w-80 flex-shrink-0 bg-cream/20 p-4">
                                                {orderedImages.length > 0 && (
                                                    <ProductImageGallery
                                                        images={orderedImages}
                                                        activeIndex={reviewGalleryIdx[product.id] ?? 0}
                                                        onIndexChange={(i) => setReviewGalleryIdx(prev => ({ ...prev, [product.id]: i }))}
                                                        alt={product.customName || product.name}
                                                    />
                                                )}
                                            </div>

                                            {/* Product Details */}
                                            <div className="flex-1 p-4 md:p-6 space-y-4">
                                                {/* Title + Collection */}
                                                <div>
                                                    <div className="flex items-start justify-between gap-4">
                                                        <h3 className="text-lg font-serif text-earth leading-tight">{product.customName || product.name}</h3>
                                                        <span className="text-xs uppercase tracking-widest bg-cream px-3 py-1 rounded-full text-earth/60 font-bold flex-shrink-0">
                                                            {collections.find(c => c.id === pCollection)?.title || pCollection}
                                                        </span>
                                                    </div>
                                                    {(product.customDescription || product.description) && (
                                                        <p className="text-sm text-earth/50 mt-1 line-clamp-2">{product.customDescription || product.description}</p>
                                                    )}
                                                </div>

                                                {/* Base Price Summary */}
                                                <div className="bg-cream/40 rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                                                    <div>
                                                        <p className="text-[9px] uppercase tracking-widest text-earth/40 font-bold">1688 Cost</p>
                                                        <p className="text-sm font-bold text-earth">${(product.salePrice || product.price).toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] uppercase tracking-widest text-earth/40 font-bold">Est. CJ (×1.2)</p>
                                                        <p className="text-sm font-bold text-earth">${pStack.estimatedCjCost.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] uppercase tracking-widest text-earth/40 font-bold">Shipping</p>
                                                        <p className="text-sm font-bold text-earth">${pStack.estimatedShipping.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] uppercase tracking-widest text-earth/40 font-bold">Selling Price</p>
                                                        <p className="text-lg font-bold text-green-700">${displayPrice.toFixed(2)}</p>
                                                    </div>
                                                </div>

                                                {/* Variant Pricing Table */}
                                                {filteredVariants && filteredVariants.length > 0 && (
                                                    <div>
                                                        <h4 className="text-[10px] uppercase tracking-widest text-earth/50 font-bold mb-2">
                                                            Variant Pricing ({filteredVariants.length} variant{filteredVariants.length !== 1 ? 's' : ''})
                                                        </h4>
                                                        <div className="border border-earth/10 rounded-xl overflow-hidden">
                                                            <table className="w-full text-sm">
                                                                <thead>
                                                                    <tr className="bg-cream/50 text-left">
                                                                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest text-earth/50 font-bold">Variant</th>
                                                                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest text-earth/50 font-bold text-right">1688 Cost</th>
                                                                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest text-earth/50 font-bold text-right">Selling Price</th>
                                                                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest text-earth/50 font-bold text-right w-28">Override</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-earth/5">
                                                                    {filteredVariants.map((variant) => {
                                                                        const variantBasePrice = (product.salePrice || product.price) + variant.priceAdjustment;
                                                                        const variantSelling = getVariantSellingPrice(product, variant);
                                                                        return (
                                                                            <tr key={variant.id} className="hover:bg-cream/20 transition-colors">
                                                                                <td className="px-3 py-2">
                                                                                    <div className="flex items-center gap-2">
                                                                                        {variant.image && (
                                                                                            <SafeImage src={variant.image} alt={variant.name} className="w-8 h-8 rounded-md object-cover border border-earth/10" />
                                                                                        )}
                                                                                        <span className="text-earth truncate max-w-[160px]">{variant.name}</span>
                                                                                        {variant.priceAdjustment !== 0 && (
                                                                                            <span className={`text-xs ${variant.priceAdjustment > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                                                {variant.priceAdjustment > 0 ? '+' : ''}${variant.priceAdjustment.toFixed(2)}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-3 py-2 text-right text-earth/60">${variantBasePrice.toFixed(2)}</td>
                                                                                <td className="px-3 py-2 text-right font-medium text-earth">${variantSelling.toFixed(2)}</td>
                                                                                <td className="px-3 py-2 text-right">
                                                                                    <input
                                                                                        type="number"
                                                                                        step="0.01"
                                                                                        min="0.01"
                                                                                        placeholder={variantSelling.toFixed(2)}
                                                                                        value={priceDrafts[`${product.id}:${variant.id}`] ?? (variant.sellingPriceOverride != null ? String(variant.sellingPriceOverride) : '')}
                                                                                        className="w-24 px-2 py-1 text-right text-sm border border-earth/10 rounded-lg focus:ring-2 ring-bronze/20 bg-white"
                                                                                        onChange={(e) => {
                                                                                            setPriceDrafts(prev => ({ ...prev, [`${product.id}:${variant.id}`]: e.target.value }));
                                                                                        }}
                                                                                        onBlur={(e) => {
                                                                                            // Validate and commit on blur
                                                                                            const parsed = parseFloat(e.target.value);
                                                                                            const newOverride = e.target.value === ''
                                                                                                ? undefined
                                                                                                : (Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
                                                                                            const updatedVariants = (product.variants || []).map(v =>
                                                                                                v.id === variant.id ? { ...v, sellingPriceOverride: newOverride } : v
                                                                                            );
                                                                                            updateProductField(product.id, 'variants', updatedVariants);
                                                                                            // Clear draft so it falls back to committed value
                                                                                            setPriceDrafts(prev => { const next = { ...prev }; delete next[`${product.id}:${variant.id}`]; return next; });
                                                                                        }}
                                                                                    />
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Product index badge */}
                                                <div className="flex justify-between items-center pt-2">
                                                    <span className="text-[9px] uppercase tracking-widest text-earth/30 font-bold">Product {productIdx + 1} of {selectedProducts.length}</span>
                                                    <span className="text-[9px] text-earth/30">{orderedImages.length} images · {filteredVariants?.length || 0} variants</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Sticky Footer */}
                        <div className="bg-cream/50 p-4 md:p-6 border-t border-earth/5 flex justify-between items-center">
                            <button
                                onClick={() => setImportStep('review')}
                                className="px-6 py-2 rounded-full border border-earth/10 hover:bg-white transition-all text-xs uppercase tracking-widest font-bold"
                            >
                                <ChevronLeft className="w-3 h-3 inline mr-1" /> Back to Editing
                            </button>
                            <button
                                onClick={confirmImport}
                                disabled={isImporting}
                                className="px-10 py-3 rounded-full bg-green-700 text-white hover:bg-green-600 transition-all text-xs uppercase tracking-widest font-bold shadow-lg shadow-green-900/20 flex items-center gap-2 disabled:opacity-50"
                            >
                                <Check className="w-4 h-4" /> Confirm & Import All ({selectedProducts.length})
                            </button>
                        </div>
                    </div>
                </FadeIn>
            </div>
        );
    }

    // URL Import
    const handleImportByUrl = async (
        urlValue = importUrl,
        options: { append?: boolean; switchToReview?: boolean } = {},
    ): Promise<boolean> => {
        const originalSourceUrl = normalizeProductImportUrl(urlValue);
        if (!originalSourceUrl) return false;

        setIsImportingUrl(true);
        setError(null);

        try {
            // Call generic scraper action
            console.log('[URL Import] Calling scraper for:', originalSourceUrl);
            toast.loading('Fetching product data...', { id: 'url-import' });
            const result = await scrapeProduct({ url: originalSourceUrl });
            console.log('[URL Import] Scraper result:', result);
            toast.dismiss('url-import');

            if (!result) {
                throw new Error("Failed to fetch product data");
            }

            let importableProduct: ImportableProduct;

            if (result.source === '1688') {
                console.log('[URL Import] Processing as 1688 product');

                // OTAPI BatchGetItemFullInfo response: Result contains item data
                const item = result.data?.Result ?? result.data;
                if (!item || typeof item !== 'object') {
                    throw new Error('1688 payload missing item data');
                }

                // Extract basic info
                const productName = item.Title || item.OriginalTitle || 'Unknown Product';
                const productId = item.Id || `1688_${Date.now()}`;

                // Extract USD price from OTAPI price structure
                const getUsdPrice = (priceObj: any): number => {
                    return priceObj?.ConvertedPriceList?.Internal?.Price || priceObj?.OriginalPrice || 0;
                };
                // Extract raw CNY price (upstream, not reverse-converted)
                const getCnyPrice = (priceObj: any): number => {
                    return priceObj?.OriginalPrice || priceObj?.ConvertedPriceList?.Original?.Price || 0;
                };
                const promoPrice = getUsdPrice(item.PromotionPrice);
                const regularPrice = getUsdPrice(item.Price);
                const salePrice = promoPrice > 0 ? promoPrice : regularPrice;
                const origPrice = regularPrice > promoPrice && promoPrice > 0 ? regularPrice : salePrice;
                const rawCnyPrice = getCnyPrice(item.PromotionPrice) || getCnyPrice(item.Price);

                // Extract images from Pictures array
                const images: string[] = [];
                if (Array.isArray(item.Pictures)) {
                    item.Pictures.forEach((pic: any) => {
                        const url = pic?.Large?.Url || pic?.Medium?.Url || pic?.Url;
                        if (url && typeof url === 'string') images.push(url);
                    });
                }
                // Also extract variant/property images (PropertyPictures)
                if (Array.isArray(item.PropertyPictures)) {
                    item.PropertyPictures.forEach((pic: any) => {
                        const url = pic?.Large?.Url || pic?.Medium?.Url || pic?.Url || pic?.Original?.Url;
                        if (url && typeof url === 'string' && !images.includes(url)) images.push(url);
                    });
                }
                // Also extract from ItemImages if present
                if (Array.isArray(item.ItemImages)) {
                    item.ItemImages.forEach((img: any) => {
                        const url = typeof img === 'string' ? img : img?.Url || img?.Large?.Url;
                        if (url && typeof url === 'string' && !images.includes(url)) images.push(url);
                    });
                }
                if (images.length === 0 && item.MainPictureUrl) {
                    images.push(item.MainPictureUrl);
                }

                // Extract featured values (e.g. sales count)
                const getFeaturedValue = (name: string): string | undefined => {
                    if (!Array.isArray(item.FeaturedValues)) return undefined;
                    return item.FeaturedValues.find((v: any) => v.Name === name)?.Value;
                };

                // Extract structured product attributes using shared helper
                const urlSourceProperties = extractOtapiSourceProperties(item);

                // Preserve source detail text/HTML for grounded smart descriptions.
                const rawSourceDescription = typeof (result as any).rawDescription === 'string'
                    ? (result as any).rawDescription
                    : '';
                const rawHtmlDescription = typeof (result as any).rawHtmlDescription === 'string'
                    ? (result as any).rawHtmlDescription
                    : '';
                const cleanDescription = cleanOtapiDescription(item) || rawSourceDescription;

                // Extract variants from ConfiguredItems
                const variants: any[] = [];
                if (Array.isArray(item.ConfiguredItems) && item.ConfiguredItems.length > 0) {
                    item.ConfiguredItems.forEach((cfg: any, idx: number) => {
                        const cfgPrice = getUsdPrice(cfg.Price);
                        const cfgImage = cfg.Pictures?.[0]?.Large?.Url || cfg.Pictures?.[0]?.Medium?.Url || cfg.Pictures?.[0]?.Url;
                        // Build variant name from Configurators with Pid/Vid fallback
                        const configuratorLabel = Array.isArray(cfg.Configurators)
                            ? cfg.Configurators
                                .map((c: any) => `${c?.PropertyName ?? c?.Pid ?? '?'}: ${c?.Value ?? c?.Vid ?? '?'}`)
                                .join(' / ')
                            : '';
                        variants.push({
                            id: cfg.Id || `cfg_${idx}`,
                            name: cfg.Title || configuratorLabel || `Option ${idx + 1}`,
                            image: cfgImage || undefined,
                            priceAdjustment: cfgPrice ? cfgPrice - salePrice : 0,
                            inStock: (cfg.Quantity ?? cfg.MasterQuantity ?? 0) > 0,
                        });
                    });
                }

                importableProduct = {
                    id: String(productId),
                    name: productName,
                    price: salePrice || origPrice,
                    description: cleanDescription || '',
                    images: images,
                    category: '',
                    sourcePriceCny: rawCnyPrice || undefined,
                    collection: targetCollection as CollectionType,
                    variants: variants,
                    sourceId: String(productId),
                    originalPrice: origPrice,
                    salePrice: salePrice || origPrice,
                    shippingInfo: { freeShipping: true, estimatedDays: '7-15', cost: 0 },
                    seller: {
                        id: item.VendorId || '',
                        name: item.VendorDisplayName || item.VendorName || 'Unknown',
                        rating: 0,
                        feedbackScore: 0,
                    },
                    reviewCount: parseInt(getFeaturedValue('SalesInLast30Days') || '0', 10),
                    averageRating: 0,
                    productUrl: (result as any).resolvedUrl || originalSourceUrl,
                    source: '1688',
                    selected: true,
                    targetCollection: targetCollection as CollectionType,
                    customPrice: calculateFinalPrice(salePrice || origPrice),
                    // Marketing/description images from GetItemDescription
                    descriptionImages: ('descriptionImages' in result ? (result as any).descriptionImages : []) || [],
                    rawSourceDescription,
                    rawHtmlDescription,
                    // Structured product attributes for AI description generation
                    sourceProperties: Object.keys(urlSourceProperties).length > 0 ? urlSourceProperties : undefined,
                } as any;
            } else {
                // Generic source (handles AliExpress, Amazon, and any other URLs)
                console.log('[URL Import] Processing as generic product:', result.data);
                const data = result.data;
                const genId = `gen_${Date.now()}`;
                // Convert non-USD prices to approximate USD
                let importPrice = data.price || 0;
                const rawCurrencyCode = data.currency ? String(data.currency).toUpperCase().trim() : 'USD';
                const rawPriceOriginal = importPrice;
                if (rawCurrencyCode !== 'USD') {
                    const { usd, rate } = convertToUsd(importPrice, rawCurrencyCode);
                    importPrice = usd;
                    console.log(`[URL Import] Converted ${rawPriceOriginal} ${rawCurrencyCode} → $${importPrice} USD (rate: ${rate})`);
                    toast.info(`Price converted: ${rawPriceOriginal} ${rawCurrencyCode} → $${importPrice} USD`);
                }
                importableProduct = {
                    id: genId,
                    name: data.title || 'Unknown',
                    price: importPrice,
                    description: data.description || '',
                    images: (data.images && data.images.length > 0) ? data.images : (data.image ? [data.image] : []),
                    category: '',
                    collection: targetCollection as CollectionType,
                    variants: [],
                    sourceId: genId,
                    originalPrice: importPrice,
                    salePrice: importPrice,
                    shippingInfo: { freeShipping: false, estimatedDays: 'Unknown', cost: 0 },
                    seller: { id: '', name: 'Unknown', rating: 0, feedbackScore: 0 },
                    reviewCount: 0,
                    averageRating: 0,
                    productUrl: (result as any).resolvedUrl || originalSourceUrl,
                    source: 'generic',
                    selected: true,
                    targetCollection: targetCollection as CollectionType,
                    customPrice: calculateFinalPrice(importPrice),
                    // Always populate audit fields for downstream visibility
                    sourceCurrency: rawCurrencyCode,
                    sourcePriceOriginal: rawPriceOriginal,
                } as any;
            }

            console.log('[URL Import] Created importable product:', importableProduct.name, 'images:', importableProduct.images?.length, 'variants:', importableProduct.variants?.length);

            // Auto-translate Chinese variant names to English
            if (importableProduct.variants && importableProduct.variants.length > 0) {
                try {
                    const variantNames = importableProduct.variants.map((v: any) => v.name);
                    const translations = await translateVariantNames(variantNames);
                    importableProduct.variants = importableProduct.variants.map((v: any) => ({
                        ...v,
                        name: translations.get(v.name) || v.name,
                    }));
                    console.log('[URL Import] Translated variant names');
                } catch (err) {
                    console.warn('[URL Import] Variant translation failed, keeping originals:', err);
                }
            }

            // Snapshot variant state AFTER translation so revert restores translated names + images
            if (importableProduct.variants && importableProduct.variants.length > 0) {
                importableProduct.originalVariants = importableProduct.variants.map((v: any) => ({
                    id: v.id,
                    name: v.name,
                    image: v.image,
                }));
            }

            // Auto-AI Enhancement (optional - preserves original data if fails)
            if (autoEnhanceAi) {
                try {
                    toast.loading('Enhancing with AI...', { id: 'ai-enhance' });
                    const sourceSnapshot = buildSnapshotForImportProduct(importableProduct);

                    // Run name generation and server-side smart description in parallel.
                    const [smartNameSettled, smartDescriptionSettled] = await Promise.allSettled([
                        generateSmartName({
                            request: {
                                sourceSnapshot,
                                adminContext: {
                                    selectedCategory: importableProduct.category,
                                    selectedCollection: importableProduct.collection,
                                },
                                generationMode: 'import_auto',
                                options: {
                                    allowImageAnalysis: true,
                                    forceFreshVariation: true,
                                },
                            },
                        } as any),
                        generateSmartDescription({
                            request: {
                                sourceSnapshot,
                                adminContext: {
                                    selectedCategory: importableProduct.category,
                                    selectedCollection: importableProduct.collection,
                                },
                                generationMode: 'import_auto',
                                options: {
                                    allowImageAnalysis: true,
                                    allowSeoKeywords: true,
                                    forceFreshVariation: true,
                                },
                            },
                        } as any)
                    ]);

                    toast.dismiss('ai-enhance');

                    const smartNameResult = smartNameSettled.status === 'fulfilled' ? smartNameSettled.value as any : null;
                    const enhancedName = smartNameResult?.ok && smartNameResult.name ? smartNameResult.name : '';
                    const isValidAiName = Boolean(enhancedName);
                    const smartDescriptionResult = smartDescriptionSettled.status === 'fulfilled' ? smartDescriptionSettled.value as any : null;
                    const isValidAiDesc = smartDescriptionResult?.ok && smartDescriptionResult.description && smartDescriptionResult.description.length > 80;

                    if (isValidAiName || isValidAiDesc) {
                        importableProduct = {
                            ...importableProduct,
                            customName: isValidAiName ? enhancedName : (importableProduct.customName || importableProduct.name),
                            customDescription: isValidAiDesc ? smartDescriptionResult.description : importableProduct.description,
                            ...(isValidAiDesc
                                ? {
                                    descriptionAuditId: smartDescriptionResult.auditId,
                                    smartDescriptionAdminEdited: false,
                                    smartDescriptionWarnings: smartDescriptionResult.warnings || [],
                                    smartDescriptionSourceQuality: smartDescriptionResult.facts?.sourceQuality?.score,
                                    smartDescriptionFallbackUsed: Boolean(smartDescriptionResult.fallbackUsed),
                                }
                                : {}),
                        };
                        toast.success('Product found & AI enhanced');
                    } else {
                        console.warn('[URL Import] AI returned generic fallbacks, using original data');
                        toast.success('Product found (AI used defaults)');
                    }
                } catch (aiErr) {
                    toast.dismiss('ai-enhance');
                    console.error('Auto-AI failed:', aiErr);
                    toast.error('Product found, but AI enhancement failed');
                }
            } else {
                toast.success('Product found');
            }

            // Set results to just this product and switch to review immediately
            setSearchResults(prev => options.append ? [...prev, importableProduct] : [importableProduct]);
            if (!options.append) setImportUrl('');
            if (options.switchToReview !== false) {
                setImportStep('review');
                setReviewIndex(0);
                setReviewBatchNumber(1);
            }
            return true;

        } catch (err) {
            console.error('Import by URL failed:', err);
            const errorMsg = getUserFacingErrorMessage(err, 'Failed to import product. Please try a different link.');
            setError(errorMsg);
            toast.error('Import failed', { description: errorMsg });
            return false;
        } finally {
            toast.dismiss('url-import');
            setIsImportingUrl(false);
        }
    };

    const handleBatchImport = async () => {
        const urls = parseProductImportUrls(batchUrls);
        if (!urls.length) return;
        setIsImportingBatch(true);
        setError(null);
        try {
            const jobId = await createBatchImport({ urls });
            setActiveBatchJobId(jobId);
            try { localStorage.setItem('active-batch-import-job', jobId); } catch { /* storage unavailable */ }
            setBatchUrls('');
            setImportStep('search');
            setReviewIndex(0);
            setReviewBatchNumber(1);
            toast.success(`${urls.length} links added. The first three are processing now.`);
        } catch (error) {
            const message = getUserFacingErrorMessage(error, 'Could not start the batch import.');
            setError(message);
            toast.error('Batch import failed', { description: message });
        } finally {
            setIsImportingBatch(false);
        }
    };

    const handleClearBatchImport = async () => {
        if (!batchJob) return;
        if (!confirm(`Clear this batch import queue? This removes ${batchJob.total} uploaded link${batchJob.total === 1 ? '' : 's'} from review, but it will not delete products you already imported.`)) return;
        try {
            const result = await cancelBatchImport({ jobId: batchJob._id });
            setActiveBatchJobId(null);
            try { localStorage.removeItem('active-batch-import-job'); } catch { /* storage unavailable */ }
            const batchItemIds = new Set(pipelineItems.map(item => item._id));
            setSearchResults(prev => prev.filter(product => !product.batchItemId || !batchItemIds.has(product.batchItemId as Id<'batchImportItems'>)));
            setImportStep('search');
            setReviewIndex(0);
            setReviewBatchNumber(1);
            setSelectAll(false);
            toast.success(`Cleared ${result.cleared} import link${result.cleared === 1 ? '' : 's'} from review.`);
        } catch (error) {
            const message = getUserFacingErrorMessage(error, 'Could not clear this batch import.');
            setError(message);
            toast.error('Clear batch failed', { description: message });
        }
    };

    const selectedCount = searchResults.filter(p => p.selected).length;
    const pipelineItems = batchItems || [];
    const fetchingItems = pipelineItems.filter(item => item.status === 'fetching');
    const waitingCount = pipelineItems.filter(item => item.status === 'pending').length;
    const readyCount = pipelineItems.filter(item => item.status === 'ready').length;
    const errorItems = pipelineItems.filter(item => item.status === 'error' && !isObsoleteBatchImportError(item));
    const importedCount = pipelineItems.filter(item => item.status === 'imported').length;
    const processedCount = readyCount + errorItems.length + importedCount + pipelineItems.filter(item => item.status === 'skipped').length;
    const startReadyBatchReview = () => {
        const readyIds = new Set(pipelineItems.filter(item => item.status === 'ready').slice(0, REVIEW_BATCH_SIZE).map(item => item._id));
        if (readyIds.size === 0) return;
        setSearchResults(prev => prev.map(product => ({
            ...product,
            selected: Boolean(product.batchItemId && readyIds.has(product.batchItemId as Id<'batchImportItems'>)),
        })));
        setReviewIndex(0);
        setReviewBatchNumber(Math.floor(importedCount / REVIEW_BATCH_SIZE) + 1);
        setImportStep('review');
    };

    return (
        <div className="relative min-h-[80vh]">
            {/* Toast Container */}
            <Toaster position="top-right" richColors closeButton />

            {/* Custom Styles for Float/Glow Animations */}
            <style>{`
                .glass-panel {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(40px);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.1);
                }
                @keyframes float {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                }
                @keyframes float-delay {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-15px); }
                }
                @keyframes glow {
                    0%, 100% { box-shadow: 0 0 20px rgba(166,124,82,0.1); }
                    50% { box-shadow: 0 0 40px rgba(166,124,82,0.3); }
                }
                .animate-float { animation: float 6s ease-in-out infinite; }
                .animate-float-delay { animation: float-delay 8s ease-in-out infinite 1s; }
                .animate-glow { animation: glow 4s ease-in-out infinite; }
                .glass-card {
                    background: rgba(255, 255, 255, 0.85); /* Increased opacity for contrast */
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(166, 124, 82, 0.1); /* Slight bronze tint to border */
                    box-shadow: 0 8px 32px 0 rgba(74, 59, 50, 0.1);
                }
                @media (hover: hover) {
                    .glass-card:hover {
                        background: rgba(255, 255, 255, 0.95);
                        border-color: rgba(166, 124, 82, 0.3);
                        transform: translateY(-5px);
                        box-shadow: 0 20px 40px -10px rgba(166, 124, 82, 0.2);
                    }
                }
            `}</style>

            {/* Background Ambience */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-br from-bronze/10 to-transparent rounded-full blur-[100px] opacity-40 animate-float" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-earth/10 to-transparent rounded-full blur-[80px] opacity-30 animate-float-delay" />
            </div>

            {/* Content Container */}
            <div className="relative z-10 space-y-12">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-earth/10 pb-6 md:pb-8 gap-3">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-8 h-[1px] bg-bronze inline-block"></span>
                            <span className="text-bronze text-[10px] uppercase tracking-[0.4em] font-bold">Global Sourcing</span>
                        </div>
                        <h1 className="font-serif text-3xl md:text-5xl text-earth tracking-tight">
                            Import & <span className="text-bronze italic">Curate</span>
                        </h1>
                    </div>
                </div>

                {/* Hero Search Module */}
                <FadeIn mobileFast>
                    <div className="glass-card rounded-[2rem] p-4 md:p-10 relative group transition-all duration-700 shadow-xl border border-white/50">
                        {/* Direct Link Import - Enhanced */}
                        <FadeIn delay={200} className="relative z-20" mobileFast>
                            <div className="glass-card max-w-5xl mx-auto rounded-2xl p-4 md:p-6 border border-white/50 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/5 rounded-full blur-3xl -z-10" />

                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-bronze text-xs uppercase tracking-widest font-bold flex items-center gap-2">
                                            <Link className="w-3 h-3" /> Quick Import by URL
                                        </h3>

                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <div className={`w-8 h-4 rounded-full transition-colors relative ${autoEnhanceAi ? 'bg-purple-500' : 'bg-earth/20'}`}>
                                                <div className={`absolute top-0.5 bottom-0.5 w-3 h-3 bg-white rounded-full transition-all shadow-sm ${autoEnhanceAi ? 'left-4.5' : 'left-0.5'}`} />
                                            </div>
                                            <span className={`text-[10px] uppercase tracking-widest font-bold transition-colors ${autoEnhanceAi ? 'text-purple-600' : 'text-earth/40 group-hover:text-earth/60'}`}>
                                                Generate on fetch
                                            </span>
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={autoEnhanceAi}
                                                onChange={(e) => setAutoEnhanceAi(e.target.checked)}
                                            />
                                        </label>
                                    </div>

                                    <div className="flex flex-col md:flex-row gap-2">
                                        <input
                                            type="text"
                                            value={importUrl}
                                            onChange={(e) => setImportUrl(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleImportByUrl()}
                                            placeholder="Paste any product URL..."
                                            className="flex-1 bg-white border border-earth/10 rounded-xl px-4 py-3 text-sm text-earth placeholder:text-earth/30 focus:outline-none focus:ring-2 focus:ring-bronze/20 focus:border-bronze shadow-inner"
                                        />
                                        <button
                                            onClick={() => handleImportByUrl()}
                                            disabled={isImportingUrl || !importUrl.trim()}
                                            className="bg-earth text-cream px-6 py-3 rounded-xl text-xs uppercase tracking-widest font-bold hover:bg-bronze transition-colors disabled:opacity-50 whitespace-nowrap shadow-lg shadow-earth/10"
                                        >
                                            {isImportingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch & Review'}
                                        </button>
                                    </div>

                                    <div className="border-t border-earth/10 pt-4 space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <label htmlFor="batch-product-urls" className="text-[10px] uppercase tracking-widest font-bold text-earth/60">Batch import</label>
                                            <span className="text-[10px] text-earth/40">One per line, or paste from Notes</span>
                                        </div>
                                        <textarea
                                            id="batch-product-urls"
                                            value={batchUrls}
                                            onChange={(e) => setBatchUrls(e.target.value)}
                                            placeholder="Paste 1688, AliExpress, or other product links here…"
                                            rows={4}
                                            className="w-full resize-y bg-white border border-earth/10 rounded-xl px-4 py-3 text-sm text-earth placeholder:text-earth/30 focus:outline-none focus:ring-2 focus:ring-bronze/20 focus:border-bronze shadow-inner"
                                        />
                                        <button
                                            onClick={handleBatchImport}
                                            disabled={isImportingBatch || !batchUrls.trim()}
                                            className="w-full bg-bronze text-white px-6 py-3 rounded-xl text-xs uppercase tracking-widest font-bold hover:bg-earth transition-colors disabled:opacity-50"
                                        >
                                            {isImportingBatch
                                                ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Starting pipeline…</span>
                                                : `Start batch (${parseProductImportUrls(batchUrls).length || 0})`}
                                        </button>
                                        <p className="text-[10px] leading-relaxed text-earth/45">1688 short/share links are accepted too: Louie Mae resolves the destination before extracting the listing.</p>
                                    </div>

                                    {batchJob && pipelineItems.length > 0 && (
                                        <section aria-label="Batch import pipeline" className="rounded-2xl border border-bronze/15 bg-white/60 p-3 md:p-4 shadow-inner">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-bronze">Intake in progress</p>
                                                    <h4 className="mt-1 font-serif text-xl text-earth">Fetching 3 at a time</h4>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-earth/60">
                                                    <span className="rounded-full bg-cream px-3 py-1 font-mono">{processedCount}/{batchJob.total}</span>
                                                    <span>processed</span>
                                                </div>
                                            </div>

                                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-earth/10">
                                                <div className="h-full rounded-full bg-gradient-to-r from-bronze to-amber-600 transition-all duration-500" style={{ width: `${batchJob.total ? (processedCount / batchJob.total) * 100 : 0}%` }} />
                                            </div>

                                            <div className="mt-4 grid gap-2 lg:grid-cols-3">
                                                {fetchingItems.map(item => (
                                                    <div key={item._id} className="flex min-w-0 items-center gap-3 rounded-xl border border-earth/10 bg-white/75 p-3">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bronze/10 font-mono text-xs font-bold text-bronze">{item.position + 1}</div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="truncate font-mono text-[10px] text-earth/55" title={item.normalizedUrl}>{item.normalizedUrl}</p>
                                                            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-earth"><Loader2 className="h-3 w-3 animate-spin text-bronze" />{item.stage}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                                {fetchingItems.length === 0 && batchJob.status === 'ready' && (
                                                    <div className="lg:col-span-3 flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800"><Check className="h-4 w-4" /> Intake complete. Continue through the ready review groups.</div>
                                                )}
                                            </div>

                                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider">
                                                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800"><Clock3 className="mr-1 inline h-3 w-3" />{waitingCount} waiting</span>
                                                    <span className="rounded-full bg-green-50 px-3 py-1.5 text-green-800"><ListChecks className="mr-1 inline h-3 w-3" />{readyCount} ready</span>
                                                    <span className="rounded-full bg-earth/5 px-3 py-1.5 text-earth/60">{importedCount} imported</span>
                                                </div>
                                                {readyCount > 0 && (
                                                    <button type="button" onClick={startReadyBatchReview} className="min-h-11 rounded-xl bg-earth px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-cream transition-colors hover:bg-bronze">
                                                        Review next {Math.min(REVIEW_BATCH_SIZE, readyCount)}
                                                    </button>
                                                )}
                                                <button type="button" onClick={handleClearBatchImport} className="min-h-11 rounded-xl border border-red-200 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-700 transition-colors hover:bg-red-50">
                                                    Clear batch
                                                </button>
                                            </div>

                                            {errorItems.length > 0 && (
                                                <div className="mt-3 space-y-2">
                                                    {errorItems.map(item => (
                                                        <div key={item._id} role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center">
                                                            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                                                            <div className="min-w-0 flex-1"><p className="truncate font-mono text-[10px] text-red-800">{item.normalizedUrl}</p><p className="text-xs text-red-700">{item.error || 'This link needs attention.'}</p></div>
                                                            <button type="button" onClick={() => retryBatchItem({ itemId: item._id })} className="min-h-10 rounded-lg border border-red-200 bg-white px-4 text-xs font-bold text-red-700"><RefreshCw className="mr-1 inline h-3 w-3" />Retry</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    {/* URL normalization tip */}
                                    {importUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(importUrl.trim()) && (
                                        <div className="text-[10px] text-orange-600 flex items-center gap-1 font-medium bg-orange-50 p-2 rounded-lg border border-orange-100">
                                            <AlertCircle className="w-3 h-3" />
                                            We will add https:// automatically before importing.
                                        </div>
                                    )}

                                    {/* Error Display */}
                                    {error && (
                                        <div role="alert" className="text-[11px] text-red-700 flex items-center gap-2 font-medium bg-red-50 p-3 rounded-xl border border-red-200 animate-in fade-in">
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            <span>{error}</span>
                                            <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 transition-colors">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </FadeIn>

                        {/* Search Input - High Contrast */}
                        <div className="mb-8 mt-8 border-t border-earth/10 pt-8">
                            <div className="relative">
                                <Search className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-5 md:w-6 h-5 md:h-6 text-earth/40 pointer-events-none" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    placeholder="Discover premium products..."
                                    className="w-full pl-12 md:pl-20 pr-4 md:pr-36 py-4 md:py-6 bg-white border border-earth/10 rounded-2xl text-base md:text-2xl font-serif text-earth placeholder:text-earth/40 focus:outline-none focus:ring-2 focus:ring-bronze/20 focus:border-bronze/50 transition-all shadow-sm"
                                />
                                <button
                                    onClick={() => handleSearch()}
                                    disabled={isSearching || !searchQuery.trim()}
                                    className="hidden md:block absolute right-3 top-3 bottom-3 bg-earth text-cream px-10 rounded-xl text-xs uppercase tracking-[0.25em] font-bold hover:bg-bronze hover:scale-105 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:scale-100 shadow-lg shadow-earth/20"
                                >
                                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Search'}
                                </button>
                            </div>
                            <button
                                onClick={() => handleSearch()}
                                disabled={isSearching || !searchQuery.trim()}
                                className="md:hidden mt-2 w-full bg-earth text-cream px-8 py-3 rounded-xl text-xs uppercase tracking-[0.25em] font-bold hover:bg-bronze active:scale-95 transition-all duration-300 disabled:opacity-50 shadow-lg shadow-earth/20"
                            >
                                {isSearching ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Search'}
                            </button>
                        </div>
                        {/* Floating Filters - High Contrast Pills */}
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2 px-4 py-2 bg-cream text-earth rounded-full border border-earth/10">
                                <Filter className="w-3 h-3 text-bronze" />
                                <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">Filter By</span>
                            </div>

                            {/* Price */}
                            <div className="group/price relative flex items-center gap-2 px-6 py-3 bg-white hover:bg-cream rounded-full border border-earth/10 hover:border-bronze/50 transition-all cursor-pointer shadow-sm">
                                <DollarSign className="w-3 h-3 text-earth/60 group-hover/price:text-bronze transition-colors" />
                                <input
                                    type="number"
                                    value={minPrice}
                                    onChange={(e) => setMinPrice(e.target.value)}
                                    placeholder="Min"
                                    className="w-12 bg-transparent text-xs text-center font-medium text-earth placeholder:text-earth/30 border-b border-earth/10 focus:border-bronze focus:outline-none"
                                />
                                <span className="text-earth/40">-</span>
                                <input
                                    type="number"
                                    value={maxPrice}
                                    onChange={(e) => setMaxPrice(e.target.value)}
                                    placeholder="Max"
                                    className="w-12 bg-transparent text-xs text-center font-medium text-earth placeholder:text-earth/30 border-b border-earth/10 focus:border-bronze focus:outline-none"
                                />
                            </div>


                            {/* Sort */}
                            <div className="relative group/sort">
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as any)}
                                    className="appearance-none pl-4 pr-10 py-3 bg-white hover:bg-cream rounded-full border border-earth/10 hover:border-bronze/50 text-xs font-medium text-earth cursor-pointer focus:outline-none transition-all shadow-sm"
                                >
                                    <option value="default">Best Match</option>
                                    <option value="price_asc">Price: Low to High</option>
                                    <option value="price_desc">Price: High to Low</option>
                                    <option value="orders">Popularity</option>
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-earth/50 pointer-events-none group-hover/sort:text-bronze transition-colors" />
                            </div>

                        </div>


                    </div>
                </FadeIn>

                {/* Results Section */}
                {searchResults.length > 0 && (
                    <div className="space-y-8">
                        {/* Floating Toolbar - High Contrast */}
                        <div className="sticky top-4 z-50 bg-earth text-cream rounded-full px-6 py-3 flex items-center justify-between mb-8 shadow-2xl animate-float-delay border border-white/10">
                            <div className="flex items-center gap-6">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300 ${selectAll ? 'bg-bronze border-bronze scale-110' : 'border-white/40 group-hover:border-white'}`}>
                                        {selectAll && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <input type="checkbox" checked={selectAll} onChange={handleSelectAll} className="hidden" />
                                    <span className="text-xs uppercase tracking-widest text-white/80 group-hover:text-white transition-colors">Select All</span>
                                </label>
                                <div className="h-4 w-px bg-white/20"></div>
                                <span className="text-xs text-white/60 font-medium">
                                    {searchResults.length} Products Found
                                </span>
                            </div>

                            <div className="flex items-center gap-4">
                                <select
                                    value={targetCollection}
                                    onChange={(e) => {
                                        setTargetCollection(e.target.value);
                                        setTargetSubcategory('');
                                    }}
                                    className="bg-transparent text-xs text-white/90 hover:text-white focus:outline-none cursor-pointer transition-colors border-none"
                                >
                                    {collections.map(c => <option key={c.id} value={c.id} className="text-earth">To: {c.title}</option>)}
                                </select>

                                <button
                                    onClick={enhanceAllSelected}
                                    disabled={selectedCount === 0}
                                    className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-white hover:bg-white hover:text-purple-600 transition-colors disabled:opacity-20"
                                    title="Auto-Enhance Selected"
                                >
                                    <Wand2 className="w-4 h-4" />
                                </button>

                                <button
                                    onClick={handleImport}
                                    disabled={selectedCount === 0}
                                    className="bg-cream text-earth px-6 py-2 rounded-full text-xs uppercase tracking-widest font-bold hover:bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
                                >
                                    Import {selectedCount > 0 ? `(${selectedCount})` : ''}
                                </button>
                            </div>
                        </div>

                        {/* Product Grid - Using ProductCard Component */}
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            {searchResults.map((product, idx) => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    index={idx}
                                    calculateFinalPrice={calculateFinalPrice}
                                    toggleProductSelection={toggleProductSelection}
                                    updateProductField={updateProductField}
                                    enhanceProductWithAI={enhanceProductWithAI}
                                />
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-6 py-12">
                                <button
                                    onClick={() => handleSearch(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="w-12 h-12 rounded-full glass-card flex items-center justify-center text-earth/60 hover:text-bronze hover:scale-110 transition-all disabled:opacity-20 disabled:scale-100 border border-earth/10"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <span className="font-serif text-2xl text-earth font-medium">
                                    {currentPage} <span className="text-earth/30 mx-2">/</span> {totalPages}
                                </span>
                                <button
                                    onClick={() => handleSearch(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                    className="w-12 h-12 rounded-full glass-card flex items-center justify-center text-earth/60 hover:text-bronze hover:scale-110 transition-all disabled:opacity-20 disabled:scale-100 border border-earth/10"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Empty State / Welcome - Moved and Toned Down */}
                {!isSearching && searchResults.length === 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                        <div className="p-8 rounded-2xl border border-bronze/20 bg-white shadow-lg text-center">
                            <Globe className="w-8 h-8 mx-auto mb-3 text-bronze" />
                            <h4 className="font-serif text-lg text-earth font-medium">Global Search</h4>
                            <p className="text-sm text-earth/70 mt-1">Access millions of products worldwide.</p>
                        </div>
                        <div className="p-8 rounded-2xl border border-purple-200 bg-white shadow-lg text-center">
                            <Wand2 className="w-8 h-8 mx-auto mb-3 text-purple-600" />
                            <h4 className="font-serif text-lg text-earth font-medium">Smart Curation</h4>
                            <p className="text-sm text-earth/70 mt-1">Enhance descriptions and titles instantly.</p>
                        </div>
                        <div className="p-8 rounded-2xl border border-green-200 bg-white shadow-lg text-center">
                            <DollarSign className="w-8 h-8 mx-auto mb-3 text-green-600" />
                            <h4 className="font-serif text-lg text-earth font-medium">Smart Pricing</h4>
                            <p className="text-sm text-earth/70 mt-1">Automated markups and rounding rules.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductImport;

/**
 * Product Sourcing API Service
 * Uses OTAPI 1688 on RapidAPI for product data from 1688.com
 * Proxied through Convex HTTP actions to keep API key secure
 */

import type {
    SourceProduct,
    SourceSearchOptions,
    SourceSearchResult,
    Product,
    CollectionType
} from '../types';

// Backward-compatible re-exports
export type AliExpressProduct = SourceProduct;
export type AliExpressSearchOptions = SourceSearchOptions;
export type AliExpressSearchResult = SourceSearchResult;
export type { SourceProduct, SourceSearchOptions, SourceSearchResult };

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// Use Convex HTTP proxy for API calls (handles CORS and keeps API key secure)
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || '';
const CONVEX_SITE_URL = CONVEX_URL.replace('.convex.cloud', '.convex.site');

// Collection to category mapping (kept for future use)
const CATEGORY_MAPPING: Record<string, string> = {
    furniture: 'home-garden/furniture',
    decor: 'home-garden/home-decor',
    fashion: 'womens-clothing',
    kids: 'mother-kids/childrens-clothing',
};

// ═══════════════════════════════════════════════════════════════════════════
// CACHE & RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

/** In-memory TTL cache for API responses. */
const cache = new Map<string, CacheEntry<unknown>>();

/** Retrieves a cached value if it hasn't expired, otherwise returns null. */
const getCached = <T>(key: string): T | null => {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
        cache.delete(key);
        return null;
    }

    return entry.data;
};

/** Stores a value in the TTL cache with a configurable expiry (default 15 minutes). */
const setCache = <T>(key: string, data: T, ttlMs: number = 15 * 60 * 1000): void => {
    cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
};

// Simple rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms between requests

/** Wraps fetch with rate-limiting to avoid hitting API request limits. */
const rateLimitedFetch = async (url: string, options: RequestInit): Promise<Response> => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    lastRequestTime = Date.now();
    return fetch(url, options);
};

// ═══════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Handles non-OK API responses by throwing descriptive errors with status codes. */
const handleApiError = async (response: Response): Promise<never> => {
    let errorMessage = 'API Error';
    try {
        const data = await response.json();
        errorMessage = data.error || `API Error: ${response.status}`;
    } catch {
        errorMessage = `API Error: ${response.status}`;
    }
    console.error('Product API Error:', response.status, errorMessage);

    if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
    }

    throw new Error(errorMessage);
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export const aliexpressService = {
    /**
     * Check if the API is configured (always true when using Convex proxy)
     */
    isConfigured(): boolean {
        return Boolean(CONVEX_SITE_URL);
    },

    /**
     * Search for products from OTAPI 1688
     * Uses the Convex aggregated search endpoint for multi-page parallel fetching
     */
    async searchAllSources(options: SourceSearchOptions & {
        sources?: Array<'1688'>
    }): Promise<SourceSearchResult & { sources?: string[], errors?: string[] }> {
        const { query, page = 1, pageSize = 40, minPrice, maxPrice, sortBy, sources = ['1688'] } = options;

        // Check cache first
        const cacheKey = `aggregated:${JSON.stringify(options)}`;
        const cached = getCached<AliExpressSearchResult>(cacheKey);
        if (cached) return cached;

        try {
            // Call Convex HTTP proxy aggregated endpoint
            const searchUrl = `${CONVEX_SITE_URL}/products/search`;
            const searchBody = {
                query,
                page,
                pageSize,
                minPrice,
                maxPrice,
                sortBy,
                sources,
            };
            console.log(`[aliexpressService] searchAllSources: URL=${searchUrl}`);
            console.log(`[aliexpressService] searchAllSources: body=`, searchBody);

            const response = await rateLimitedFetch(
                searchUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(searchBody)
                }
            );

            if (!response.ok) {
                console.error(`[aliexpressService] Search response NOT OK: status=${response.status}`);
                await handleApiError(response);
            }

            const data = await response.json();
            const errorSummary =
                Array.isArray(data.errors) && data.errors.length > 0
                    ? `, errors: ${data.errors.join('; ')}`
                    : '';
            console.log(
                `[aliexpressService] Search response: ${data.products?.length || 0} products, totalCount=${data.totalCount || 0}${errorSummary}`
            );

            // Transform normalized products to SourceProduct format
            const result: SourceSearchResult & { sources?: string[], errors?: string[] } = {
                products: (data.products || []).map((p: any) => ({
                    // Product base properties
                    id: p.id,
                    name: p.title, // Product uses 'name', API returns 'title'
                    price: p.price,
                    description: p.description || '', // Now populated from OTAPI item.Description
                    images: Array.isArray(p.images) && p.images.length > 0
                        ? p.images
                        : (p.image ? [p.image] : []),
                    category: '',
                    collection: 'decor' as const,
                    // SourceProduct extensions
                    sourceId: p.id,
                    originalPrice: p.originalPrice || p.price,
                    salePrice: p.price,
                    shippingInfo: { freeShipping: true, estimatedDays: '7-15', cost: 0 },
                    seller: { id: '', name: '', rating: 0, feedbackScore: 0 },
                    variants: p.variants || [],
                    tierPricing: p.tierPricing || undefined,
                    reviewCount: p.sales || 0,
                    averageRating: p.rating || 0,
                    productUrl: p.url || '',
                    source: p.source || '1688',
                    // Structured product attributes for AI description generation
                    sourceProperties: p.sourceProperties || undefined,
                    rawSourceDescription: p.rawSourceDescription || p.description || undefined,
                    rawHtmlDescription: p.rawHtmlDescription || undefined,
                } as SourceProduct)),
                totalCount: data.totalCount || data.products?.length || 0,
                currentPage: data.currentPage ?? page,
                totalPages: data.totalPages ?? Math.ceil((data.totalCount || data.products?.length || 1) / pageSize),
                sources: data.sources,
                errors: data.errors,
            };

            // Cache for 10 minutes (shorter since it's from multiple sources)
            setCache(cacheKey, result, 10 * 60 * 1000);

            return result;
        } catch (error) {
            console.error('Aggregated search failed:', error);
            throw error;
        }
    },

    /**
     * Get detailed product information via Convex proxy
     */
    async getProductDetails(productId: string): Promise<AliExpressProduct | null> {
        // Remove ali_ prefix if present
        const cleanId = productId.replace('ali_', '');

        // Check cache first
        const cacheKey = `product:${cleanId}`;
        const cached = getCached<AliExpressProduct>(cacheKey);
        if (cached) return cached;

        try {
            // Call Convex HTTP proxy endpoint
            const response = await rateLimitedFetch(
                `${CONVEX_SITE_URL}/aliexpress/product`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId: cleanId })
                }
            );

            if (!response.ok) {
                if (response.status === 404) return null;
                await handleApiError(response);
            }

            const data = await response.json();
            // Unwrap OTAPI response structure and normalize to SourceProduct fields
            const raw = data.Result?.Item || data.result || data;
            const product: AliExpressProduct = {
                id: raw.Id || raw.id || cleanId,
                name: raw.Title || raw.title || raw.name || 'Unknown',
                price: raw.Price?.OriginalPrice || raw.price || 0,
                description: raw.Description || raw.description || '',
                images: Array.isArray(raw.Pictures)
                    ? raw.Pictures.map((p: any) => p.Url || p.Large?.Url || p)
                    : (Array.isArray(raw.images) ? raw.images : (raw.image ? [raw.image] : [])),
                category: raw.CategoryId || raw.category || '',
                collection: 'decor' as const,
                sourceId: raw.Id || raw.id || cleanId,
                originalPrice: raw.Price?.OriginalPrice || raw.originalPrice || raw.price || 0,
                salePrice: raw.Price?.Price || raw.salePrice || raw.price || 0,
                shippingInfo: { freeShipping: true, estimatedDays: '7-15', cost: 0 },
                seller: { id: '', name: raw.ProviderName || '', rating: 0, feedbackScore: 0 },
                variants: raw.variants || [],
                reviewCount: raw.SoldQuantity || raw.reviewCount || 0,
                averageRating: raw.averageRating || 0,
                productUrl: raw.ExternalItemUrl || raw.TaobaoItemUrl || raw.url || '',
                source: '1688',
            };

            // Cache for 4 hours
            setCache(cacheKey, product, 4 * 60 * 60 * 1000);

            return product;
        } catch (error) {
            console.error('Get product details failed:', error);
            throw error;
        }
    },



    /**
     * Convert AliExpress product to importable Product format
     */
    toImportableProduct(
        aliProduct: AliExpressProduct,
        options: {
            markup?: number; // Percentage markup (e.g., 40 for 40%)
            collection?: CollectionType;
            customName?: string;
            customDescription?: string;
        } = {}
    ): Product {
        const { markup = 40, collection, customName, customDescription } = options;
        const finalPrice = aliProduct.salePrice * (1 + markup / 100);

        return {
            id: aliProduct.id,
            name: customName || aliProduct.name,
            price: Math.ceil(finalPrice), // Round up
            description: customDescription || aliProduct.description,
            images: aliProduct.images,
            category: aliProduct.category,
            collection: collection || aliProduct.collection,
            isNew: true, // Mark as new when imported
            inStock: aliProduct.inStock,
        };
    },

    /**
     * Get category mapping for collection
     */
    getCategoryMapping(collection: CollectionType): string | undefined {
        return CATEGORY_MAPPING[collection];
    },

    /**
     * Clear all cached data
     */
    clearCache(): void {
        cache.clear();
    },

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; keys: string[] } {
        return {
            size: cache.size,
            keys: Array.from(cache.keys()),
        };
    },
};

export default aliexpressService;
